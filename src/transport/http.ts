/**
 * HTTP Transport implementation for MCP servers using SSE and Streamable HTTP protocols
 */

import EventSource from 'eventsource';
import fetch from 'node-fetch';
import { BaseTransport, TransportError } from './base.js';
import type { JsonRpcMessage } from '../types/jsonrpc.js';
import type { TransportType } from '../types/service.js';

/**
 * HTTP transport mode
 */
export type HttpTransportMode = 'sse' | 'http';

/**
 * Configuration for HttpTransport
 */
export interface HttpTransportConfig {
  /** Server URL */
  url: string;
  /** Transport mode (SSE or Streamable HTTP) */
  mode: HttpTransportMode;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Maximum reconnection attempts */
  maxReconnectAttempts?: number;
  /** Initial reconnection delay in milliseconds */
  reconnectDelay?: number;
  /** Custom HTTP headers */
  headers?: Record<string, string>;
}

/**
 * HttpTransport implementation for SSE and Streamable HTTP protocols
 * Handles connection errors and reconnection logic
 */
export class HttpTransport extends BaseTransport {
  private eventSource: EventSource | null = null;
  private messageQueue: JsonRpcMessage[] = [];
  private resolveQueue: Array<(value: IteratorResult<JsonRpcMessage>) => void> = [];
  private rejectQueue: Array<(error: Error) => void> = [];
  private receiveClosed = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly timeout: number;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectDelay: number;
  private sessionId: string | null = null;

  constructor(private config: HttpTransportConfig) {
    super();
    this.timeout = config.timeout || 30000; // 30 seconds default
    this.maxReconnectAttempts = config.maxReconnectAttempts || 3;
    this.reconnectDelay = config.reconnectDelay || 1000; // 1 second default

    if (config.mode === 'sse') {
      this.initializeSSE();
    } else {
      // For HTTP mode, mark as connected immediately
      // Actual connection happens per-request
      this.setConnected();
    }
  }

  /**
   * Get the transport type
   */
  public getType(): TransportType {
    return this.config.mode === 'sse' ? 'sse' : 'http';
  }

  /**
   * Initialize SSE connection
   */
  private initializeSSE(): void {
    try {
      this.eventSource = new EventSource(this.config.url);

      // Handle incoming messages
      this.eventSource.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as JsonRpcMessage;
          this.enqueueMessage(message);
        } catch (error) {
          console.error('Failed to parse SSE message:', error);
        }
      };

      // Handle connection open
      this.eventSource.onopen = () => {
        this.reconnectAttempts = 0;
        this.setConnected();
      };

      // Handle errors
      this.eventSource.onerror = (error) => {
        this.handleSSEError(error);
      };
    } catch (error) {
      this.handleError(
        new TransportError(
          `Failed to initialize SSE: ${error instanceof Error ? error.message : String(error)}`,
          'SSE_INIT_FAILED',
          error instanceof Error ? error : undefined
        )
      );
      throw error;
    }
  }

  /**
   * Handle SSE errors and implement reconnection logic
   */
  private handleSSEError(_error: Event): void {
    // Check if we should attempt reconnection
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff

      console.warn(
        `SSE connection error, attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`
      );

      this.reconnectTimer = setTimeout(() => {
        if (this.eventSource) {
          this.eventSource.close();
        }
        this.initializeSSE();
      }, delay);
    } else {
      // Max reconnection attempts reached
      this.handleError(
        new TransportError(
          `SSE connection failed after ${this.maxReconnectAttempts} attempts`,
          'SSE_CONNECTION_FAILED'
        )
      );

      // Reject all waiting receivers
      const transportError = new TransportError('SSE connection lost', 'SSE_CONNECTION_LOST');
      while (this.rejectQueue.length > 0) {
        const reject = this.rejectQueue.shift()!;
        reject(transportError);
      }
    }
  }

  /**
   * Enqueue a received message
   */
  private enqueueMessage(message: JsonRpcMessage): void {
    if (this.resolveQueue.length > 0) {
      // If there's a waiting receiver, resolve it immediately
      const resolve = this.resolveQueue.shift()!;
      resolve({ value: message, done: false });
    } else {
      // Otherwise, add to message queue
      this.messageQueue.push(message);
    }
  }

  /**
   * Send a message via HTTP POST
   */
  protected async doSend(message: JsonRpcMessage): Promise<void> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      // Merge default headers with custom headers and session ID
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(this.config.headers || {}),
      };

      // Add session ID if we have one
      if (this.sessionId) {
        headers['mcp-session-id'] = this.sessionId;
      }

      const response = await fetch(this.config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Extract session ID from response headers if present
      const responseSessionId = response.headers.get('mcp-session-id');
      if (responseSessionId) {
        this.sessionId = responseSessionId;
      }

      if (!response.ok) {
        throw new TransportError(
          `HTTP request failed with status ${response.status}: ${response.statusText}`,
          'HTTP_REQUEST_FAILED'
        );
      }

      // For HTTP mode (not SSE), parse the response and enqueue it
      if (this.config.mode === 'http') {
        const responseText = await response.text();
        if (responseText) {
          try {
            // Check if response is in SSE format
            if (responseText.startsWith('event:') || responseText.startsWith('data:')) {
              // Parse SSE format: extract data from "data: {...}" line
              const lines = responseText.split('\n');
              for (const line of lines) {
                if (line.startsWith('data:')) {
                  const jsonData = line.substring(5).trim(); // Remove "data:" prefix
                  const responseMessage = JSON.parse(jsonData) as JsonRpcMessage;
                  this.enqueueMessage(responseMessage);
                  break; // Only process first data line
                }
              }
            } else {
              // Regular JSON response
              const responseMessage = JSON.parse(responseText) as JsonRpcMessage;
              this.enqueueMessage(responseMessage);
            }
          } catch (error) {
            console.error('Failed to parse HTTP response:', error);
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TransportError(`HTTP request timeout after ${this.timeout}ms`, 'HTTP_TIMEOUT');
      }

      throw new TransportError(
        `Failed to send HTTP request: ${error instanceof Error ? error.message : String(error)}`,
        'HTTP_SEND_FAILED',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Receive messages from SSE or HTTP responses
   */
  protected async *doReceive(): AsyncIterator<JsonRpcMessage> {
    while (true) {
      // If there are queued messages, yield them first
      if (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift()!;
        yield message;
        continue;
      }

      // If receive is closed, we're done
      if (this.receiveClosed) {
        return;
      }

      // Wait for next message
      const result = await new Promise<IteratorResult<JsonRpcMessage>>((resolve, reject) => {
        this.resolveQueue.push(resolve);
        this.rejectQueue.push(reject);
      });

      if (result.done) {
        return;
      }

      yield result.value;
    }
  }

  /**
   * Close the transport
   */
  protected async doClose(): Promise<void> {
    // Clear reconnection timer if any
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Close SSE connection if exists
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Mark receive as closed
    this.receiveClosed = true;

    // Resolve all waiting receivers with done
    while (this.resolveQueue.length > 0) {
      const resolve = this.resolveQueue.shift()!;
      resolve({ value: undefined, done: true });
    }
  }
}
