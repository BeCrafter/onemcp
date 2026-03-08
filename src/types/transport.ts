/**
 * Transport layer type definitions
 */

import type { JsonRpcMessage } from './jsonrpc.js';
import type { TransportType } from './service.js';

/**
 * Transport interface for communication with MCP servers
 */
export interface Transport {
  /**
   * Send a message to the server/client
   */
  send(message: JsonRpcMessage): Promise<void>;

  /**
   * Receive messages (returns async iterator)
   */
  receive(): AsyncIterator<JsonRpcMessage>;

  /**
   * Close the connection
   */
  close(): Promise<void>;

  /**
   * Get the transport type
   */
  getType(): TransportType;
}
