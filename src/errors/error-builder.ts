/**
 * Error response builder for JSON-RPC 2.0 compliant error responses
 */

import { ErrorCode, JsonRpcError, JsonRpcErrorResponse } from '../types/jsonrpc.js';
import { RequestContext } from '../types/context.js';

/**
 * Options for building error responses
 */
export interface ErrorBuilderOptions {
  /** Error code */
  code: ErrorCode;
  /** Error message */
  message: string;
  /** Request ID (can be null for parse errors) */
  requestId?: string | number | null;
  /** Request context for additional data */
  context?: RequestContext;
  /** Service name if error is service-related */
  serviceName?: string;
  /** Tool name if error is tool-related */
  toolName?: string;
  /** Additional error details */
  details?: unknown;
  /** Stack trace (only included in debug mode) */
  stack?: string;
  /** Whether to include stack trace */
  includeStack?: boolean;
}

/**
 * Error response builder class
 */
export class ErrorBuilder {
  /**
   * Build a JSON-RPC 2.0 error response
   */
  static buildErrorResponse(options: ErrorBuilderOptions): JsonRpcErrorResponse {
    const {
      code,
      message,
      requestId,
      context,
      serviceName,
      toolName,
      details,
      stack,
      includeStack = false,
    } = options;

    const error: JsonRpcError = {
      code,
      message,
      data: {
        ...(context?.correlationId && { correlationId: context.correlationId }),
        ...(context?.requestId && { requestId: context.requestId }),
        ...(context?.sessionId && { sessionId: context.sessionId }),
        ...(serviceName && { serviceName }),
        ...(toolName && { toolName }),
        ...(details !== undefined && { details }),
        ...(includeStack && stack && { stack }),
      },
    };

    // Remove data if empty
    if (Object.keys(error.data || {}).length === 0) {
      delete error.data;
    }

    return {
      jsonrpc: '2.0',
      id: requestId ?? null,
      error,
    };
  }

  /**
   * Build a parse error response
   */
  static parseError(message = 'Parse error', details?: unknown): JsonRpcErrorResponse {
    const options: ErrorBuilderOptions = {
      code: ErrorCode.PARSE_ERROR,
      message,
      details,
    };
    return this.buildErrorResponse(options);
  }

  /**
   * Build an invalid request error response
   */
  static invalidRequest(
    message = 'Invalid request',
    requestId?: string | number,
    details?: unknown
  ): JsonRpcErrorResponse {
    const options: ErrorBuilderOptions = {
      code: ErrorCode.INVALID_REQUEST,
      message,
      ...(requestId !== undefined && { requestId }),
      ...(details !== undefined && { details }),
    };
    return this.buildErrorResponse(options);
  }

  /**
   * Build a method not found error response
   */
  static methodNotFound(
    method: string,
    requestId?: string | number,
    context?: RequestContext
  ): JsonRpcErrorResponse {
    const options: ErrorBuilderOptions = {
      code: ErrorCode.METHOD_NOT_FOUND,
      message: `Method not found: ${method}`,
      details: { method },
      ...(requestId !== undefined && { requestId }),
      ...(context !== undefined && { context }),
    };
    return this.buildErrorResponse(options);
  }

  /**
   * Build an invalid params error response
   */
  static invalidParams(
    message: string,
    requestId?: string | number,
    context?: RequestContext,
    details?: unknown
  ): JsonRpcErrorResponse {
    const options: ErrorBuilderOptions = {
      code: ErrorCode.INVALID_PARAMS,
      message,
      ...(requestId !== undefined && { requestId }),
      ...(context !== undefined && { context }),
      ...(details !== undefined && { details }),
    };
    return this.buildErrorResponse(options);
  }

  /**
   * Build an internal error response
   */
  static internalError(
    message = 'Internal error',
    requestId?: string | number,
    context?: RequestContext,
    error?: Error
  ): JsonRpcErrorResponse {
    const options: ErrorBuilderOptions = {
      code: ErrorCode.INTERNAL_ERROR,
      message,
      includeStack: process.env['NODE_ENV'] === 'development',
      ...(requestId !== undefined && { requestId }),
      ...(context !== undefined && { context }),
      ...(error && { details: { name: error.name, message: error.message } }),
      ...(error?.stack && { stack: error.stack }),
    };
    return this.buildErrorResponse(options);
  }

  /**
   * Build a tool not found error response
   */
  static toolNotFound(
    toolName: string,
    requestId?: string | number,
    context?: RequestContext
  ): JsonRpcErrorResponse {
    const options: ErrorBuilderOptions = {
      code: ErrorCode.TOOL_NOT_FOUND,
      message: `Tool not found: ${toolName}`,
      toolName,
      ...(requestId !== undefined && { requestId }),
      ...(context !== undefined && { context }),
    };
    return this.buildErrorResponse(options);
  }

  /**
   * Build a tool disabled error response
   */
  static toolDisabled(
    toolName: string,
    requestId?: string | number,
    context?: RequestContext
  ): JsonRpcErrorResponse {
    const options: ErrorBuilderOptions = {
      code: ErrorCode.TOOL_DISABLED,
      message: `Tool is disabled: ${toolName}`,
      toolName,
      ...(requestId !== undefined && { requestId }),
      ...(context !== undefined && { context }),
    };
    return this.buildErrorResponse(options);
  }

  /**
   * Build a service unavailable error response
   */
  static serviceUnavailable(
    serviceName: string,
    requestId?: string | number,
    context?: RequestContext,
    details?: unknown
  ): JsonRpcErrorResponse {
    const options: ErrorBuilderOptions = {
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: `Service unavailable: ${serviceName}`,
      serviceName,
      ...(requestId !== undefined && { requestId }),
      ...(context !== undefined && { context }),
      ...(details !== undefined && { details }),
    };
    return this.buildErrorResponse(options);
  }

  /**
   * Build a service unhealthy error response
   */
  static serviceUnhealthy(
    serviceName: string,
    requestId?: string | number,
    context?: RequestContext,
    details?: unknown
  ): JsonRpcErrorResponse {
    const options: ErrorBuilderOptions = {
      code: ErrorCode.SERVICE_UNHEALTHY,
      message: `Service is unhealthy: ${serviceName}`,
      serviceName,
      ...(requestId !== undefined && { requestId }),
      ...(context !== undefined && { context }),
      ...(details !== undefined && { details }),
    };
    return this.buildErrorResponse(options);
  }

  /**
   * Build a connection pool exhausted error response
   */
  static connectionPoolExhausted(
    serviceName: string,
    requestId?: string | number,
    context?: RequestContext
  ): JsonRpcErrorResponse {
    const options: ErrorBuilderOptions = {
      code: ErrorCode.CONNECTION_POOL_EXHAUSTED,
      message: `Connection pool exhausted for service: ${serviceName}`,
      serviceName,
      ...(requestId !== undefined && { requestId }),
      ...(context !== undefined && { context }),
    };
    return this.buildErrorResponse(options);
  }

  /**
   * Build a timeout error response
   */
  static timeout(
    message: string,
    requestId?: string | number,
    context?: RequestContext,
    timeoutMs?: number
  ): JsonRpcErrorResponse {
    const options: ErrorBuilderOptions = {
      code: ErrorCode.TIMEOUT,
      message,
      ...(requestId !== undefined && { requestId }),
      ...(context !== undefined && { context }),
      ...(timeoutMs !== undefined && { details: { timeoutMs } }),
    };
    return this.buildErrorResponse(options);
  }

  /**
   * Build a validation error response
   */
  static validationError(
    message: string,
    requestId?: string | number,
    context?: RequestContext,
    validationErrors?: unknown
  ): JsonRpcErrorResponse {
    const options: ErrorBuilderOptions = {
      code: ErrorCode.VALIDATION_ERROR,
      message,
      ...(requestId !== undefined && { requestId }),
      ...(context !== undefined && { context }),
      ...(validationErrors !== undefined && { details: validationErrors }),
    };
    return this.buildErrorResponse(options);
  }

  /**
   * Build a configuration error response
   */
  static configurationError(
    message: string,
    requestId?: string | number,
    context?: RequestContext,
    details?: unknown
  ): JsonRpcErrorResponse {
    const options: ErrorBuilderOptions = {
      code: ErrorCode.CONFIGURATION_ERROR,
      message,
      ...(requestId !== undefined && { requestId }),
      ...(context !== undefined && { context }),
      ...(details !== undefined && { details }),
    };
    return this.buildErrorResponse(options);
  }

  /**
   * Build a session error response
   */
  static sessionError(
    message: string,
    requestId?: string | number,
    context?: RequestContext,
    details?: unknown
  ): JsonRpcErrorResponse {
    const options: ErrorBuilderOptions = {
      code: ErrorCode.SESSION_ERROR,
      message,
      ...(requestId !== undefined && { requestId }),
      ...(context !== undefined && { context }),
      ...(details !== undefined && { details }),
    };
    return this.buildErrorResponse(options);
  }
}
