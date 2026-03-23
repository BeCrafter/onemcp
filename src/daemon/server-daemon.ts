/**
 * Server Daemon Management
 *
 * Utilities for managing the OneMCP server as a background daemon process.
 * Handles PID file management, process lifecycle, log tailing, and status reporting.
 */

import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  openSync,
  closeSync,
  createReadStream,
  statSync,
  watchFile,
  unwatchFile,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { platform } from 'node:os';
import { execSync } from 'node:child_process';

const isWindows = platform() === 'win32';

// ─────────────────────────────────────────────
// File paths
// ─────────────────────────────────────────────

export function getPidFilePath(configDir: string): string {
  return resolve(configDir, 'server.pid');
}

export function getLogFilePath(configDir: string): string {
  return resolve(configDir, 'logs', 'server.log');
}

export function getMetaFilePath(configDir: string): string {
  return resolve(configDir, 'server-meta.json');
}

// ─────────────────────────────────────────────
// Meta file (stores port + start time + args for restart)
// ─────────────────────────────────────────────

interface DaemonMeta {
  startTime: number;
  port: number;
  args: string[];
}

export function writeMeta(configDir: string, meta: DaemonMeta): void {
  writeFileSync(getMetaFilePath(configDir), JSON.stringify(meta, null, 2), 'utf8');
}

export function readMeta(configDir: string): DaemonMeta | null {
  const metaFile = getMetaFilePath(configDir);
  if (!existsSync(metaFile)) return null;
  try {
    return JSON.parse(readFileSync(metaFile, 'utf8')) as DaemonMeta;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// PID file
// ─────────────────────────────────────────────

export function writePidFile(configDir: string, pid: number): void {
  writeFileSync(getPidFilePath(configDir), String(pid), 'utf8');
}

export function readPidFile(configDir: string): number | null {
  const pidFile = getPidFilePath(configDir);
  if (!existsSync(pidFile)) return null;
  try {
    const raw = readFileSync(pidFile, 'utf8').trim();
    const pid = parseInt(raw, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export function removePidFile(configDir: string): void {
  const pidFile = getPidFilePath(configDir);
  if (existsSync(pidFile)) {
    try {
      unlinkSync(pidFile);
    } catch {
      // best-effort
    }
  }
}

// ─────────────────────────────────────────────
// Process check
// ─────────────────────────────────────────────

export function isProcessRunning(pid: number): boolean {
  try {
    if (isWindows) {
      const output = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: 'utf8' });
      return output.includes(String(pid));
    } else {
      process.kill(pid, 0);
      return true;
    }
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────
// Daemon status
// ─────────────────────────────────────────────

export interface DaemonStatus {
  running: boolean;
  pid: number | null;
  port: number | null;
  startTime: Date | null;
  uptimeSeconds: number | null;
  logFile: string;
  pidFile: string;
}

export function getDaemonStatus(configDir: string): DaemonStatus {
  const pidFile = getPidFilePath(configDir);
  const logFile = getLogFilePath(configDir);
  const pid = readPidFile(configDir);

  if (pid === null) {
    return {
      running: false,
      pid: null,
      port: null,
      startTime: null,
      uptimeSeconds: null,
      logFile,
      pidFile,
    };
  }

  if (!isProcessRunning(pid)) {
    // stale PID file
    removePidFile(configDir);
    return {
      running: false,
      pid: null,
      port: null,
      startTime: null,
      uptimeSeconds: null,
      logFile,
      pidFile,
    };
  }

  const meta = readMeta(configDir);
  const startTime = meta ? new Date(meta.startTime) : null;
  const uptimeSeconds = startTime ? Math.floor((Date.now() - startTime.getTime()) / 1000) : null;

  return {
    running: true,
    pid,
    port: meta?.port ?? null,
    startTime,
    uptimeSeconds,
    logFile,
    pidFile,
  };
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function printDaemonStatus(configDir: string): void {
  const status = getDaemonStatus(configDir);
  if (!status.running) {
    process.stdout.write('Status:  stopped\n');
    process.stdout.write(`PID file: ${status.pidFile}\n`);
    process.stdout.write(`Log:     ${status.logFile}\n`);
    return;
  }
  process.stdout.write('Status:  running\n');
  process.stdout.write(`PID:     ${status.pid}\n`);
  if (status.port !== null) process.stdout.write(`Port:    ${status.port}\n`);
  if (status.startTime) process.stdout.write(`Started: ${status.startTime.toLocaleString()}\n`);
  if (status.uptimeSeconds !== null)
    process.stdout.write(`Uptime:  ${formatUptime(status.uptimeSeconds)}\n`);
  process.stdout.write(`Log:     ${status.logFile}\n`);
}

// ─────────────────────────────────────────────
// Spawn daemon
// ─────────────────────────────────────────────

export function spawnDaemon(
  scriptPath: string,
  childArgs: string[],
  configDir: string,
  port: number
): void {
  const logFile = getLogFilePath(configDir);
  mkdirSync(dirname(logFile), { recursive: true });

  const logFd = openSync(logFile, 'a');

  // When running TypeScript source directly (e.g. via tsx in dev mode),
  // we need to use tsx as the executor, not plain node.
  const isTsSource =
    scriptPath.endsWith('.ts') || scriptPath.endsWith('.mts') || scriptPath.endsWith('.cts');

  let execCmd: string;
  let execArgs: string[];

  if (isTsSource) {
    // Locate tsx: prefer local node_modules/.bin/tsx, fall back to global 'tsx'
    const localTsx = resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
    execCmd = existsSync(localTsx) ? localTsx : 'tsx';
    execArgs = [scriptPath, ...childArgs];
  } else {
    execCmd = process.execPath;
    execArgs = [scriptPath, ...childArgs];
  }

  const child = spawn(execCmd, execArgs, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, ONEMCP_DAEMON: '1' },
  });

  closeSync(logFd);

  if (!child.pid) {
    process.stderr.write('Failed to start daemon process\n');
    process.exit(1);
  }

  writePidFile(configDir, child.pid);
  writeMeta(configDir, { startTime: Date.now(), port, args: childArgs });

  child.unref();

  process.stdout.write(`Server started in background (PID ${child.pid})\n`);
  process.stdout.write(`Log: ${logFile}\n`);
}

// ─────────────────────────────────────────────
// Stop daemon
// ─────────────────────────────────────────────

export async function stopDaemon(configDir: string): Promise<void> {
  const pid = readPidFile(configDir);

  if (pid === null) {
    process.stdout.write('Server is not running\n');
    process.exit(1);
  }

  if (!isProcessRunning(pid)) {
    process.stdout.write('Server is not running (stale PID file removed)\n');
    removePidFile(configDir);
    process.exit(0);
  }

  // Send SIGTERM (Windows: process.kill uses default)
  try {
    if (isWindows) {
      process.kill(pid);
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
    process.stdout.write(`Failed to send signal to PID ${pid}\n`);
    process.exit(1);
  }

  // Poll up to 10 seconds
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    if (!isProcessRunning(pid)) {
      removePidFile(configDir);
      process.stdout.write('Server stopped\n');
      return;
    }
  }

  // Force kill
  try {
    if (isWindows) {
      execSync(`taskkill /F /PID ${pid}`);
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch {
    // best-effort
  }

  removePidFile(configDir);
  process.stdout.write('Server stopped (forced)\n');
}

// ─────────────────────────────────────────────
// Restart daemon
// ─────────────────────────────────────────────

export async function restartDaemon(configDir: string, scriptPath: string): Promise<void> {
  const meta = readMeta(configDir);
  if (!meta) {
    process.stderr.write('No daemon meta found. Please start the server with --daemon first.\n');
    process.exit(1);
  }

  await stopDaemon(configDir);

  // Brief pause for port to release
  await new Promise((r) => setTimeout(r, 500));

  spawnDaemon(scriptPath, meta.args, configDir, meta.port);
}

// ─────────────────────────────────────────────
// Show logs
// ─────────────────────────────────────────────

export function showLogs(configDir: string, lines: number, follow: boolean): void {
  const logFile = getLogFilePath(configDir);

  if (!existsSync(logFile)) {
    process.stderr.write(`Log file not found: ${logFile}\n`);
    process.exit(1);
  }

  if (follow) {
    // Print last N lines then follow
    printLastLines(logFile, lines);
    let position = statSync(logFile).size;
    process.stdout.write('\n--- Following log (Ctrl+C to stop) ---\n');

    watchFile(logFile, { interval: 200 }, () => {
      const size = statSync(logFile).size;
      if (size > position) {
        const stream = createReadStream(logFile, { start: position, end: size - 1 });
        stream.pipe(process.stdout);
        position = size;
      }
    });

    process.on('SIGINT', () => {
      unwatchFile(logFile);
      process.exit(0);
    });
  } else {
    printLastLines(logFile, lines);
  }
}

function printLastLines(filePath: string, n: number): void {
  const CHUNK = Math.max(n * 200, 8192);
  const stat = statSync(filePath);
  const start = Math.max(0, stat.size - CHUNK);

  const buf: Buffer[] = [];
  const stream = createReadStream(filePath, { start, end: stat.size - 1 });

  stream.on('data', (chunk) => buf.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  stream.on('end', () => {
    const text = Buffer.concat(buf).toString('utf8');
    const allLines = text.split('\n');
    // If we read a partial first line, drop it (unless we read from position 0)
    const slice = start > 0 ? allLines.slice(1) : allLines;
    const last = slice.slice(-n).join('\n');
    process.stdout.write(last + '\n');
  });
}
