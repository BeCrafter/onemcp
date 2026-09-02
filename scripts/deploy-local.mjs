#!/usr/bin/env node
/**
 * deploy-local.mjs — 一键本地部署：编译打包 → 全局安装 → 重启 daemon → 冒烟验证。
 *
 * 用法：
 *   npm run deploy:local [-- --port 5625 --log-level INFO]
 *
 * 编译打包安装部分与 verify:local 共用 scripts/lib/install-local.mjs：
 *   1. npm run build（内置 clean，dist 全新）+ 产物新鲜度断言
 *   2. npm pack 打真实 tarball（遵循 files 字段过滤）
 *   3. npm install -g <tarball>（全局真实副本，完整替代旧 onemcp 命令，
 *      与从 registry 安装同语义）+ 安装形态硬校验（防软链式假安装）
 * 然后本脚本：
 *   4. 安全停止旧 daemon：读 pidfile → SIGTERM → 等待退出 → 必要时 SIGKILL → 清理 pidfile
 *   5. onemcp -m server -d 后台启动新 daemon
 *   6. 轮询 initialize 直至就绪（避免 pidfile 竞态与半启动状态）
 */
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { buildPackAndInstall } from './lib/install-local.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const PORT = Number(getArg('port', 5625));
const LOG_LEVEL = getArg('log-level', 'INFO');
const ONEMCP_DIR = path.join(os.homedir(), '.onemcp');
const PID_FILE = path.join(ONEMCP_DIR, 'server.pid');
const LOG_FILE = path.join(ONEMCP_DIR, 'logs', 'server.log');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(msg) {
  console.log(`[deploy] ${msg}`);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function stopDaemon() {
  let pid = null;
  try {
    pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
  } catch {
    /* no pidfile */
  }

  if (pid !== null && Number.isFinite(pid) && isProcessAlive(pid)) {
    log(`stopping old daemon (pid ${pid})...`);
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && isProcessAlive(pid)) {
      await sleep(200);
    }
    if (isProcessAlive(pid)) {
      log(`daemon (pid ${pid}) did not exit after SIGTERM, sending SIGKILL`);
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
      await sleep(500);
    }
  } else if (await portInUse(PORT)) {
    // No usable pidfile but something is listening (e.g. a manually started
    // instance) — refuse to guess which process to kill.
    throw new Error(
      `port ${PORT} is in use but no daemon pidfile exists at ${PID_FILE}. ` +
        `Stop the existing instance manually, then re-run.`
    );
  }

  fs.rmSync(PID_FILE, { force: true });
  if (await portInUse(PORT)) {
    throw new Error(`port ${PORT} is still in use after stopping the daemon`);
  }
  log('old daemon stopped');
}

function postInitialize(port, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 'deploy-check',
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'deploy', version: '0' } },
    });
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        res.on('end', () =>
          resolve({ status: res.statusCode, sessionId: res.headers['mcp-session-id'] })
        );
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(body);
  });
}

async function waitReady(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await postInitialize(port);
      if (r.status === 200 && r.sessionId) return r;
    } catch {
      /* not ready yet */
    }
    await sleep(500);
  }
  throw new Error(`daemon did not become ready within ${timeoutMs / 1000}s (log: ${LOG_FILE})`);
}

async function main() {
  await buildPackAndInstall(ROOT, (msg) => log(msg));

  await stopDaemon();

  log(`starting daemon: onemcp -m server -p ${PORT} -l ${LOG_LEVEL} -d`);
  const code = await new Promise((resolve) => {
    const child = spawn('onemcp', ['-m', 'server', '-p', String(PORT), '-l', LOG_LEVEL, '-d'], {
      stdio: 'ignore',
    });
    child.on('exit', resolve);
    child.on('error', () => resolve(1));
  });
  if (code !== 0) {
    const tail = fs.existsSync(LOG_FILE)
      ? fs.readFileSync(LOG_FILE, 'utf8').trimEnd().split('\n').slice(-5).join('\n')
      : '(no log file)';
    throw new Error(`daemon failed to start (exit ${code}). Last log lines:\n${tail}`);
  }

  log('waiting for readiness (initialize round-trip)...');
  await waitReady(PORT);

  console.log('');
  console.log(`✓ deploy:local PASSED — daemon on http://127.0.0.1:${PORT}/mcp`);
  console.log(`  log: ${LOG_FILE}`);
}

main().catch((err) => {
  console.error(`✗ deploy:local FAILED: ${err.message}`);
  process.exit(1);
});
