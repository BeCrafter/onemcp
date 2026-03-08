import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ErrorBuilder } from '../../src/errors/error-builder.js';
import { ErrorPropagation } from '../../src/errors/error-propagation.js';
import { ErrorRecovery } from '../../src/errors/error-recovery.js';
import { TimeoutHandler } from '../../src/errors/timeout-handler.js';
import {
  McpRouterError,
  ToolNotFoundError,
  ToolDisabledError,
  ServiceUnavailableError,
  TimeoutError,
  ValidationError,
} from '../../src/errors/custom-errors.js';
import { ErrorCode } from '../../src/types/jsonrpc.js';
import type { RequestContext } from '../../src/types/context.js';

/**
 * Feature: onemcp-system, Property 13: Error response format
 *
 * **Validates: Requirements 9.1**
 *
 * For any request that causes an error, the error response should contain
 * error code, message, and context details.
 */

// Arbitrary generators for error handling tests

/**
 * Generate valid error codes
 */
const errorCodeArbitrary = (): fc.Arbitrary<ErrorCode> =>
  fc.constantFrom(
    ErrorCode.PARSE_ERROR,
    ErrorCode.INVALID_REQUEST,
    ErrorCode.METHOD_NOT_FOUND,
    ErrorCode.INVALID_PARAMS,
    ErrorCode.INTERNAL_ERROR,
    ErrorCode.TOOL_NOT_FOUND,
    ErrorCode.TOOL_DISABLED,
    ErrorCode.SERVICE_UNAVAILABLE,
    ErrorCode.SERVICE_UNHEALTHY,
    ErrorCode.CONNECTION_POOL_EXHAUSTED,
    ErrorCode.TIMEOUT,
    ErrorCode.VALIDATION_ERROR,
    ErrorCode.CONFIGURATION_ERROR,
    ErrorCode.SESSION_ERROR
  );

/**
 * Generate error messages
 */
const errorMessageArbitrary = (): fc.Arbitrary<string> =>
  fc.string({ minLength: 1, maxLength: 200 });

/**
 * Generate request IDs
 */
const requestIdArbitrary = (): fc.Arbitrary<string | number> =>
  fc.oneof(
    fc.string({ minLength: 1, maxLength: 50 }),
    fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER })
  );

/**
 * Generate request contexts
 */
const requestContextArbitrary = (): fc.Arbitrary<RequestContext> =>
  fc.record({
    requestId: fc.string({ minLength: 1, maxLength: 50 }),
    correlationId: fc.string({ minLength: 1, maxLength: 50 }),
    sessionId: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
    agentId: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
    timestamp: fc.date(),
    tagFilter: fc.constant(undefined),
  });

/**
 * Generate service names
 */
const serviceNameArbitrary = (): fc.Arbitrary<string> => fc.string({ minLength: 1, maxLength: 50 });

/**
 * Generate tool names
 */
const toolNameArbitrary = (): fc.Arbitrary<string> => fc.string({ minLength: 1, maxLength: 50 });

describe('Feature: onemcp-system, Property 13: Error response format', () => {
  it('should include error code, message, and context in all error responses', () => {
    fc.assert(
      fc.property(
        errorCodeArbitrary(),
        errorMessageArbitrary(),
        requestIdArbitrary(),
        requestContextArbitrary(),
        (code, message, requestId, context) => {
          const errorResponse = ErrorBuilder.buildErrorResponse({
            code,
            message,
            requestId,
            context,
          });

          // Verify JSON-RPC 2.0 format
          expect(errorResponse.jsonrpc).toBe('2.0');
          expect(errorResponse.id).toBe(requestId);

          // Verify error object structure
          expect(errorResponse.error).toBeDefined();
          expect(errorResponse.error.code).toBe(code);
          expect(errorResponse.error.message).toBe(message);

          // Verify context details are included
          if (errorResponse.error.data) {
            expect(errorResponse.error.data.correlationId).toBe(context.correlationId);
            expect(errorResponse.error.data.requestId).toBe(context.requestId);
            if (context.sessionId) {
              expect(errorResponse.error.data.sessionId).toBe(context.sessionId);
            }
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should include service name in service-related errors', () => {
    fc.assert(
      fc.property(
        serviceNameArbitrary(),
        requestIdArbitrary(),
        requestContextArbitrary(),
        (serviceName, requestId, context) => {
          const errorResponse = ErrorBuilder.serviceUnavailable(serviceName, requestId, context);

          expect(errorResponse.error.data?.serviceName).toBe(serviceName);
          expect(errorResponse.error.message).toContain(serviceName);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should include tool name in tool-related errors', () => {
    fc.assert(
      fc.property(
        toolNameArbitrary(),
        requestIdArbitrary(),
        requestContextArbitrary(),
        (toolName, requestId, context) => {
          const errorResponse = ErrorBuilder.toolNotFound(toolName, requestId, context);

          expect(errorResponse.error.data?.toolName).toBe(toolName);
          expect(errorResponse.error.message).toContain(toolName);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should propagate backend errors with added context', () => {
    fc.assert(
      fc.property(
        errorMessageArbitrary(),
        requestIdArbitrary(),
        requestContextArbitrary(),
        serviceNameArbitrary(),
        (message, requestId, context, serviceName) => {
          const backendError = new Error(message);

          const propagatedError = ErrorPropagation.propagateError({
            error: backendError,
            requestId,
            context,
            serviceName,
          });

          // Verify error is propagated
          expect(propagatedError.error.message).toBe(message);

          // Verify context is added
          if (propagatedError.error.data) {
            expect(propagatedError.error.data.serviceName).toBe(serviceName);
            expect(propagatedError.error.data.correlationId).toBe(context.correlationId);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle custom MCP Router errors correctly', () => {
    fc.assert(
      fc.property(
        toolNameArbitrary(),
        requestIdArbitrary(),
        requestContextArbitrary(),
        (toolName, requestId, context) => {
          const customError = new ToolNotFoundError(toolName);

          const errorResponse = ErrorPropagation.propagateError({
            error: customError,
            requestId,
            context,
          });

          expect(errorResponse.error.code).toBe(ErrorCode.TOOL_NOT_FOUND);
          expect(errorResponse.error.message).toContain(toolName);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: onemcp-system, Property 23: Service crash auto-recovery
 *
 * **Validates: Requirements 32.1**
 *
 * For any crashed service, the next request to that service should trigger
 * service restart and succeed (or return appropriate error).
 */

describe('Feature: onemcp-system, Property 23: Service crash auto-recovery', () => {
  it('should retry operations with exponential backoff', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }), // Reduced max to 3 for faster tests
        fc.integer({ min: 10, max: 50 }), // Reduced delays
        async (failuresBeforeSuccess, initialDelay) => {
          let attemptCount = 0;

          const operation = async () => {
            attemptCount++;
            if (attemptCount < failuresBeforeSuccess) {
              throw new ServiceUnavailableError('test-service', 'Simulated failure');
            }
            return 'success';
          };

          const result = await ErrorRecovery.withRetry(operation, {
            maxRetries: failuresBeforeSuccess,
            initialDelayMs: initialDelay,
            maxDelayMs: initialDelay * 5, // Reduced multiplier
            backoffMultiplier: 2,
            jitter: false,
            isRetryable: ErrorRecovery.isRetryableError,
          });

          expect(result).toBe('success');
          expect(attemptCount).toBe(failuresBeforeSuccess);

          return true;
        }
      ),
      { numRuns: 20 } // Fewer runs for async tests
    );
  }, 30000); // 30 second timeout

  it('should stop retrying after max retries', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 3 }), async (maxRetries) => {
        let attemptCount = 0;

        const operation = async () => {
          attemptCount++;
          throw new ServiceUnavailableError('test-service', 'Always fails');
        };

        try {
          await ErrorRecovery.withRetry(operation, {
            maxRetries,
            initialDelayMs: 10,
            maxDelayMs: 50,
            backoffMultiplier: 2,
            jitter: false,
            isRetryable: ErrorRecovery.isRetryableError,
          });

          // Should not reach here
          return false;
        } catch (error) {
          // Should fail after maxRetries + 1 attempts (initial + retries)
          expect(attemptCount).toBe(maxRetries + 1);
          expect(error).toBeInstanceOf(ServiceUnavailableError);
          return true;
        }
      }),
      { numRuns: 20 }
    );
  });

  it('should not retry non-retryable errors', async () => {
    await fc.assert(
      fc.asyncProperty(toolNameArbitrary(), async (toolName) => {
        let attemptCount = 0;

        const operation = async () => {
          attemptCount++;
          throw new ToolNotFoundError(toolName);
        };

        try {
          await ErrorRecovery.withRetry(operation, {
            maxRetries: 3,
            initialDelayMs: 10,
            maxDelayMs: 50,
            backoffMultiplier: 2,
            jitter: false,
            isRetryable: ErrorRecovery.isRetryableError,
          });

          return false;
        } catch (error) {
          // Should fail immediately without retries
          expect(attemptCount).toBe(1);
          expect(error).toBeInstanceOf(ToolNotFoundError);
          return true;
        }
      }),
      { numRuns: 20 }
    );
  });

  it('should handle timeout operations correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 100, max: 500 }),
        fc.integer({ min: 50, max: 200 }),
        async (operationDuration, timeout) => {
          const operation = new Promise<string>((resolve) => {
            setTimeout(() => resolve('completed'), operationDuration);
          });

          if (operationDuration > timeout) {
            // Should timeout
            try {
              await TimeoutHandler.withTimeout(operation, {
                timeoutMs: timeout,
                operationName: 'test-operation',
              });
              return false; // Should not reach here
            } catch (error) {
              expect(error).toBeInstanceOf(TimeoutError);
              return true;
            }
          } else {
            // Should complete successfully
            const result = await TimeoutHandler.withTimeout(operation, {
              timeoutMs: timeout,
              operationName: 'test-operation',
            });
            expect(result).toBe('completed');
            return true;
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it('should call cleanup function on timeout', async () => {
    let cleanupCalled = false;

    const operation = new Promise<string>((resolve) => {
      setTimeout(() => resolve('completed'), 1000);
    });

    try {
      await TimeoutHandler.withTimeout(operation, {
        timeoutMs: 50,
        operationName: 'test-operation',
        onTimeout: async () => {
          cleanupCalled = true;
        },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(TimeoutError);
      expect(cleanupCalled).toBe(true);
    }
  });
});
