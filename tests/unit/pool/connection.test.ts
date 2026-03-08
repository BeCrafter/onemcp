/**
 * Unit tests for Connection utilities
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createConnection,
  updateConnectionState,
  isIdle,
  isBusy,
  isClosed,
  isIdleTimeout,
  type Connection,
} from '../../../src/pool/connection.js';
import type { Transport } from '../../../src/types/transport.js';

describe('Connection utilities', () => {
  let mockTransport: Transport;

  beforeEach(() => {
    mockTransport = {
      send: vi.fn(),
      receive: vi.fn(),
      close: vi.fn(),
      getType: vi.fn().mockReturnValue('stdio'),
    } as unknown as Transport;
  });

  describe('createConnection', () => {
    it('should create a connection with idle state', () => {
      const connection = createConnection('test-1', mockTransport);

      expect(connection.id).toBe('test-1');
      expect(connection.transport).toBe(mockTransport);
      expect(connection.state).toBe('idle');
      expect(connection.createdAt).toBeInstanceOf(Date);
      expect(connection.lastUsed).toBeInstanceOf(Date);
    });

    it('should set createdAt and lastUsed to same time', () => {
      const connection = createConnection('test-1', mockTransport);

      expect(connection.createdAt.getTime()).toBe(connection.lastUsed.getTime());
    });
  });

  describe('updateConnectionState', () => {
    let connection: Connection;

    beforeEach(() => {
      connection = createConnection('test-1', mockTransport);
    });

    it('should update state to busy', () => {
      const updated = updateConnectionState(connection, 'busy');

      expect(updated.state).toBe('busy');
      expect(updated.id).toBe(connection.id);
      expect(updated.transport).toBe(connection.transport);
    });

    it('should update lastUsed when transitioning to busy', () => {
      const originalLastUsed = connection.lastUsed;

      // Wait a bit to ensure time difference
      vi.useFakeTimers();
      vi.advanceTimersByTime(100);

      const updated = updateConnectionState(connection, 'busy');

      expect(updated.lastUsed.getTime()).toBeGreaterThan(originalLastUsed.getTime());

      vi.useRealTimers();
    });

    it('should not update lastUsed when transitioning to idle', () => {
      const busyConnection = updateConnectionState(connection, 'busy');
      const originalLastUsed = busyConnection.lastUsed;

      vi.useFakeTimers();
      vi.advanceTimersByTime(100);

      const idleConnection = updateConnectionState(busyConnection, 'idle');

      expect(idleConnection.lastUsed).toBe(originalLastUsed);

      vi.useRealTimers();
    });

    it('should update state to closed', () => {
      const updated = updateConnectionState(connection, 'closed');

      expect(updated.state).toBe('closed');
    });
  });

  describe('isIdle', () => {
    it('should return true for idle connection', () => {
      const connection = createConnection('test-1', mockTransport);
      expect(isIdle(connection)).toBe(true);
    });

    it('should return false for busy connection', () => {
      const connection = createConnection('test-1', mockTransport);
      const busy = updateConnectionState(connection, 'busy');
      expect(isIdle(busy)).toBe(false);
    });

    it('should return false for closed connection', () => {
      const connection = createConnection('test-1', mockTransport);
      const closed = updateConnectionState(connection, 'closed');
      expect(isIdle(closed)).toBe(false);
    });
  });

  describe('isBusy', () => {
    it('should return false for idle connection', () => {
      const connection = createConnection('test-1', mockTransport);
      expect(isBusy(connection)).toBe(false);
    });

    it('should return true for busy connection', () => {
      const connection = createConnection('test-1', mockTransport);
      const busy = updateConnectionState(connection, 'busy');
      expect(isBusy(busy)).toBe(true);
    });

    it('should return false for closed connection', () => {
      const connection = createConnection('test-1', mockTransport);
      const closed = updateConnectionState(connection, 'closed');
      expect(isBusy(closed)).toBe(false);
    });
  });

  describe('isClosed', () => {
    it('should return false for idle connection', () => {
      const connection = createConnection('test-1', mockTransport);
      expect(isClosed(connection)).toBe(false);
    });

    it('should return false for busy connection', () => {
      const connection = createConnection('test-1', mockTransport);
      const busy = updateConnectionState(connection, 'busy');
      expect(isClosed(busy)).toBe(false);
    });

    it('should return true for closed connection', () => {
      const connection = createConnection('test-1', mockTransport);
      const closed = updateConnectionState(connection, 'closed');
      expect(isClosed(closed)).toBe(true);
    });
  });

  describe('isIdleTimeout', () => {
    it('should return false for busy connection', () => {
      const connection = createConnection('test-1', mockTransport);
      const busy = updateConnectionState(connection, 'busy');

      expect(isIdleTimeout(busy, 1000)).toBe(false);
    });

    it('should return false for closed connection', () => {
      const connection = createConnection('test-1', mockTransport);
      const closed = updateConnectionState(connection, 'closed');

      expect(isIdleTimeout(closed, 1000)).toBe(false);
    });

    it('should return false for idle connection within timeout', () => {
      const connection = createConnection('test-1', mockTransport);

      expect(isIdleTimeout(connection, 60000)).toBe(false);
    });

    it('should return true for idle connection exceeding timeout', () => {
      vi.useFakeTimers();

      const connection = createConnection('test-1', mockTransport);

      // Advance time beyond idle timeout
      vi.advanceTimersByTime(61000);

      expect(isIdleTimeout(connection, 60000)).toBe(true);

      vi.useRealTimers();
    });

    it('should return false for idle connection exactly at timeout', () => {
      vi.useFakeTimers();

      const connection = createConnection('test-1', mockTransport);

      // Advance time to exactly the timeout
      vi.advanceTimersByTime(60000);

      expect(isIdleTimeout(connection, 60000)).toBe(false);

      vi.useRealTimers();
    });
  });
});
