/**
 * HTTP Transport implementation for MCP servers using SSE and Streamable HTTP protocols
 */

import EventSource from 'eventsource';
import fetch from 'node-fetch';
import { BaseTransport, TransportError, TransportState } from './base.js';
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
  /** Post URL received from SSE 'endpoint' event (standard MCP SSE protocol) */
  private postUrl: string | null = null;
  /** Resolves when SSE connection is ready (endpoint received or connection opened) */
  private connectionReadyResolve: (() => void) | null = null;
  private connectionReadyReject: ((error: Error) => void) | null = null;
  private readonly connectionReady: Promise<void>;

  constructor(private config: HttpTransportConfig) {
    super();
    this.timeout = config.timeout || 30000; // 30 seconds default
    this.maxReconnectAttempts = config.maxReconnectAttempts || 3;
    this.reconnectDelay = config.reconnectDelay || 1000; // 1 second default

    if (config.mode === 'sse') {
      // connectionReady always resolves (never rejects) to avoid unhandled rejections.
      // Connection errors are emitted via the 'error' event and checked in doSend via state.
      const inner = new Promise<void>((resolve, reject) => {
        this.connectionReadyResolve = resolve;
        this.connectionReadyReject = reject;
      });
      this.connectionReady = inner.catch(() => {});
      this.initializeSSE();
    } else {
      // For HTTP mode, mark as connected immediately
      // Actual connection happens per-request
      this.connectionReady = Promise.resolve();
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
   *
   * Standard MCP SSE protocol:
   *  1. Client connects to SSE URL (GET)
   *  2. Server sends an 'endpoint' SSE event with the POST URL (may include sessionId)
   *  3. Client POSTs messages to the endpoint URL
   *  4. Server pushes responses via SSE 'message' events
   *
   * Some servers also accept POST to the SSE URL directly (non-standard).
   * We handle both by using the endpoint URL when provided.
   */
  private initializeSSE(): void {
    try {
      this.eventSource = new EventSource(this.config.url);

      // Handle 'endpoint' event — standard MCP SSE handshake
      // The server sends this event once to tell the client where to POST messages
      // Guard: some minimal EventSource implementations may not have addEventListener
      if (typeof this.eventSource.addEventListener === 'function') {
        this.eventSource.addEventListener('endpoint', (event) => {
          try {
            const endpointPath = (event as MessageEvent).data as string;
            if (endpointPath.startsWith('http://') || endpointPath.startsWith('https://')) {
              this.postUrl = endpointPath;
            } else {
              // Relative URL — resolve against the SSE base URL
              const base = new URL(this.config.url);
              this.postUrl = new URL(endpointPath, base).href;
            }
            this.reconnectAttempts = 0;
            this.setConnected();
            if (this.connectionReadyResolve) {
              this.connectionReadyResolve();
              this.connectionReadyResolve = null;
              this.connectionReadyReject = null;
            }
          } catch (error) {
            console.error('Failed to parse SSE endpoint event:', error);
          }
        });
      }

      // Handle incoming messages
      this.eventSource.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as JsonRpcMessage;
          this.enqueueMessage(message);
        } catch (error) {
          console.error('Failed to parse SSE message:', error);
        }
      };

      // Handle connection open — for servers that don't send an 'endpoint' event,
      // fall back to using the SSE URL itself as the POST target
      this.eventSource.onopen = () => {
        this.reconnectAttempts = 0;
        // Only resolve if we haven't already resolved via 'endpoint' event
        // Give the server a short grace period to send 'endpoint' before falling back
        setTimeout(() => {
          if (this.connectionReadyResolve) {
            // No 'endpoint' event received — assume POST goes to the same URL
            this.setConnected();
            this.connectionReadyResolve();
            this.connectionReadyResolve = null;
            this.connectionReadyReject = null;
          }
        }, 500);
      };

      // Handle errors - consume the error to prevent unhandled error event
      this.eventSource.onerror = (error) => {
        // Prevent the error from bubbling up as unhandled error
        if (error && typeof error === 'object' && 'stopImmediatePropagation' in error) {
          (error as Event).stopImmediatePropagation();
        }
        this.handleSSEError(error as Event);
      };

      // Add error event listener on the HttpTransport instance to prevent unhandled errors
      this.on('error', () => {
        // Error is already handled in handleSSEError, this listener prevents unhandled error event
      });
    } catch (error) {
      const transportError = new TransportError(
        `Failed to initialize SSE: ${error instanceof Error ? error.message : String(error)}`,
        'SSE_INIT_FAILED',
        error instanceof Error ? error : undefined
      );
      this.handleError(transportError);
      if (this.connectionReadyReject) {
        this.connectionReadyReject(transportError);
        this.connectionReadyResolve = null;
        this.connectionReadyReject = null;
      }
    }
  }

  /**
   * Wait for SSE connection to be ready (endpoint received or fallback)
   */
  public waitForReady(): Promise<void> {
    return this.connectionReady;
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
      // Max reconnection attempts reached - log warning but don't crash
      console.error(`SSE connection failed after ${this.maxReconnectAttempts} attempts`);

      // Mark transport as error state (this will emit error event, but we have a listener)
      const transportError = new TransportError(
        `SSE connection failed after ${this.maxReconnectAttempts} attempts`,
        'SSE_CONNECTION_FAILED'
      );
      this.handleError(transportError);

      // Reject the connectionReady promise if it hasn't resolved yet
      if (this.connectionReadyReject) {
        this.connectionReadyReject(transportError);
        this.connectionReadyResolve = null;
        this.connectionReadyReject = null;
      }

      // Reject all waiting receivers with a different error that won't propagate
      const connectionLostError = new Error('SSE connection lost');
      while (this.rejectQueue.length > 0) {
        const reject = this.rejectQueue.shift();
        if (reject) {
          reject(connectionLostError);
        }
      }
    }
  }

  /**
   * Enqueue a received message
   *
   * For HTTP mode, send() completes before the caller calls receive().next(), so the
   * response may arrive when no one is waiting. In that case we push to messageQueue
   * so the subsequent next() will deliver it.
   */
  private enqueueMessage(message: JsonRpcMessage): void {
    if (this.resolveQueue.length > 0) {
      // If there's a waiting receiver, resolve it immediately
      const resolve = this.resolveQueue.shift();
      if (resolve) {
        resolve({ done: false, value: message });
      }
    } else {
      // No receiver waiting yet (e.g. HTTP: response arrived inside send() before receive().next())
      this.messageQueue.push(message);
    }
  }

  /**
   * Send a message via HTTP POST
   *
   * For SSE mode, uses the postUrl received from the 'endpoint' SSE event.
   * Falls back to the original SSE URL if no endpoint was provided.
   */
  protected async doSend(message: JsonRpcMessage): Promise<void> {
    // For SSE mode, wait until we know the POST target URL before sending.
    // connectionReady always resolves; check state afterwards for failures.
    if (this.config.mode === 'sse') {
      await this.connectionReady;
      if (this.state === TransportState.ERROR || this.state === TransportState.CLOSED) {
        throw new TransportError('SSE connection is not available', 'SSE_NOT_CONNECTED');
      }
    }

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

      // Use endpoint URL from SSE handshake if available, otherwise fall back to config URL
      const targetUrl = this.postUrl ?? this.config.url;

      const response = await fetch(targetUrl, {
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
        const message = this.messageQueue.shift();
        if (message) {
          yield message;
        }
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
    // Use Promise.resolve to satisfy require-await rule
    await Promise.resolve();

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
      const resolve = this.resolveQueue.shift();
      if (resolve) {
        resolve({ value: undefined, done: true });
      }
    }
  }
}
