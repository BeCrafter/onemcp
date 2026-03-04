/**
 * JSON-RPC 2.0 protocol type definitions
 */

/**
 * JSON-RPC 2.0 error codes
 */
export enum ErrorCode {
  // JSON-RPC standard errors
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,
  
  // MCP Router System specific errors
  TOOL_NOT_FOUND = -32001,
  TOOL_DISABLED = -32002,
  SERVICE_UNAVAILABLE = -32003,
  SERVICE_UNHEALTHY = -32004,
  CONNECTION_POOL_EXHAUSTED = -32005,
  TIMEOUT = -32006,
  VALIDATION_ERROR = -32007,
  CONFIGURATION_ERROR = -32008,
  SESSION_ERROR = -32009,
}

/**
 * JSON-RPC 2.0 error object
 */
export interface JsonRpcError {
  /** Error code */
  code: number;
  /** Error message */
  message: string;
  /** Additional error data */
  data?: {
    correlationId?: string;
    requestId?: string;
    sessionId?: string;
    serviceName?: string;
    toolName?: string;
    details?: unknown;
    stack?: string;
  };
}

/**
 * JSON-RPC 2.0 request message
 */
export interface JsonRpcRequest {
  /** JSON-RPC version */
  jsonrpc: '2.0';
  /** Request ID */
  id: string | number;
  /** Method name */
  method: string;
  /** Method parameters */
  params?: unknown;
}

/**
 * JSON-RPC 2.0 success response message
 */
export interface JsonRpcSuccessResponse {
  /** JSON-RPC version */
  jsonrpc: '2.0';
  /** Request ID */
  id: string | number;
  /** Result data */
  result: unknown;
}

/**
 * JSON-RPC 2.0 error response message
 */
export interface JsonRpcErrorResponse {
  /** JSON-RPC version */
  jsonrpc: '2.0';
  /** Request ID (can be null for parse errors) */
  id: string | number | null;
  /** Error object */
  error: JsonRpcError;
}

/**
 * JSON-RPC 2.0 notification message (no response expected)
 */
export interface JsonRpcNotification {
  /** JSON-RPC version */
  jsonrpc: '2.0';
  /** Method name */
  method: string;
  /** Method parameters */
  params?: unknown;
}

/**
 * Union type for all JSON-RPC message types
 */
export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcSuccessResponse
  | JsonRpcErrorResponse
  | JsonRpcNotification;

/**
 * Validation result for JSON-RPC messages
 */
export interface ValidationResult {
  /** Whether the validation passed */
  valid: boolean;
  /** Validation errors if any */
  errors?: Array<{
    path: string;
    message: string;
  }>;
}
