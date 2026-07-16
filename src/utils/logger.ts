/**
 * Unified logger for OneMCP
 *
 * All output goes to stderr so stdout stays clean for MCP JSON-RPC in CLI mode.
 */

enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

function formatMessage(level: LogLevel, message: string): string {
  return `[${level}] ${message}`;
}

export function debug(message: string): void {
  if (process.env['ONEMCP_DEBUG']) {
    process.stderr.write(formatMessage(LogLevel.DEBUG, message) + '\n');
  }
}

export function info(message: string): void {
  process.stderr.write(formatMessage(LogLevel.INFO, message) + '\n');
}

export function warn(message: string): void {
  process.stderr.write(formatMessage(LogLevel.WARN, message) + '\n');
}

export function error(message: string): void {
  process.stderr.write(formatMessage(LogLevel.ERROR, message) + '\n');
}
