/**
 * Error recovery mechanisms including retry logic and exponential backoff
 */

import { ServiceUnavailableError } from './custom-errors.js';

/**
 * Retry configuration options
 */
export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Initial delay in milliseconds */
  initialDelayMs: number;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
  /** Backoff multiplier (default: 2 for exponential backoff) */
  backoffMultiplier: number;
  /** Whether to add jitter to delays */
  jitter: boolean;
  /** Function to determine if error is retryable */
  isRetryable?: (error: unknown) => boolean;
  /** Callback called before each retry */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

/**
 * Default retry options
 */
const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Error recovery utility class
 */
export class ErrorRecovery {
  /**
   * Execute an operation with retry logic and exponential backoff
   */
  static async withRetry<T>(
    operation: () => Promise<T>,
    options: Partial<RetryOptions> = {}
  ): Promise<T> {
    const config = { ...DEFAULT_RETRY_OPTIONS, ...options };
    let lastError: unknown;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        // Check if error is retryable
        if (config.isRetryable && !config.isRetryable(error)) {
          throw error;
        }

        // Don't retry on last attempt
        if (attempt === config.maxRetries) {
          throw error;
        }

        // Calculate delay with exponential backoff
        const delay = this.calculateDelay(
          attempt,
          config.initialDelayMs,
          config.maxDelayMs,
          config.backoffMultiplier,
          config.jitter
        );

        // Call retry callback if provided
        if (config.onRetry) {
          config.onRetry(attempt + 1, error, delay);
        }

        // Wait before retrying
        await this.sleep(delay);
      }
    }

    // This should never be reached, but TypeScript needs it
    throw lastError;
  }

  /**
   * Calculate delay with exponential backoff and optional jitter
   */
  private static calculateDelay(
    attempt: number,
    initialDelayMs: number,
    maxDelayMs: number,
    backoffMultiplier: number,
    jitter: boolean
  ): number {
    // Calculate exponential backoff
    let delay = initialDelayMs * Math.pow(backoffMultiplier, attempt);

    // Cap at maximum delay
    delay = Math.min(delay, maxDelayMs);

    // Add jitter if enabled (random value between 0 and delay)
    if (jitter) {
      delay = Math.random() * delay;
    }

    return Math.floor(delay);
  }

  /**
   * Sleep for specified milliseconds
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Default retryable error checker
   */
  static isRetryableError(error: unknown): boolean {
    // Retry on network errors, timeouts, and service unavailable
    if (error instanceof ServiceUnavailableError) {
      return true;
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('timeout') ||
        message.includes('econnrefused') ||
        message.includes('econnreset') ||
        message.includes('etimedout') ||
        message.includes('network') ||
        message.includes('unavailable')
      );
    }

    return false;
  }

  /**
   * Retry with circuit breaker pattern
   */
  static createCircuitBreaker<T>(
    operation: () => Promise<T>,
    options: {
      /** Failure threshold before opening circuit */
      failureThreshold: number;
      /** Time in ms to wait before attempting to close circuit */
      resetTimeoutMs: number;
      /** Callback when circuit opens */
      onOpen?: () => void;
      /** Callback when circuit closes */
      onClose?: () => void;
    }
  ): () => Promise<T> {
    let failureCount = 0;
    let lastFailureTime: number | null = null;
    let circuitOpen = false;

    return async () => {
      // Check if circuit should be reset
      if (
        circuitOpen &&
        lastFailureTime &&
        Date.now() - lastFailureTime >= options.resetTimeoutMs
      ) {
        circuitOpen = false;
        failureCount = 0;
        if (options.onClose) {
          options.onClose();
        }
      }

      // Reject if circuit is open
      if (circuitOpen) {
        throw new ServiceUnavailableError(
          'Circuit breaker',
          'Circuit is open due to repeated failures'
        );
      }

      try {
        const result = await operation();
        // Reset failure count on success
        failureCount = 0;
        return result;
      } catch (error) {
        failureCount++;
        lastFailureTime = Date.now();

        // Open circuit if threshold reached
        if (failureCount >= options.failureThreshold) {
          circuitOpen = true;
          if (options.onOpen) {
            options.onOpen();
          }
        }

        throw error;
      }
    };
  }

  /**
   * Automatic service restart handler
   */
  static async handleServiceCrash(
    serviceName: string,
    restartFn: () => Promise<void>,
    options: {
      /** Maximum restart attempts */
      maxRestarts?: number;
      /** Delay between restart attempts */
      restartDelayMs?: number;
      /** Callback on restart */
      onRestart?: (attempt: number) => void;
    } = {}
  ): Promise<void> {
    const { maxRestarts = 3, restartDelayMs = 5000, onRestart } = options;

    return this.withRetry(restartFn, {
      maxRetries: maxRestarts,
      initialDelayMs: restartDelayMs,
      maxDelayMs: restartDelayMs * 2,
      backoffMultiplier: 1.5,
      jitter: true,
      onRetry: (attempt) => {
        console.warn(
          `Attempting to restart service ${serviceName} (attempt ${attempt}/${maxRestarts})`
        );
        if (onRestart) {
          onRestart(attempt);
        }
      },
    });
  }

  /**
   * Health-based error recovery
   */
  static async recoverWithHealthCheck(
    operation: () => Promise<void>,
    healthCheck: () => Promise<boolean>,
    options: {
      /** Maximum recovery attempts */
      maxAttempts?: number;
      /** Delay between attempts */
      delayMs?: number;
      /** Callback on recovery attempt */
      onAttempt?: (attempt: number, healthy: boolean) => void;
    } = {}
  ): Promise<void> {
    const { maxAttempts = 5, delayMs = 2000, onAttempt } = options;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Check health first
        const healthy = await healthCheck();

        if (onAttempt) {
          onAttempt(attempt, healthy);
        }

        if (!healthy) {
          // Try to recover
          await operation();
          
          // Wait a bit and check health again
          await this.sleep(delayMs);
          const nowHealthy = await healthCheck();
          
          if (nowHealthy) {
            console.log(`Service recovered after ${attempt} attempts`);
            return;
          }
        } else {
          // Already healthy
          return;
        }
      } catch (error) {
        console.error(`Recovery attempt ${attempt} failed:`, error);
      }

      // Wait before next attempt
      if (attempt < maxAttempts) {
        await this.sleep(delayMs);
      }
    }

    throw new ServiceUnavailableError(
      'Recovery failed',
      `Failed to recover after ${maxAttempts} attempts`
    );
  }
}
