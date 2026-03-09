import { describe, it, expect, vi } from 'vitest';
import { ErrorRecovery } from '../../../src/errors/error-recovery.js';
import { ServiceUnavailableError } from '../../../src/errors/custom-errors.js';

describe('ErrorRecovery', () => {
  describe('withRetry', () => {
    it('should succeed on first attempt', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      const result = await ErrorRecovery.withRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
        jitter: false,
      });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail1'))
        .mockRejectedValueOnce(new Error('fail2'))
        .mockResolvedValue('success');

      const result = await ErrorRecovery.withRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
        jitter: false,
      });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should throw after max retries', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('always fails'));

      await expect(
        ErrorRecovery.withRetry(operation, {
          maxRetries: 2,
          initialDelayMs: 10,
          maxDelayMs: 100,
          backoffMultiplier: 2,
          jitter: false,
        })
      ).rejects.toThrow('always fails');

      expect(operation).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('should call onRetry callback', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');
      const onRetry = vi.fn();

      await ErrorRecovery.withRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
        jitter: false,
        onRetry,
      });

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), expect.any(Number));
    });

    it('should not retry non-retryable errors', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('non-retryable'));
      const isRetryable = vi.fn().mockReturnValue(false);

      await expect(
        ErrorRecovery.withRetry(operation, {
          maxRetries: 3,
          initialDelayMs: 10,
          maxDelayMs: 100,
          backoffMultiplier: 2,
          jitter: false,
          isRetryable,
        })
      ).rejects.toThrow('non-retryable');

      expect(operation).toHaveBeenCalledTimes(1);
      expect(isRetryable).toHaveBeenCalledTimes(1);
    });

    it('should use exponential backoff', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail1'))
        .mockRejectedValueOnce(new Error('fail2'))
        .mockResolvedValue('success');
      const delays: number[] = [];
      const onRetry = vi.fn((_attempt: number, _error: unknown, delay: number) => {
        delays.push(delay);
      });

      await ErrorRecovery.withRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        backoffMultiplier: 2,
        jitter: false,
        onRetry,
      });

      // First retry: 100ms, second retry: 200ms
      expect(delays[0]).toBe(100);
      expect(delays[1]).toBe(200);
    });

    it('should cap delay at maxDelayMs', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail1'))
        .mockRejectedValueOnce(new Error('fail2'))
        .mockResolvedValue('success');
      const delays: number[] = [];
      const onRetry = vi.fn((_attempt: number, _error: unknown, delay: number) => {
        delays.push(delay);
      });

      await ErrorRecovery.withRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 100,
        maxDelayMs: 150,
        backoffMultiplier: 2,
        jitter: false,
        onRetry,
      });

      // First retry: 100ms, second retry: capped at 150ms (not 200ms)
      expect(delays[0]).toBe(100);
      expect(delays[1]).toBe(150);
    });
  });

  describe('isRetryableError', () => {
    it('should identify ServiceUnavailableError as retryable', () => {
      const error = new ServiceUnavailableError('test-service');
      expect(ErrorRecovery.isRetryableError(error)).toBe(true);
    });

    it('should identify timeout errors as retryable', () => {
      const error = new Error('Operation timeout');
      expect(ErrorRecovery.isRetryableError(error)).toBe(true);
    });

    it('should identify network errors as retryable', () => {
      const errors = [
        new Error('ECONNREFUSED'),
        new Error('ECONNRESET'),
        new Error('ETIMEDOUT'),
        new Error('Network error'),
      ];

      errors.forEach((error) => {
        expect(ErrorRecovery.isRetryableError(error)).toBe(true);
      });
    });

    it('should not identify generic errors as retryable', () => {
      const error = new Error('Generic error');
      expect(ErrorRecovery.isRetryableError(error)).toBe(false);
    });
  });

  describe('createCircuitBreaker', () => {
    it('should allow operations when circuit is closed', async () => {
      const operation = vi.fn().mockResolvedValue('success');
      const breaker = ErrorRecovery.createCircuitBreaker(operation, {
        failureThreshold: 3,
        resetTimeoutMs: 1000,
      });

      const result = await breaker();
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should open circuit after threshold failures', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('fail'));
      const onOpen = vi.fn();
      const breaker = ErrorRecovery.createCircuitBreaker(operation, {
        failureThreshold: 3,
        resetTimeoutMs: 1000,
        onOpen,
      });

      // Fail 3 times to reach threshold
      for (let i = 0; i < 3; i++) {
        try {
          await breaker();
        } catch (error) {
          // Expected
        }
      }

      expect(onOpen).toHaveBeenCalled();

      // Next call should be rejected immediately
      await expect(breaker()).rejects.toThrow('Circuit is open');
      expect(operation).toHaveBeenCalledTimes(3); // Not called again
    });

    it('should reset circuit after timeout', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail1'))
        .mockRejectedValueOnce(new Error('fail2'))
        .mockRejectedValueOnce(new Error('fail3'))
        .mockResolvedValue('success');
      const onClose = vi.fn();
      const breaker = ErrorRecovery.createCircuitBreaker(operation, {
        failureThreshold: 3,
        resetTimeoutMs: 100,
        onClose,
      });

      // Fail 3 times to open circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker();
        } catch (error) {
          // Expected
        }
      }

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should succeed now
      const result = await breaker();
      expect(result).toBe('success');
      expect(onClose).toHaveBeenCalled();
    });

    it('should reset failure count on success', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail1'))
        .mockRejectedValueOnce(new Error('fail2'))
        .mockResolvedValueOnce('success')
        .mockRejectedValueOnce(new Error('fail3'))
        .mockRejectedValueOnce(new Error('fail4'));
      const onOpen = vi.fn();
      const breaker = ErrorRecovery.createCircuitBreaker(operation, {
        failureThreshold: 3,
        resetTimeoutMs: 1000,
        onOpen,
      });

      // Fail twice
      for (let i = 0; i < 2; i++) {
        try {
          await breaker();
        } catch (error) {
          // Expected
        }
      }

      // Succeed (resets count)
      await breaker();

      // Fail twice more (should not open circuit)
      for (let i = 0; i < 2; i++) {
        try {
          await breaker();
        } catch (error) {
          // Expected
        }
      }

      expect(onOpen).not.toHaveBeenCalled();
    });
  });

  describe('handleServiceCrash', () => {
    it('should restart service successfully', async () => {
      const restartFn = vi.fn().mockResolvedValue(undefined);

      await ErrorRecovery.handleServiceCrash('test-service', restartFn);

      expect(restartFn).toHaveBeenCalledTimes(1);
    });

    it('should retry restart on failure', async () => {
      const restartFn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail1'))
        .mockResolvedValue(undefined);
      const onRestart = vi.fn();

      await ErrorRecovery.handleServiceCrash('test-service', restartFn, {
        maxRestarts: 3,
        restartDelayMs: 10,
        onRestart,
      });

      expect(restartFn).toHaveBeenCalledTimes(2);
      expect(onRestart).toHaveBeenCalledTimes(1);
    });

    it('should throw after max restart attempts', async () => {
      const restartFn = vi.fn().mockRejectedValue(new Error('always fails'));

      await expect(
        ErrorRecovery.handleServiceCrash('test-service', restartFn, {
          maxRestarts: 2,
          restartDelayMs: 10,
        })
      ).rejects.toThrow('always fails');

      expect(restartFn).toHaveBeenCalledTimes(3); // initial + 2 retries
    });
  });

  describe('recoverWithHealthCheck', () => {
    it('should not recover if already healthy', async () => {
      const operation = vi.fn().mockResolvedValue(undefined);
      const healthCheck = vi.fn().mockResolvedValue(true);

      await ErrorRecovery.recoverWithHealthCheck(operation, healthCheck);

      expect(healthCheck).toHaveBeenCalledTimes(1);
      expect(operation).not.toHaveBeenCalled();
    });

    it('should recover unhealthy service', async () => {
      const operation = vi.fn().mockResolvedValue(undefined);
      const healthCheck = vi
        .fn()
        .mockResolvedValueOnce(false) // Initially unhealthy
        .mockResolvedValueOnce(true); // Healthy after recovery

      await ErrorRecovery.recoverWithHealthCheck(operation, healthCheck, {
        maxAttempts: 3,
        delayMs: 10,
      });

      expect(operation).toHaveBeenCalledTimes(1);
      expect(healthCheck).toHaveBeenCalledTimes(2);
    });

    it('should throw after max recovery attempts', async () => {
      const operation = vi.fn().mockResolvedValue(undefined);
      const healthCheck = vi.fn().mockResolvedValue(false); // Always unhealthy

      await expect(
        ErrorRecovery.recoverWithHealthCheck(operation, healthCheck, {
          maxAttempts: 2,
          delayMs: 10,
        })
      ).rejects.toThrow(ServiceUnavailableError);
    });

    it('should call onAttempt callback', async () => {
      const operation = vi.fn().mockResolvedValue(undefined);
      const healthCheck = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      const onAttempt = vi.fn();

      await ErrorRecovery.recoverWithHealthCheck(operation, healthCheck, {
        maxAttempts: 3,
        delayMs: 10,
        onAttempt,
      });

      expect(onAttempt).toHaveBeenCalledWith(1, false);
    });
  });
});
