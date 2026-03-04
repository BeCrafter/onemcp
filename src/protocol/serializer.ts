/**
 * JSON-RPC 2.0 Serializer
 * 
 * Serializes JSON-RPC 2.0 messages according to the specification.
 */

import type { JsonRpcMessage } from '../types/jsonrpc.js';

/**
 * JSON-RPC 2.0 Serializer class
 * 
 * Provides methods to serialize JSON-RPC 2.0 messages.
 */
export class JsonRpcSerializer {
  /**
   * Serialize a JSON-RPC 2.0 message to a JSON string
   * 
   * @param message - JSON-RPC message to serialize
   * @returns Serialized JSON string
   */
  serialize(message: JsonRpcMessage): string {
    return JSON.stringify(message);
  }

  /**
   * Pretty-print a JSON-RPC 2.0 message for logging
   * 
   * @param message - JSON-RPC message to format
   * @param indent - Number of spaces for indentation (default: 2)
   * @returns Formatted JSON string with indentation
   */
  prettyPrint(message: JsonRpcMessage, indent: number = 2): string {
    return JSON.stringify(message, null, indent);
  }
}
