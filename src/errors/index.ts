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
