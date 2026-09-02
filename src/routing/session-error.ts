/**
 * Shared error classification for backend connection recovery.
 *
 * Used by the ToolRouter retry loops and the TUI discovery worker to decide
 * whether a failure can be transparently recovered on a fresh connection.
 */

import { TransportError } from '../transport/base.js';

/**
 * Transport error codes meaning "this connection object is dead but the
 * backend itself is reachable again on a fresh connection" (stdio process
 * exit, SSE stream drop, ...).
 *
 * RESPONSE_STREAM_ENDED is included deliberately: the receive stream ended,
 * which means the transport is definitively dead, and the error surfaces
 * immediately (unlike RESPONSE_TIMEOUT, where retrying would double a 60s
 * wait). Deliberately excluded: HTTP_TIMEOUT / RESPONSE_TIMEOUT /
 * RESPONSE_MISMATCH (router-level waits — retrying would double the latency),
 * network-unreachable errors (HTTP_SEND_FAILED — a fresh connection hits the
 * same network), and acquire-phase errors (CONNECTION_FAILED,
 * PROCESS_START_FAILED).
 */
const RECOVERABLE_CONNECTION_CODES = new Set([
  'PROCESS_EXITED',
  'PROCESS_ERROR',
  'STDIN_UNAVAILABLE',
  'STDIN_DESTROYED',
  'STDIN_WRITE_FAILED',
  'TRANSPORT_CLOSED',
  'TRANSPORT_CLOSING',
  'TRANSPORT_ERROR',
  'SEND_FAILED',
  'SSE_CONNECTION_FAILED',
  'SSE_NOT_CONNECTED',
  'SSE_INIT_FAILED',
  'RESPONSE_STREAM_ENDED',
]);

/**
 * Whether an error indicates the backend session has expired or is no longer valid.
 *
 * SSE/HTTP backends often report an expired session as a JSON-RPC *error*
 * (HTTP 200, code `-32001` or a "session ... not found/expired" message) rather
 * than dropping the connection. Spec-conformant Streamable HTTP backends
 * instead answer a stale `Mcp-Session-Id` with HTTP 404, which surfaces as a
 * TransportError with code `HTTP_REQUEST_FAILED` and "status 404" in the
 * message. In all these cases the connection must be invalidated and
 * re-initialized — releasing it back into the pool would keep reusing the
 * stale session and fail every subsequent tools/list / tools/call.
 */
export function isSessionExpiryError(error: unknown): boolean {
  if (error instanceof TransportError && error.code === 'SESSION_EXPIRED') {
    return true;
  }

  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (code === -32001) {
      return true;
    }
  }

  if (error instanceof Error) {
    // Ordered match only: "session" must precede the expiry signal so an
    // unrelated error like "tool X not found in session Y" isn't misclassified.
    if (/session\b.*\b(not found|expired)/i.test(error.message)) {
      return true;
    }

    // Spec-conformant backends answer a stale Mcp-Session-Id with HTTP 404.
    // doSend surfaces non-2xx responses as HTTP_SEND_FAILED wrapping the inner
    // HTTP_REQUEST_FAILED message ("...status 404: ..."), so match both codes.
    // The SSE GET listen stream never produces these codes, so a 404 here
    // cannot be a normal listen-stream 404 (which must not trigger a rebuild).
    if (
      error instanceof TransportError &&
      (error.code === 'HTTP_SEND_FAILED' || error.code === 'HTTP_REQUEST_FAILED') &&
      /\bstatus 404\b/.test(error.message)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Whether an error means the connection object died but the backend is
 * reachable again on a fresh connection (stdio respawn, SSE reconnect).
 * Such failures are safe to retry once on a new connection.
 */
export function isRecoverableConnectionError(error: unknown): boolean {
  return (
    error instanceof TransportError &&
    typeof error.code === 'string' &&
    RECOVERABLE_CONNECTION_CODES.has(error.code)
  );
}
