#!/usr/bin/env node
/**
 * e2e-local.mjs — 针对本地已安装 onemcp 的端到端回归。
 *
 * 完整链路：本脚本自身执行"编译 → npm pack → 全局真实安装（tarball + 形态校验）"，
 * 然后用随机端口 + 独立临时配置的独立实例模拟各场景（不影响 :5625 daemon）。
 *
 * 场景分两类，先验证正常操作，再验证故障恢复（对应历史问题，防回归）：
 *
 * 【正常场景】
 *   N1 HTTP 正常链路与连接复用：tools/list + 连续多次 tools/call 全部成功，
 *      零过期/零重建（连接复用生效），后端侧请求计数精确匹配
 *   N2 stdio 正常链路：initialize + tools/call 正常
 *   N3 SSE 正常链路：legacy SSE 两阶段握手 + tools/call 正常
 *   N4 标签过滤：X-MCP-Tags 头只返回匹配服务的工具
 *   N5 ping + 会话终止（DELETE /mcp）+ 终止后句柄透明重建
 *   N6 /health 与 /diagnostics 端点
 *
 * 【故障恢复场景】
 *   F1 HTTP 后端会话过期（jymcp 型 -32001，经 /__expire 控制端点触发）
 *      → 透明重建，客户端零感知
 *   F2 HTTP 后端规范型会话过期（HTTP 404）→ 同上
 *   F3 stdio 后端进程崩溃（fixture 第 2 次 tools/call 后自杀）→ 自动 respawn 重放
 *   F4 前端客户端会话句柄失效 → 重启 onemcp 实例后旧 Mcp-Session-Id 透明重建
 *
 * TUI：交互式界面需 PTY，不纳入本脚本；其恢复逻辑由
 * tests/integration/discovery-worker-session-expiry.test.ts 覆盖。
 *
 * 用法：npm run verify:local
 */
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPackAndInstall } from './lib/install-local.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STDIO_FIXTURE = path.join(ROOT, 'tests/integration/fixtures/mock-stdio-mcp.cjs');
const SESSION_QUOTA = 100; // 正常场景配额充足；过期场景经 /__expire 控制端点显式触发

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });

function resolveOnemcpCommand() {
  try {
    const bin = execSync('command -v onemcp', { encoding: 'utf8' }).trim();
    return { cmd: bin, args: [] };
  } catch {
    const dist = path.join(ROOT, 'dist', 'cli.js');
    if (fs.existsSync(dist)) {
      return { cmd: process.execPath, args: [dist], note: '（未找到全局 onemcp，回退使用 dist/cli.js）' };
    }
    throw new Error('未找到 onemcp 可执行文件，请先运行 npm run deploy:local');
  }
}

// ---------- mock Streamable HTTP 后端（支持 /__expire 控制端点） ----------
function startHttpBackend(port, staleMode = 'jsonrpc') {
  const sessions = new Map(); // sid -> remaining allowed requests
  let sidCounter = 0;
  const stats = { initializes: 0, toolsList: 0, toolsCall: 0, expiredErrors: 0, log: [] };
  const t0 = Date.now();
  const trace = (entry) => {
    if (stats.log.length < 120) stats.log.push(`${Date.now() - t0}ms ${entry}`);
  };

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/__stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
      return;
    }
    if (req.method === 'POST' && req.url === '/__expire') {
      // 模拟后端空闲回收：立即作废所有已发会话
      for (const sid of sessions.keys()) sessions.set(sid, 0);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ expired: sessions.size }));
      return;
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        res.writeHead(400).end();
        return;
      }
      const sendJson = (status, body) => {
        const json = JSON.stringify(body);
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(json),
        });
        res.end(json);
      };
      if (msg.id === undefined || msg.id === null) {
        res.writeHead(202).end();
        return;
      }
      if (msg.method === 'initialize') {
        stats.initializes++;
        const sid = `sess-${++sidCounter}`;
        sessions.set(sid, SESSION_QUOTA);
        trace(`initialize -> ${sid}`);
        const json = JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: 'mock-backend', version: '1.0.0' },
          },
        });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(json),
          'mcp-session-id': sid,
        });
        res.end(json);
        return;
      }
      const sid = req.headers['mcp-session-id'];
      const remaining = typeof sid === 'string' ? sessions.get(sid) : undefined;
      trace(`${msg.method} sid=${sid ?? '-'} remaining=${remaining ?? 'unknown'}`);
      if (remaining !== undefined && remaining > 0) {
        sessions.set(sid, remaining - 1);
        if (msg.method === 'tools/list') {
          stats.toolsList++;
          sendJson(200, {
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              tools: [
                { name: 'alpha', description: 'Alpha', inputSchema: { type: 'object', properties: {} } },
                { name: 'beta', description: 'Beta', inputSchema: { type: 'object', properties: {} } },
              ],
            },
          });
        } else {
          stats.toolsCall++;
          sendJson(200, {
            jsonrpc: '2.0',
            id: msg.id,
            result: { content: [{ type: 'text', text: 'ok' }] },
          });
        }
        return;
      }
      stats.expiredErrors++;
      if (staleMode === 'http404') {
        // 规范型过期信号：HTTP 404 on stale Mcp-Session-Id
        res.writeHead(404).end('Not Found');
        return;
      }
      sendJson(200, {
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32001, message: 'Session not found or expired. Please send initialize again.' },
      });
    });
  });

  return {
    listen: () => new Promise((r) => server.listen(port, '127.0.0.1', r)),
    close: () => new Promise((r) => server.close(r)),
    stats: () => stats,
    expireAll: () => {
      for (const sid of sessions.keys()) sessions.set(sid, 0);
    },
  };
}

// ---------- mock legacy SSE 后端（两阶段握手：GET /sse + POST /messages） ----------
function startSseBackend(port) {
  let sseRes = null;
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/sse')) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      res.write('event: endpoint\ndata: /messages\n\n');
      sseRes = res;
      req.on('close', () => {
        if (sseRes === res) sseRes = null;
      });
      return;
    }
    if (req.method === 'POST' && req.url.startsWith('/messages')) {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        let msg;
        try {
          msg = JSON.parse(raw);
        } catch {
          res.writeHead(400).end();
          return;
        }
        if (msg.id === undefined || msg.id === null) {
          res.writeHead(202).end();
          return;
        }
        let response;
        if (msg.method === 'initialize') {
          response = {
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: 'mock-sse', version: '1.0.0' },
            },
          };
        } else if (msg.method === 'tools/list') {
          response = {
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              tools: [
                { name: 'alpha', description: 'Alpha', inputSchema: { type: 'object', properties: {} } },
              ],
            },
          };
        } else {
          response = {
            jsonrpc: '2.0',
            id: msg.id,
            result: { content: [{ type: 'text', text: 'ok' }] },
          };
        }
        if (sseRes) {
          sseRes.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
        }
        res.writeHead(202).end();
      });
      return;
    }
    res.writeHead(404).end();
  });

  return {
    listen: () => new Promise((r) => server.listen(port, '127.0.0.1', r)),
    close: () => new Promise((r) => server.close(r)),
  };
}

// ---------- HTTP 客户端 ----------
function request(port, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...headers,
        },
      },
      (res) => {
        let out = '';
        res.on('data', (c) => (out += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
      }
    );
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error('client request timeout')));
    req.end(data ?? undefined);
  });
}

const post = (port, body, headers = {}) => request(port, 'POST', '/mcp', body, headers);
const get = (port, p) => request(port, 'GET', p, undefined);

// ---------- onemcp 实例管理 ----------
function spawnOnemcp(onemcpCmd, port, configDir, onStderr) {
  const child = spawn(onemcpCmd.cmd, [...onemcpCmd.args, '-m', 'server', '-p', String(port), '-l', 'INFO', '-c', configDir], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (d) => onStderr(d.toString()));
  return child;
}

async function stopChild(child, port) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((r) => child.once('exit', r)),
    sleep(10_000).then(() => child.kill('SIGKILL')),
  ]);
  // 等端口释放，避免下一个实例绑定失败
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const inUse = await new Promise((resolve) => {
      const s = net.connect({ host: '127.0.0.1', port });
      s.once('connect', () => {
        s.destroy();
        resolve(true);
      });
      s.once('error', () => resolve(false));
      s.setTimeout(500, () => {
        s.destroy();
        resolve(false);
      });
    });
    if (!inUse) return;
    await sleep(200);
  }
}

async function waitReady(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await post(port, {
        jsonrpc: '2.0',
        id: 'probe',
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } },
      });
      if (r.status === 200 && r.headers['mcp-session-id']) return r.headers['mcp-session-id'];
    } catch {
      /* not ready */
    }
    await sleep(500);
  }
  throw new Error(`onemcp 未在 ${timeoutMs / 1000}s 内就绪`);
}

async function callTool(port, session, id, name, args = {}) {
  const res = JSON.parse(
    (
      await post(port, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, {
        'mcp-session-id': session,
      })
    ).body
  );
  if (res.error) throw new Error(`tools/call(${name}) 把错误暴露给了客户端: ${JSON.stringify(res.error)}`);
  const text = res.result?.content?.[0]?.text;
  if (text !== 'ok') throw new Error(`tools/call(${name}) 返回异常: ${JSON.stringify(res).slice(0, 300)}`);
}

// ---------- 主流程 ----------
async function main() {
  console.log('[0/6] 编译当前代码 → npm 打包 → 全局真实安装（与 registry 安装同语义）');
  const { bin } = await buildPackAndInstall(ROOT, (msg) => console.log(`  ${msg}`));
  const onemcpCmd = { cmd: bin, args: [] };

  const httpNormalPort = await freePort(); // N1/F1: -32001 过期
  const http404Port = await freePort(); // F2: 404 过期
  const ssePort = await freePort(); // N3: SSE
  const onemcpPort = await freePort();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onemcp-e2e-'));
  const backendNormal = startHttpBackend(httpNormalPort, 'jsonrpc');
  const backend404 = startHttpBackend(http404Port, 'http404');
  const sseBackend = startSseBackend(ssePort);
  const stderrBuf = { text: '' };
  const onStderr = (d) => (stderrBuf.text += d);

  let child = null;
  const results = [];
  const record = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) process.exitCode = 1;
  };

  try {
    await backendNormal.listen();
    await backend404.listen();
    await sseBackend.listen();
    fs.writeFileSync(
      path.join(tmpDir, 'config.json'),
      JSON.stringify({
        mode: 'server',
        port: onemcpPort,
        logLevel: 'INFO',
        configDir: tmpDir,
        mcpServers: {
          'http-main': {
            enabled: true,
            tags: ['grp-http'],
            transport: 'http',
            url: `http://127.0.0.1:${httpNormalPort}/mcp`,
            connectionPool: { maxConnections: 2, idleTimeout: 60000, connectionTimeout: 10000 },
          },
          'http-404': {
            enabled: true,
            tags: ['grp-http'],
            transport: 'http',
            url: `http://127.0.0.1:${http404Port}/mcp`,
            connectionPool: { maxConnections: 2, idleTimeout: 60000, connectionTimeout: 10000 },
          },
          'sse-svc': {
            enabled: true,
            tags: ['grp-sse'],
            transport: 'sse',
            url: `http://127.0.0.1:${ssePort}/sse`,
            connectionPool: { maxConnections: 2, idleTimeout: 60000, connectionTimeout: 10000 },
          },
          'stdio-normal': {
            enabled: true,
            tags: ['grp-stdio'],
            transport: 'stdio',
            command: process.execPath,
            args: [STDIO_FIXTURE],
            connectionPool: { maxConnections: 2, idleTimeout: 60000, connectionTimeout: 10000 },
          },
          'stdio-crash': {
            enabled: true,
            tags: ['grp-stdio'],
            transport: 'stdio',
            command: process.execPath,
            args: [STDIO_FIXTURE],
            env: { ONEMCP_FIXTURE_EXIT_AFTER_CALLS: '2' },
            connectionPool: { maxConnections: 2, idleTimeout: 60000, connectionTimeout: 10000 },
          },
        },
        connectionPool: { maxConnections: 5, idleTimeout: 60000, connectionTimeout: 30000 },
        healthCheck: { enabled: true, interval: 30000, failureThreshold: 3, autoUnload: true },
        audit: { enabled: false, level: 'standard', logInput: false, logOutput: false, retention: { days: 30, maxSize: '1GB' } },
        security: { dataMasking: { enabled: false, patterns: [] } },
      })
    );

    console.log('\n[准备] 启动 onemcp 实例（HTTP×2 + SSE + stdio×2 共 5 个后端）');
    child = spawnOnemcp(onemcpCmd, onemcpPort, tmpDir, onStderr);
    const session = await waitReady(onemcpPort);
    record('实例就绪（initialize 往返正常）', true);

    const H = { 'mcp-session-id': session };

    console.log('\n[N1] HTTP 正常链路与连接复用');
    {
      const listRes = JSON.parse((await post(onemcpPort, { jsonrpc: '2.0', id: 'l1', method: 'tools/list', params: {} }, H)).body);
      const names = (listRes.result?.tools || []).map((t) => t.name).sort();
      record(
        'N1.1 tools/list 返回全部命名空间工具',
        !listRes.error &&
          ['http-main__alpha', 'http-404__alpha', 'sse-svc__alpha', 'stdio-normal__echo', 'stdio-crash__echo'].every((n) =>
            names.includes(n)
          ),
        `[${names.join(', ')}]`
      );

      const before = { ...backendNormal.stats() }; // 按值快照（stats() 返回同一引用）
      let n1ok = true;
      try {
        for (const [i, id] of ['c1', 'c2', 'c3'].entries()) {
          await callTool(onemcpPort, session, id, 'http-main__alpha');
        }
      } catch (e) {
        n1ok = false;
        record('N1.2 连续 3 次调用全部成功', false, e.message);
      }
      if (n1ok) {
        const after = backendNormal.stats();
        const reused =
          after.initializes === before.initializes && // 零重建：连接复用生效
          after.expiredErrors === before.expiredErrors && // 零过期
          after.toolsCall - before.toolsCall === 3; // 3 次调用精确到达后端
        record(
          'N1.2 连续 3 次调用全部成功',
          reused,
          `连接复用（initialize ${before.initializes}→${after.initializes}）、零过期、后端收到 3 次 tools/call`
        );
      }
    }

    console.log('\n[N2] stdio 正常链路');
    {
      let ok = true;
      try {
        await callTool(onemcpPort, session, 'n2a', 'stdio-normal__echo', { text: 'hello' });
        await callTool(onemcpPort, session, 'n2b', 'stdio-normal__echo', { text: 'world' });
      } catch (e) {
        ok = false;
        record('N2.1 stdio 初始化 + 连续调用', false, e.message);
      }
      if (ok) record('N2.1 stdio 初始化 + 连续调用', true, 'spawn → initialize → tools/call ×2 正常');
    }

    console.log('\n[N3] SSE 正常链路');
    {
      let ok = true;
      try {
        await callTool(onemcpPort, session, 'n3a', 'sse-svc__alpha');
      } catch (e) {
        ok = false;
        record('N3.1 SSE 两阶段握手 + tools/call', false, e.message);
      }
      if (ok) record('N3.1 SSE 两阶段握手 + tools/call', true);
    }

    console.log('\n[N4] 标签过滤（X-MCP-Tags）');
    {
      // 标签在会话创建时解析：规范流程 = 携带 X-MCP-Tags 发起 initialize，
      // 会话即带上标签过滤，随后该会话的 tools/list 只返回匹配服务的工具。
      const initRes = await post(onemcpPort, {
        jsonrpc: '2.0',
        id: 'tag-init',
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e-tag', version: '0' } },
      }, { 'X-MCP-Tags': 'grp-stdio' });
      const tagSession = initRes.headers['mcp-session-id'];
      if (initRes.status !== 200 || !tagSession) {
        throw new Error(`带标签 initialize 失败: ${initRes.status}`);
      }
      await post(onemcpPort, { jsonrpc: '2.0', method: 'notifications/initialized' }, { 'mcp-session-id': tagSession });

      const res = JSON.parse(
        (
          await post(onemcpPort, { jsonrpc: '2.0', id: 'tag1', method: 'tools/list', params: {} }, {
            'mcp-session-id': tagSession,
          })
        ).body
      );
      const names = (res.result?.tools || []).map((t) => t.name);
      const ok =
        !res.error &&
        names.length > 0 &&
        names.every((n) => n.startsWith('stdio-normal__') || n.startsWith('stdio-crash__'));
      record('N4.1 X-MCP-Tags=grp-stdio 只返回 stdio 服务工具', ok, `[${names.join(', ')}]`);
    }

    console.log('\n[N5] ping + 会话终止（DELETE）+ 终止后句柄重建');
    {
      const pingRes = JSON.parse((await post(onemcpPort, { jsonrpc: '2.0', id: 'p1', method: 'ping' }, H)).body);
      record('N5.1 ping 正常响应', !pingRes.error && pingRes.result !== undefined);

      const del = await request(onemcpPort, 'DELETE', '/mcp', undefined, { 'mcp-session-id': session });
      record('N5.2 DELETE /mcp 终止会话返回 200', del.status === 200, `status=${del.status}`);

      // 终止后同句柄重放：会话按句柄语义透明重建，客户端零感知
      let ok = true;
      try {
        await callTool(onemcpPort, session, 'n5c', 'http-main__alpha');
      } catch (e) {
        ok = false;
        record('N5.3 终止后同句柄调用透明重建', false, e.message);
      }
      if (ok) {
        const recreated = stderrBuf.text.includes('recreating transparently');
        record('N5.3 终止后同句柄调用透明重建', recreated, recreated ? '日志确认重建' : '日志中未发现重建记录');
      }
    }

    console.log('\n[F1] HTTP 后端会话过期（-32001）→ 透明重建');
    {
      backendNormal.expireAll();
      let ok = true;
      try {
        await callTool(onemcpPort, session, 'f1a', 'http-main__beta');
      } catch (e) {
        ok = false;
        record('F1.1 过期后调用透明恢复', false, e.message);
      }
      if (ok) {
        const s = backendNormal.stats();
        record('F1.1 过期后调用透明恢复', s.expiredErrors >= 1, `后端 ${s.expiredErrors} 次过期，客户端零感知`);
      }
    }

    console.log('\n[F2] HTTP 后端规范型会话过期（HTTP 404）→ 透明重建');
    {
      backend404.expireAll();
      let ok = true;
      try {
        await callTool(onemcpPort, session, 'f2a', 'http-404__alpha');
      } catch (e) {
        ok = false;
        record('F2.1 404 过期后调用透明恢复', false, e.message);
      }
      if (ok) {
        const s = backend404.stats();
        record('F2.1 404 过期后调用透明恢复', s.expiredErrors >= 1, `后端 ${s.expiredErrors} 次 404，客户端零感知`);
      }
    }

    console.log('\n[F3] stdio 后端进程崩溃 → 自动 respawn');
    {
      // fixture 设置 EXIT_AFTER_CALLS=2：响应第 2 次 tools/call 后自杀。
      // c1/c2 正常；c2 应答后进程退出 → c3 撞死连接 → 路由恢复（失效+respawn+重放）。
      let ok = true;
      try {
        await callTool(onemcpPort, session, 'f3a', 'stdio-crash__echo', { text: 'first' });
        await callTool(onemcpPort, session, 'f3b', 'stdio-crash__echo', { text: 'second' });
        await callTool(onemcpPort, session, 'f3c', 'stdio-crash__echo', { text: 'third' });
      } catch (e) {
        ok = false;
        record('F3.1 崩溃后调用自动恢复', false, e.message);
      }
      if (ok) {
        const recovered = stderrBuf.text.includes('Recoverable connection failure (tools/call echo)');
        record('F3.1 崩溃后调用自动恢复', recovered, recovered ? '3 次调用成功，日志确认走恢复路径' : '3 次调用成功，但日志中未发现恢复记录');
      }
    }

    console.log('\n[F4] 前端客户端会话句柄失效 → 透明重建');
    {
      await stopChild(child, onemcpPort);
      child = spawnOnemcp(onemcpCmd, onemcpPort, tmpDir, onStderr);
      await waitReady(onemcpPort);
      const health = await get(onemcpPort, '/health');
      record('F4.1 实例重启后 /health 正常', health.status === 200);

      let ok = true;
      try {
        await callTool(onemcpPort, session, 'f4a', 'http-main__alpha');
      } catch (e) {
        ok = false;
        record('F4.2 旧 Mcp-Session-Id 重放调用', false, e.message);
      }
      if (ok) {
        const recreated = stderrBuf.text.includes('recreating transparently');
        record('F4.2 旧 Mcp-Session-Id 重放调用', recreated, recreated ? '日志确认会话句柄透明重建' : '日志中未发现重建记录');
      }
    }

    console.log('\n[N6] 诊断端点');
    {
      const diag = JSON.parse((await get(onemcpPort, '/diagnostics')).body);
      const pools = diag.connectionPools || [];
      record(
        'N6.1 /diagnostics 暴露连接池状态',
        Array.isArray(pools) && pools.some((p) => p.serviceName === 'http-main' && p.stats),
        pools.map((p) => `${p.serviceName}:${JSON.stringify(p.stats)}`).join(' ')
      );
    }

    const failed = results.filter((r) => !r.ok);
    console.log('');
    if (failed.length === 0) {
      console.log(`E2E PASSED（${results.length}/${results.length} 项断言通过）`);
    } else {
      console.error(`E2E FAILED（${failed.length}/${results.length} 项断言失败）`);
      if (stderrBuf.text.trim()) {
        console.error(`--- onemcp stderr（末尾 2000 字符）---\n${stderrBuf.text.slice(-2000)}`);
      }
    }
  } catch (err) {
    console.error(`E2E FAILED: ${err.message}`);
    if (stderrBuf.text.trim()) console.error(`--- onemcp stderr（末尾 2000 字符）---\n${stderrBuf.text.slice(-2000)}`);
    process.exitCode = 1;
  } finally {
    await stopChild(child, onemcpPort);
    await backendNormal.close().catch(() => {});
    await backend404.close().catch(() => {});
    await sseBackend.close().catch(() => {});
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

await main();
