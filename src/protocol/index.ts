/**
 * Protocol Layer
 * 
 * Handles JSON-RPC 2.0 protocol parsing, validation, and serialization.
 */

export { JsonRpcParser } from './parser.js';
export { JsonRpcSerializer } from './serializer.js';
export { McpProtocolHandler } from './mcp-handler.js';
export type {
  InitializeParams,
  InitializeResult,
  ToolsListParams,
  ToolCallParams,
  BatchRequest,
} from './mcp-handler.js';
