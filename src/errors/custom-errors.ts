/**
 * Custom error classes for the MCP Router System
 */

import { ErrorCode } from '../types/jsonrpc.js';

/**
 * Base error class for MCP Router errors
 */
export class McpRouterError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Tool not found error
 */
export class ToolNotFoundError extends McpRouterError {
  constructor(toolName: string) {
    super(`Tool not found: ${toolName}`, ErrorCode.TOOL_NOT_FOUND, { toolName });
  }
}

/**
 * Tool disabled error
 */
export class ToolDisabledError extends McpRouterError {
  constructor(toolName: string) {
    super(`Tool is disabled: ${toolName}`, ErrorCode.TOOL_DISABLED, { toolName });
  }
}

/**
 * Service unavailable error
 */
export class ServiceUnavailableError extends McpRouterError {
  constructor(serviceName: string, reason?: string) {
    super(
      `Service unavailable: ${serviceName}${reason ? ` (${reason})` : ''}`,
      ErrorCode.SERVICE_UNAVAILABLE,
      { serviceName, reason }
    );
  }
}

/**
 * Service unhealthy error
 */
export class ServiceUnhealthyError extends McpRouterError {
  constructor(serviceName: string, reason?: string) {
    super(
      `Service is unhealthy: ${serviceName}${reason ? ` (${reason})` : ''}`,
      ErrorCode.SERVICE_UNHEALTHY,
      { serviceName, reason }
    );
  }
}

/**
 * Connection pool exhausted error
 */
export class ConnectionPoolExhaustedError extends McpRouterError {
  constructor(serviceName: string) {
    super(
      `Connection pool exhausted for service: ${serviceName}`,
      ErrorCode.CONNECTION_POOL_EXHAUSTED,
      { serviceName }
    );
  }
}

/**
 * Timeout error
 */
export class TimeoutError extends McpRouterError {
  constructor(message: string, timeoutMs: number) {
    super(message, ErrorCode.TIMEOUT, { timeoutMs });
  }
}

/**
 * Validation error
 */
export class ValidationError extends McpRouterError {
  constructor(message: string, validationErrors?: unknown) {
    super(message, ErrorCode.VALIDATION_ERROR, validationErrors);
  }
}

/**
 * Configuration error
 */
export class ConfigurationError extends McpRouterError {
  constructor(message: string, details?: unknown) {
    super(message, ErrorCode.CONFIGURATION_ERROR, details);
  }
}

/**
 * Session error
 */
export class SessionError extends McpRouterError {
  constructor(message: string, details?: unknown) {
    super(message, ErrorCode.SESSION_ERROR, details);
  }
}

/**
 * Parse error
 */
export class ParseError extends McpRouterError {
  constructor(message: string, details?: unknown) {
    super(message, ErrorCode.PARSE_ERROR, details);
  }
}

/**
 * Invalid request error
 */
export class InvalidRequestError extends McpRouterError {
  constructor(message: string, details?: unknown) {
    super(message, ErrorCode.INVALID_REQUEST, details);
  }
}

/**
 * Method not found error
 */
export class MethodNotFoundError extends McpRouterError {
  constructor(method: string) {
    super(`Method not found: ${method}`, ErrorCode.METHOD_NOT_FOUND, { method });
  }
}

/**
 * Invalid params error
 */
export class InvalidParamsError extends McpRouterError {
  constructor(message: string, details?: unknown) {
    super(message, ErrorCode.INVALID_PARAMS, details);
  }
}
