/**
 * Error propagation utilities for forwarding backend errors with context
 */

import { JsonRpcError, JsonRpcErrorResponse, ErrorCode } from '../types/jsonrpc.js';
import { RequestContext } from '../types/context.js';
import { ErrorBuilder } from './error-builder.js';
import { McpRouterError } from './custom-errors.js';

/**
 * Options for propagating errors
 */
export interface ErrorPropagationOptions {
  /** Original error from backend or system */
  error: Error | JsonRpcError;
  /** Request ID */
  requestId?: string | number;
  /** Request context */
  context?: RequestContext;
  /** Service name where error originated */
  serviceName?: string;
  /** Tool name where error originated */
  toolName?: string;
  /** Whether to include stack traces */
  includeStack?: boolean;
}

/**
 * Error propagation utility class
 */
export class ErrorPropagation {
  /**
   * Propagate an error from backend to client with added context
   */
  static propagateError(options: ErrorPropagationOptions): JsonRpcErrorResponse {
    const {
      error,
      requestId,
      context,
      serviceName,
      toolName,
      includeStack = process.env['NODE_ENV'] === 'development',
    } = options;

    // If it's already a JSON-RPC error, forward it with added context
    if (this.isJsonRpcError(error)) {
      return this.propagateJsonRpcError(error, requestId, context, serviceName, toolName);
    }

    // If it's a custom MCP Router error, convert it
    if (error instanceof McpRouterError) {
      const builderOptions: import('./error-builder.js').ErrorBuilderOptions = {
        code: error.code,
        message: error.message,
        includeStack,
        ...(requestId !== undefined && { requestId }),
        ...(context !== undefined && { context }),
        ...(serviceName !== undefined && { serviceName }),
        ...(toolName !== undefined && { toolName }),
        ...(error.details !== undefined && { details: error.details }),
        ...(error.stack !== undefined && { stack: error.stack }),
      };
      return ErrorBuilder.buildErrorResponse(builderOptions);
    }

    // If it's a standard Error, wrap it as internal error
    if (error instanceof Error) {
      const builderOptions: import('./error-builder.js').ErrorBuilderOptions = {
        code: ErrorCode.INTERNAL_ERROR,
        message: error.message,
        includeStack,
        ...(requestId !== undefined && { requestId }),
        ...(context !== undefined && { context }),
        ...(serviceName !== undefined && { serviceName }),
        ...(toolName !== undefined && { toolName }),
        details: { name: error.name, message: error.message },
        ...(error.stack !== undefined && { stack: error.stack }),
      };
      return ErrorBuilder.buildErrorResponse(builderOptions);
    }

    // Should not reach here given the type, but handle defensively
    return ErrorBuilder.internalError('An unknown error occurred', requestId, context);
  }

  /**
   * Propagate a JSON-RPC error with added context
   */
  private static propagateJsonRpcError(
    error: JsonRpcError,
    requestId?: string | number,
    context?: RequestContext,
    serviceName?: string,
    toolName?: string
  ): JsonRpcErrorResponse {
    // Add routing context to the error data
    const enhancedData = {
      ...error.data,
      ...(context?.correlationId && { correlationId: context.correlationId }),
      ...(context?.requestId && { requestId: context.requestId }),
      ...(context?.sessionId && { sessionId: context.sessionId }),
      ...(serviceName && { serviceName }),
      ...(toolName && { toolName }),
      // Mark as propagated from backend
      propagatedFrom: 'backend',
    };

    return {
      jsonrpc: '2.0',
      id: requestId ?? null,
      error: {
        ...error,
        data: enhancedData,
      },
    };
  }

  /**
   * Check if an error is a JSON-RPC error
   */
  private static isJsonRpcError(error: unknown): error is JsonRpcError {
    return (
      typeof error === 'object' &&
      error !== null &&
      !(error instanceof Error) && // Exclude Error instances (including McpRouterError)
      'code' in error &&
      'message' in error &&
      typeof (error as JsonRpcError).code === 'number' &&
      typeof (error as JsonRpcError).message === 'string'
    );
  }

  /**
   * Extract error message from any error type
   */
  static extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (this.isJsonRpcError(error)) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return 'An unknown error occurred';
  }

  /**
   * Extract error code from any error type
   */
  static extractErrorCode(error: unknown): ErrorCode {
    if (error instanceof McpRouterError) {
      return error.code;
    }
    if (this.isJsonRpcError(error)) {
      return error.code;
    }
    return ErrorCode.INTERNAL_ERROR;
  }
}
