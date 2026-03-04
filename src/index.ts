/**
 * MCP Router System - Main Entry Point
 *
 * This is the main entry point for the MCP Router System library.
 * It exports the public API for programmatic usage.
 */

// Export all type definitions
export * from './types/index.js';

// Export protocol layer
export { JsonRpcParser } from './protocol/parser.js';
export { JsonRpcSerializer } from './protocol/serializer.js';

// Export transport layer
export { StdioTransport } from './transport/stdio.js';
export { HttpTransport } from './transport/http.js';

// Export storage layer
export { FileStorageAdapter, MemoryStorageAdapter } from './storage/index.js';

// Export mode runners
export { CliModeRunner } from './cli-mode.js';
export { ServerModeRunner } from './server-mode.js';

// Export session management
export { SessionManager } from './session/index.js';
export type { Session, SessionContext, ResourceLimits } from './session/index.js';
