/**
 * Connection Pool module exports
 */

export type {
  Connection,
} from './connection.js';

export {
  createConnection,
  updateConnectionState,
  isIdle,
  isBusy,
  isClosed,
  isIdleTimeout,
} from './connection.js';

export {
  ConnectionPool,
  ConnectionPoolError,
} from './connection-pool.js';
