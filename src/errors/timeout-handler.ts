/**
 * Timeout handling utilities for tool calls and operations
 */

import { TimeoutError } from './custom-errors.js';

/**
 * Options for timeout handling
 */
export interface TimeoutOptions {
  /** Timeout duration in milliseconds */
  timeoutMs: number;
  /** Operation name for error messages */
  operationName?: string;
  /** Cleanup function to call on timeout */
  onTimeout?: () => void | Promise<void>;
}

/**
 * Timeout handler utility class
 */
export class TimeoutHandler {
  /**
   * Execute an async operation with timeout
   */
  static async withTimeout<T>(operation: Promise<T>, options: TimeoutOptions): Promise<T> {
    const { timeoutMs, operationName = 'Operation', onTimeout } = options;

    return new Promise<T>((resolve, reject) => {
      let isResolved = false;
      const timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;

          if (onTimeout) {
            void Promise.resolve(onTimeout()).catch((cleanupError) => {
              console.error('Error during timeout cleanup:', cleanupError);
            });
          }

          reject(new TimeoutError(`${operationName} timed out after ${timeoutMs}ms`, timeoutMs));
        }
      }, timeoutMs);

      // Execute operation
      operation
        .then((result) => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeoutId);
            resolve(result);
          }
        })
        .catch((error) => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeoutId);
            reject(error);
          }
        });
    });
  }

  /**
   * Create a timeout promise that rejects after specified duration
   */
  static createTimeoutPromise(timeoutMs: number, operationName = 'Operation'): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new TimeoutError(`${operationName} timed out after ${timeoutMs}ms`, timeoutMs));
      }, timeoutMs);
    });
  }

  /**
   * Race an operation against a timeout
   */
  static async race<T>(
    operation: Promise<T>,
    timeoutMs: number,
    operationName = 'Operation'
  ): Promise<T> {
    return Promise.race([operation, this.createTimeoutPromise(timeoutMs, operationName)]);
  }

  /**
   * Execute multiple operations with individual timeouts
   */
  static async allWithTimeout<T>(
    operations: Array<{ promise: Promise<T>; timeout: number; name?: string }>,
    options?: {
      /** Whether to fail fast on first error */
      failFast?: boolean;
    }
  ): Promise<T[]> {
    const { failFast = false } = options || {};

    const wrappedOperations = operations.map(({ promise, timeout, name }) => {
      const timeoutOptions: TimeoutOptions = {
        timeoutMs: timeout,
        ...(name !== undefined && { operationName: name }),
      };
      return this.withTimeout(promise, timeoutOptions);
    });

    if (failFast) {
      return Promise.all(wrappedOperations);
    }

    // Use allSettled to continue even if some operations fail
    const results = await Promise.allSettled(wrappedOperations);

    const fulfilled: T[] = [];
    const rejected: unknown[] = [];

    for (const r of results) {
      if (r.status === 'fulfilled') {
        fulfilled.push(r.value);
      } else {
        rejected.push(r.reason);
      }
    }

    if (rejected.length > 0) {
      // If all operations failed, throw the first error
      if (fulfilled.length === 0) {
        throw rejected[0];
      }
      // Otherwise, log warnings about failed operations
      console.warn(`${rejected.length} operations failed or timed out`);
    }

    return fulfilled;
  }
}
