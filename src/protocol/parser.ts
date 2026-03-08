/**
 * JSON-RPC 2.0 Parser
 *
 * Parses and validates JSON-RPC 2.0 messages according to the specification.
 */

import Ajv, { type ValidateFunction } from 'ajv';
import {
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcSuccessResponse,
  type JsonRpcErrorResponse,
  type JsonRpcNotification,
  type ValidationResult,
} from '../types/jsonrpc.js';

/**
 * JSON-RPC 2.0 Parser class
 *
 * Provides methods to parse and validate JSON-RPC 2.0 messages.
 */
export class JsonRpcParser {
  private ajv: Ajv;
  private validateRequest: ValidateFunction;
  private validateResponse: ValidateFunction;
  private validateNotification: ValidateFunction;

  constructor() {
    this.ajv = new Ajv({ allErrors: true });

    // Define JSON-RPC 2.0 request schema
    const requestSchema = {
      type: 'object',
      required: ['jsonrpc', 'id', 'method'],
      properties: {
        jsonrpc: { type: 'string', const: '2.0' },
        id: { oneOf: [{ type: 'string' }, { type: 'number' }] },
        method: { type: 'string' },
        params: {},
      },
      additionalProperties: false,
    };

    // Define JSON-RPC 2.0 success response schema
    const successResponseSchema = {
      type: 'object',
      required: ['jsonrpc', 'id', 'result'],
      properties: {
        jsonrpc: { type: 'string', const: '2.0' },
        id: { oneOf: [{ type: 'string' }, { type: 'number' }] },
        result: {},
      },
      additionalProperties: false,
    };

    // Define JSON-RPC 2.0 error response schema
    const errorResponseSchema = {
      type: 'object',
      required: ['jsonrpc', 'id', 'error'],
      properties: {
        jsonrpc: { type: 'string', const: '2.0' },
        id: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] },
        error: {
          type: 'object',
          required: ['code', 'message'],
          properties: {
            code: { type: 'number' },
            message: { type: 'string' },
            data: {},
          },
        },
      },
      additionalProperties: false,
    };

    // Define JSON-RPC 2.0 notification schema
    const notificationSchema = {
      type: 'object',
      required: ['jsonrpc', 'method'],
      properties: {
        jsonrpc: { type: 'string', const: '2.0' },
        method: { type: 'string' },
        params: {},
      },
      not: {
        required: ['id'],
      },
      additionalProperties: false,
    };

    // Compile schemas
    this.validateRequest = this.ajv.compile(requestSchema);
    this.validateResponse = this.ajv.compile({
      oneOf: [successResponseSchema, errorResponseSchema],
    });
    this.validateNotification = this.ajv.compile(notificationSchema);
  }

  /**
   * Parse a JSON-RPC 2.0 message from a string
   *
   * @param raw - Raw JSON string to parse
   * @returns Parsed JSON-RPC message
   * @throws Error if the JSON is malformed or invalid
   */
  parse(raw: string): JsonRpcMessage {
    // Step 1: Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `Parse error: Invalid JSON - ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // Step 2: Validate basic structure
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Parse error: Message must be a JSON object');
    }

    // Step 3: Validate and return the message
    const validationResult = this.validate(parsed as JsonRpcMessage);
    if (!validationResult.valid) {
      const errorMessages = validationResult.errors
        ?.map((e) => `${e.path}: ${e.message}`)
        .join(', ');
      throw new Error(`Invalid request: ${errorMessages}`);
    }

    return parsed as JsonRpcMessage;
  }

  /**
   * Validate a JSON-RPC 2.0 message
   *
   * @param message - Message to validate
   * @returns Validation result with errors if any
   */
  validate(message: JsonRpcMessage): ValidationResult {
    // Check if it's a valid JSON object
    if (typeof message !== 'object' || message === null) {
      return {
        valid: false,
        errors: [{ path: '', message: 'Message must be a JSON object' }],
      };
    }

    // Check jsonrpc version
    if (message.jsonrpc !== '2.0') {
      return {
        valid: false,
        errors: [{ path: 'jsonrpc', message: 'Must be "2.0"' }],
      };
    }

    // Determine message type and validate accordingly
    const hasId = 'id' in message;
    const hasMethod = 'method' in message;
    const hasResult = 'result' in message;
    const hasError = 'error' in message;

    let isValid = false;
    let validator: ValidateFunction | null = null;

    if (hasMethod && hasId) {
      // Request
      validator = this.validateRequest;
      isValid = validator(message);
    } else if (hasMethod && !hasId) {
      // Notification
      validator = this.validateNotification;
      isValid = validator(message);
    } else if ((hasResult || hasError) && hasId) {
      // Response
      validator = this.validateResponse;
      isValid = validator(message);
    } else {
      return {
        valid: false,
        errors: [
          {
            path: '',
            message: 'Invalid message structure: must be a request, response, or notification',
          },
        ],
      };
    }

    if (!isValid && validator?.errors) {
      return {
        valid: false,
        errors: validator.errors.map((error) => ({
          path: error.instancePath || error.schemaPath || '',
          message: error.message || 'Validation error',
        })),
      };
    }

    return { valid: true };
  }

  /**
   * Check if a message is a request
   */
  isRequest(message: JsonRpcMessage): message is JsonRpcRequest {
    return 'method' in message && 'id' in message;
  }

  /**
   * Check if a message is a success response
   */
  isSuccessResponse(message: JsonRpcMessage): message is JsonRpcSuccessResponse {
    return 'result' in message && 'id' in message;
  }

  /**
   * Check if a message is an error response
   */
  isErrorResponse(message: JsonRpcMessage): message is JsonRpcErrorResponse {
    return 'error' in message && 'id' in message;
  }

  /**
   * Check if a message is a notification
   */
  isNotification(message: JsonRpcMessage): message is JsonRpcNotification {
    return 'method' in message && !('id' in message);
  }
}
