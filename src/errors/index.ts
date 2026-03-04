/**
 * Error handling system exports
 */

// Error builder
export { ErrorBuilder } from './error-builder.js';
export type { ErrorBuilderOptions } from './error-builder.js';

// Custom errors
export {
  McpRouterError,
  ToolNotFoundError,
  ToolDisabledError,
  ServiceUnavailableError,
  ServiceUnhealthyError,
  ConnectionPoolExhaustedError,
  TimeoutError,
  ValidationError,
  ConfigurationError,
  SessionError,
  ParseError,
  InvalidRequestError,
  MethodNotFoundError,
  InvalidParamsError,
} from './custom-errors.js';

// Error propagation
export { ErrorPropagation } from './error-propagation.js';
export type { ErrorPropagationOptions } from './error-propagation.js';

// Timeout handling
export { TimeoutHandler } from './timeout-handler.js';
export type { TimeoutOptions } from './timeout-handler.js';

// Error recovery
export { ErrorRecovery } from './error-recovery.js';
export type { RetryOptions } from './error-recovery.js';
