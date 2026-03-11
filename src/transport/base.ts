/**
 * Base Transport implementation with common error handling and state management
 */

import type { JsonRpcMessage } from '../types/jsonrpc.js';
import type { Transport } from '../types/transport.js';
import type { TransportType } from '../types/service.js';
import { EventEmitter } from 'events';

/**
 * Transport state
 */
export enum TransportState {
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  CLOSING = 'closing',
  CLOSED = 'closed',
  ERROR = 'error',
}

/**
 * Transport error class
 */
export class TransportError extends Error {
  public readonly code: string;
  public readonly errorCause: Error | undefined;

  constructor(message: string, code: string, cause?: Error) {
    super(message);
    this.name = 'TransportError';
    this.code = code;
    this.errorCause = cause;
  }
}

/**
 * Base abstract class for Transport implementations
 * Provides common error handling and connection state management
 */
export abstract class BaseTransport extends EventEmitter implements Transport {
  protected state: TransportState = TransportState.CONNECTING;
  protected closePromise: Promise<void> | null = null;

  /**
   * Get current transport state
   */
  public getState(): TransportState {
    return this.state;
  }

  /**
   * Check if transport is connected
   */
  public isConnected(): boolean {
    return this.state === TransportState.CONNECTED;
  }

  /**
   * Check if transport is closed
   */
  public isClosed(): boolean {
    return this.state === TransportState.CLOSED;
  }

  /**
   * Send a message to the server/client
   * Validates state before sending
   */
  public async send(message: JsonRpcMessage): Promise<void> {
    if (this.state === TransportState.CLOSED) {
      throw new TransportError('Cannot send message: transport is closed', 'TRANSPORT_CLOSED');
    }

    if (this.state === TransportState.CLOSING) {
      throw new TransportError('Cannot send message: transport is closing', 'TRANSPORT_CLOSING');
    }

    if (this.state === TransportState.ERROR) {
      throw new TransportError(
        'Cannot send message: transport is in error state',
        'TRANSPORT_ERROR'
      );
    }

    try {
      await this.doSend(message);
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  /**
   * Receive messages (returns async iterator)
   * Validates state before receiving
   */
  public receive(): AsyncIterator<JsonRpcMessage> {
    if (this.state === TransportState.CLOSED) {
      throw new TransportError('Cannot receive messages: transport is closed', 'TRANSPORT_CLOSED');
    }

    // Wrap the iterator to handle errors and update state
    const iterator = this.doReceive();
    const handleError = (error: unknown) => this.handleError(error);

    // Create a wrapper that handles errors and implements AsyncIterator
    const wrappedIterator = {
      async next(): Promise<IteratorResult<JsonRpcMessage>> {
        try {
          return await iterator.next();
        } catch (error) {
          handleError(error);
          throw error;
        }
      },
      async return(value?: JsonRpcMessage): Promise<IteratorResult<JsonRpcMessage>> {
        return iterator.return
          ? iterator.return(value)
          : { done: true, value: value as unknown as JsonRpcMessage };
      },
      async throw(error?: unknown): Promise<IteratorResult<JsonRpcMessage>> {
        handleError(error);
        return iterator.throw
          ? iterator.throw(error)
          : { done: true, value: undefined as unknown as JsonRpcMessage };
      },
      [Symbol.asyncIterator](): AsyncIterator<JsonRpcMessage> {
        return wrappedIterator;
      },
    };

    return wrappedIterator;
  }

  /**
   * Close the connection
   * Ensures idempotent close operation
   */
  public async close(): Promise<void> {
    // If already closed, return immediately
    if (this.state === TransportState.CLOSED) {
      return;
    }

    // If already closing, wait for the existing close operation
    if (this.closePromise) {
      return this.closePromise;
    }

    // Start closing
    this.state = TransportState.CLOSING;
    this.emit('closing');

    this.closePromise = this.doClose()
      .then(() => {
        this.state = TransportState.CLOSED;
        this.emit('closed');
      })
      .catch((error) => {
        this.state = TransportState.ERROR;
        this.emit('error', error);
        throw error;
      });

    return this.closePromise;
  }

  /**
   * Get the transport type
   */
  public abstract getType(): TransportType;

  /**
   * Actual send implementation (to be implemented by subclasses)
   */
  protected abstract doSend(message: JsonRpcMessage): Promise<void>;

  /**
   * Actual receive implementation (to be implemented by subclasses)
   */
  protected abstract doReceive(): AsyncIterator<JsonRpcMessage>;

  /**
   * Actual close implementation (to be implemented by subclasses)
   */
  protected abstract doClose(): Promise<void>;

  /**
   * Handle transport errors
   * Updates state and emits error event
   */
  protected handleError(error: unknown): void {
    this.state = TransportState.ERROR;
    this.emit('error', error);
  }

  /**
   * Transition to connected state
   * Should be called by subclasses when connection is established
   */
  protected setConnected(): void {
    this.state = TransportState.CONNECTED;
    this.emit('connected');
  }
}
