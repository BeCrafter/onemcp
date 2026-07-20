/**
 * Unified logger for OneMCP
 *
 * Logs to stderr by default. Call setupLogFile() to also write to a file.
 * Call setStderrEnabled(false) in TUI mode to suppress terminal output.
 */

import { mkdirSync, createWriteStream, type WriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

function formatMessage(level: LogLevel, message: string): string {
  return `[${level}] ${message}`;
}

let logStream: WriteStream | null = null;
let stderrEnabled = true;

function writeToFile(line: string): void {
  if (logStream !== null) {
    logStream.write(line);
  }
}

function resolveConfigDir(dir?: string): string {
  const configDir = dir ?? process.env['ONEMCP_CONFIG_DIR'] ?? resolve(homedir(), '.onemcp');
  return resolve(configDir);
}

/**
 * Configure file-based logging. Creates the parent directory if needed.
 * Call once at startup before any log output.
 */
export function setupLogFile(configDir?: string): void {
  const dir = resolveConfigDir(configDir);
  mkdirSync(dir, { recursive: true });
  logStream = createWriteStream(resolve(dir, 'onemcp.log'), { flags: 'a' });
}

/**
 * Enable or disable stderr output.
 * In TUI mode, call setStderrEnabled(false) to keep the terminal clean.
 */
export function setStderrEnabled(enabled: boolean): void {
  stderrEnabled = enabled;
}

export function debug(message: string): void {
  if (process.env['ONEMCP_DEBUG']) {
    const line = formatMessage(LogLevel.DEBUG, message) + '\n';
    if (stderrEnabled) process.stderr.write(line);
    writeToFile(line);
  }
}

export function info(message: string): void {
  const line = formatMessage(LogLevel.INFO, message) + '\n';
  if (stderrEnabled) process.stderr.write(line);
  writeToFile(line);
}

export function warn(message: string): void {
  const line = formatMessage(LogLevel.WARN, message) + '\n';
  if (stderrEnabled) process.stderr.write(line);
  writeToFile(line);
}

export function error(message: string): void {
  const line = formatMessage(LogLevel.ERROR, message) + '\n';
  if (stderrEnabled) process.stderr.write(line);
  writeToFile(line);
}
