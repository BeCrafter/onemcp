/**
 * Configuration-driven logging for OneMCP.
 *
 * Stdout is intentionally never used so CLI JSON-RPC framing remains intact.
 */

import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import type { SystemConfig } from '../types/config.js';

export type LogContext = Record<string, unknown>;

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

interface LoggerOptions {
  level: LogLevel;
  console: boolean;
  filePath: string | null;
  format: 'json' | 'pretty';
  maskingEnabled: boolean;
  maskingPatterns: string[];
}

let options: LoggerOptions = {
  level: 'INFO',
  console: true,
  filePath: null,
  format: 'pretty',
  maskingEnabled: true,
  maskingPatterns: ['password', 'token', 'secret', 'key'],
};
let logStream: WriteStream | null = null;
let stderrEnabled = true;

function resolveFilePath(config: SystemConfig): string {
  const configured = config.logging?.filePath;
  if (configured === undefined || configured.length === 0) {
    return resolve(
      config.configDir ?? process.env['ONEMCP_CONFIG_DIR'] ?? resolve(homedir(), '.onemcp'),
      'onemcp.log'
    );
  }
  return isAbsolute(configured) ? configured : resolve(config.configDir, configured);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function maskString(value: string): string {
  if (!options.maskingEnabled) {
    return value;
  }

  let masked = value;
  for (const pattern of options.maskingPatterns) {
    const escaped = escapeRegex(pattern);
    const assignment = new RegExp(`(${escaped})\\s*[:=]\\s*([^\\s,}\\]]+)`, 'gi');
    masked = masked.replace(assignment, '$1=***MASKED***');
  }
  return masked;
}

function maskValue(value: unknown, key?: string): unknown {
  if (!options.maskingEnabled) {
    return value;
  }
  if (
    key !== undefined &&
    options.maskingPatterns.some((pattern) => new RegExp(escapeRegex(pattern), 'i').test(key))
  ) {
    return '***MASKED***';
  }
  if (Array.isArray(value)) {
    return value.map((entry) => maskValue(entry));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        maskValue(entryValue, entryKey),
      ])
    );
  }
  return value;
}

function shouldLog(level: LogLevel): boolean {
  return (
    process.env['ONEMCP_DEBUG'] === '1' || LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[options.level]
  );
}

function formatLine(level: LogLevel, message: string, context?: LogContext): string {
  const timestamp = new Date().toISOString();
  const safeMessage = maskString(message);
  const safeContext = context === undefined ? undefined : (maskValue(context) as LogContext);
  if (options.format === 'json') {
    return (
      JSON.stringify({
        timestamp,
        level,
        message: safeMessage,
        ...(safeContext === undefined ? {} : safeContext),
      }) + '\n'
    );
  }
  const contextSuffix = safeContext === undefined ? '' : ` ${JSON.stringify(safeContext)}`;
  return `${timestamp} [${level}] ${safeMessage}${contextSuffix}\n`;
}

function openLogFile(filePath: string): void {
  mkdirSync(resolve(filePath, '..'), { recursive: true });
  const stream = createWriteStream(filePath, { flags: 'a' });
  stream.on('error', () => {
    if (logStream === stream) {
      logStream = null;
    }
  });
  logStream = stream;
}

/** Configures logger sinks, formatting, levels, and sensitive-value masking. */
export function configureLogger(config: SystemConfig): void {
  const logging = config.logging;
  options = {
    level: logging?.level ?? config.logLevel,
    console: logging?.outputs.includes('console') ?? true,
    filePath: logging?.outputs.includes('file') ? resolveFilePath(config) : null,
    format: logging?.format ?? 'pretty',
    maskingEnabled: config.security.dataMasking.enabled,
    maskingPatterns: config.security.dataMasking.patterns,
  };

  if (logStream !== null) {
    logStream.end();
    logStream = null;
  }
  const filePath = options.filePath;
  if (filePath !== null) {
    openLogFile(filePath);
  }
}

/** Backward-compatible file-sink helper for callers without loaded SystemConfig. */
export function setupLogFile(configDir?: string): void {
  const directory = configDir ?? process.env['ONEMCP_CONFIG_DIR'] ?? resolve(homedir(), '.onemcp');
  const filePath = resolve(directory, 'onemcp.log');
  options = { ...options, filePath };
  if (logStream !== null) {
    logStream.end();
    logStream = null;
  }
  openLogFile(filePath);
}

/** Enables or suppresses the configured stderr sink for interactive modes. */
export function setStderrEnabled(enabled: boolean): void {
  stderrEnabled = enabled;
}

/** Flushes and closes the file sink during application shutdown. */
export async function closeLogger(): Promise<void> {
  const stream = logStream;
  logStream = null;
  if (stream === null) {
    return;
  }
  await new Promise<void>((resolve) => stream.end(resolve));
}

function write(level: LogLevel, message: string, context?: LogContext): void {
  if (!shouldLog(level)) {
    return;
  }
  const line = formatLine(level, message, context);
  if (stderrEnabled && options.console) {
    process.stderr.write(line);
  }
  logStream?.write(line);
}

export function debug(message: string, context?: LogContext): void {
  write('DEBUG', message, context);
}

export function info(message: string, context?: LogContext): void {
  write('INFO', message, context);
}

export function warn(message: string, context?: LogContext): void {
  write('WARN', message, context);
}

export function error(message: string, context?: LogContext): void {
  write('ERROR', message, context);
}
