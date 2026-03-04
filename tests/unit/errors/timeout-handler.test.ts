import { describe, it, expect, vi } from 'vitest';
import { TimeoutHandler } from '../../../src/errors/timeout-handler.js';
import { TimeoutError } from '../../../src/errors/custom-errors.js';

describe('TimeoutHandler', () => {
  describe('withTimeout', () => {
    it('should resolve when operation completes before timeout', async () => {
      const operation = Promise.resolve('success');
      
      const result = await TimeoutHandler.withTimeout(operation, {
        timeoutMs: 1000,
        operationName: 'test-op',
      });

      expect(result).toBe('success');
    });

    it('should reject with TimeoutError when operation exceeds timeout', async () => {
      const operation = new Promise((resolve) => {
        setTimeout(() => resolve('too late'), 1000);
      });

      await expect(
        TimeoutHandler.withTimeout(operation, {
          timeoutMs: 100,
          operationName: 'test-op',
        })
      ).rejects.toThrow(TimeoutError);
    });

    it('should include timeout duration in error message', async () => {
      const operation = new Promise((resolve) => {
        setTimeout(() => resolve('too late'), 1000);
      });

      try {
        await TimeoutHandler.withTimeout(operation, {
          timeoutMs: 100,
          operationName: 'test-op',
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TimeoutError);
        expect((error as TimeoutError).message).toContain('100ms');
      }
    });

    it('should call cleanup function on timeout', async () => {
      const cleanup = vi.fn();
      const operation = new Promise((resolve) => {
        setTimeout(() => resolve('too late'), 1000);
      });

      try {
        await TimeoutHandler.withTimeout(operation, {
          timeoutMs: 100,
          operationName: 'test-op',
          onTimeout: cleanup,
        });
      } catch (error) {
        // Expected to timeout
      }

      // Wait a bit for cleanup to be called
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(cleanup).toHaveBeenCalled();
    });

    it('should not call cleanup function when operation succeeds', async () => {
      const cleanup = vi.fn();
      const operation = Promise.resolve('success');

      await TimeoutHandler.withTimeout(operation, {
        timeoutMs: 1000,
        operationName: 'test-op',
        onTimeout: cleanup,
      });

      expect(cleanup).not.toHaveBeenCalled();
    });

    it('should handle operation rejection', async () => {
      const operation = Promise.reject(new Error('Operation failed'));

      await expect(
        TimeoutHandler.withTimeout(operation, {
          timeoutMs: 1000,
          operationName: 'test-op',
        })
      ).rejects.toThrow('Operation failed');
    });
  });

  describe('createTimeoutPromise', () => {
    it('should reject with TimeoutError after specified duration', async () => {
      const timeoutPromise = TimeoutHandler.createTimeoutPromise(100, 'test-op');

      await expect(timeoutPromise).rejects.toThrow(TimeoutError);
    });

    it('should include operation name in error', async () => {
      const timeoutPromise = TimeoutHandler.createTimeoutPromise(100, 'my-operation');

      try {
        await timeoutPromise;
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TimeoutError);
        expect((error as TimeoutError).message).toContain('my-operation');
      }
    });
  });

  describe('race', () => {
    it('should resolve when operation completes before timeout', async () => {
      const operation = Promise.resolve('success');
      
      const result = await TimeoutHandler.race(operation, 1000, 'test-op');

      expect(result).toBe('success');
    });

    it('should reject with TimeoutError when timeout occurs first', async () => {
      const operation = new Promise((resolve) => {
        setTimeout(() => resolve('too late'), 1000);
      });

      await expect(
        TimeoutHandler.race(operation, 100, 'test-op')
      ).rejects.toThrow(TimeoutError);
    });
  });

  describe('allWithTimeout', () => {
    it('should resolve all operations that complete before timeout', async () => {
      const operations = [
        { promise: Promise.resolve('result1'), timeout: 1000, name: 'op1' },
        { promise: Promise.resolve('result2'), timeout: 1000, name: 'op2' },
        { promise: Promise.resolve('result3'), timeout: 1000, name: 'op3' },
      ];

      const results = await TimeoutHandler.allWithTimeout(operations);

      expect(results).toEqual(['result1', 'result2', 'result3']);
    });

    it('should handle mixed success and timeout with failFast=false', async () => {
      const operations = [
        { promise: Promise.resolve('result1'), timeout: 1000, name: 'op1' },
        {
          promise: new Promise((resolve) => setTimeout(() => resolve('too late'), 1000)),
          timeout: 100,
          name: 'op2',
        },
        { promise: Promise.resolve('result3'), timeout: 1000, name: 'op3' },
      ];

      const results = await TimeoutHandler.allWithTimeout(operations, {
        failFast: false,
      });

      expect(results).toEqual(['result1', 'result3']);
    });

    it('should fail fast when failFast=true and one operation times out', async () => {
      const operations = [
        { promise: Promise.resolve('result1'), timeout: 1000, name: 'op1' },
        {
          promise: new Promise((resolve) => setTimeout(() => resolve('too late'), 1000)),
          timeout: 100,
          name: 'op2',
        },
        { promise: Promise.resolve('result3'), timeout: 1000, name: 'op3' },
      ];

      await expect(
        TimeoutHandler.allWithTimeout(operations, { failFast: true })
      ).rejects.toThrow(TimeoutError);
    });

    it('should throw first error when all operations fail', async () => {
      const operations = [
        {
          promise: new Promise((_, reject) => setTimeout(() => reject(new Error('fail1')), 50)),
          timeout: 1000,
          name: 'op1',
        },
        {
          promise: new Promise((_, reject) => setTimeout(() => reject(new Error('fail2')), 50)),
          timeout: 1000,
          name: 'op2',
        },
      ];

      await expect(
        TimeoutHandler.allWithTimeout(operations, { failFast: false })
      ).rejects.toThrow('fail1');
    });
  });
});
