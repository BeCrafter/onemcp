/**
 * Unified logger for OneMCP
 *
 * Provides consistent log format: [LEVEL] message
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

function formatMessage(level: LogLevel, message: string, service?: string): string {
  const prefix = service ? `[${service}] ` : '';
  return `[${level}] ${prefix}${message}`;
}

export function debug(message: string, service?: string): void {
  if (process.env['ONEMCP_DEBUG']) {
    process.stderr.write(formatMessage(LogLevel.DEBUG, message, service) + '\n');
  }
}

export function info(message: string, service?: string): void {
  process.stderr.write(formatMessage(LogLevel.INFO, message, service) + '\n');
}

export function warn(message: string, service?: string): void {
  process.stderr.write(formatMessage(LogLevel.WARN, message, service) + '\n');
}

export function error(message: string, service?: string): void {
  process.stderr.write(formatMessage(LogLevel.ERROR, message, service) + '\n');
}
