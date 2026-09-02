/**
 * Unit tests for the shared backend error classifiers (session-error.ts)
 */

import { describe, it, expect } from 'vitest';
import { TransportError } from '../../../src/transport/base';
import {
  isRecoverableConnectionError,
  isSessionExpiryError,
} from '../../../src/routing/session-error';

describe('isSessionExpiryError', () => {
  it('recognizes a JSON-RPC -32001 error object', () => {
    const error = Object.assign(new Error('Session not found or expired'), { code: -32001 });
    expect(isSessionExpiryError(error)).toBe(true);
  });

  it('recognizes session expiry from the message alone (ordered match)', () => {
    expect(isSessionExpiryError(new Error('Session not found or expired. Please re-init'))).toBe(
      true
    );
    expect(isSessionExpiryError(new Error('the session has expired'))).toBe(true);
  });

  it('does not misclassify "tool not found in session" errors', () => {
    expect(isSessionExpiryError(new Error("Tool 'foo' not found in session local"))).toBe(false);
  });

  it('recognizes a spec-conformant HTTP 404 session expiry', () => {
    // Real propagation shape: doSend re-wraps the inner HTTP_REQUEST_FAILED
    // into HTTP_SEND_FAILED with the status message embedded.
    expect(
      isSessionExpiryError(
        new TransportError(
          'Failed to send HTTP request: HTTP request failed with status 404: Not Found',
          'HTTP_SEND_FAILED'
        )
      )
    ).toBe(true);
    // In case the inner error ever propagates unwrapped.
    expect(
      isSessionExpiryError(
        new TransportError('HTTP request failed with status 404: Not Found', 'HTTP_REQUEST_FAILED')
      )
    ).toBe(true);
  });

  it('does not treat non-404 send failures as session expiry', () => {
    expect(
      isSessionExpiryError(
        new TransportError(
          'Failed to send HTTP request: HTTP request failed with status 500: Oops',
          'HTTP_SEND_FAILED'
        )
      )
    ).toBe(false);
  });

  it('requires the TransportError type for the status-404 branch (no side-effect misfires)', () => {
    // A plain Error (e.g. a tool's business error message) mentioning 404 must
    // not be classified as session expiry — retrying it could repeat side effects.
    expect(isSessionExpiryError(new Error('upstream returned status 404'))).toBe(false);
    expect(
      isSessionExpiryError(
        new TransportError('HTTP request failed with status 4041: Nope', 'HTTP_REQUEST_FAILED')
      )
    ).toBe(false);
  });

  it('returns false for unrelated errors', () => {
    expect(isSessionExpiryError(null)).toBe(false);
    expect(isSessionExpiryError(new Error('boom'))).toBe(false);
    expect(isSessionExpiryError(new TransportError('Response timeout', 'RESPONSE_TIMEOUT'))).toBe(
      false
    );
  });
});

describe('isRecoverableConnectionError', () => {
  it('recognizes dead-but-reconnectable transport failures', () => {
    expect(
      isRecoverableConnectionError(
        new TransportError('Process exited with code 0', 'PROCESS_EXITED')
      )
    ).toBe(true);
    expect(
      isRecoverableConnectionError(
        new TransportError('SSE connection lost', 'SSE_CONNECTION_FAILED')
      )
    ).toBe(true);
    expect(isRecoverableConnectionError(new TransportError('closed', 'TRANSPORT_CLOSED'))).toBe(
      true
    );
  });

  it('excludes timeouts and network-unreachable errors (fail fast)', () => {
    expect(
      isRecoverableConnectionError(new TransportError('Response timeout', 'RESPONSE_TIMEOUT'))
    ).toBe(false);
    expect(
      isRecoverableConnectionError(new TransportError('fetch failed', 'HTTP_SEND_FAILED'))
    ).toBe(false);
    expect(
      isRecoverableConnectionError(new TransportError('request failed', 'HTTP_REQUEST_FAILED'))
    ).toBe(false);
  });

  it('treats an ended receive stream as recoverable (immediate error, dead transport)', () => {
    expect(
      isRecoverableConnectionError(
        new TransportError('transport stream ended', 'RESPONSE_STREAM_ENDED')
      )
    ).toBe(true);
  });

  it('returns false for non-transport errors', () => {
    expect(isRecoverableConnectionError(new Error('PROCESS_EXITED'))).toBe(false);
    expect(isRecoverableConnectionError(null)).toBe(false);
  });
});
