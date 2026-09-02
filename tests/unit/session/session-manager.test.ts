/**
 * Unit tests for SessionManager
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { SessionManager } from '../../../src/session/session-manager';

describe('SessionManager', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createSession', () => {
    it('generates a random id when none is given', () => {
      const manager = new SessionManager();
      const s1 = manager.createSession('agent-1');
      const s2 = manager.createSession('agent-1');

      expect(s1.id).toBeTruthy();
      expect(s2.id).toBeTruthy();
      expect(s1.id).not.toBe(s2.id);
      expect(manager.getSession(s1.id)?.agentId).toBe('agent-1');
    });

    it('recreates a session under an explicit id (handle semantics)', () => {
      const manager = new SessionManager();
      const session = manager.createSession('agent-1', { initialized: true }, 'fixed-id');

      expect(session.id).toBe('fixed-id');
      expect(session.context.initialized).toBe(true);
      expect(manager.getSession('fixed-id')).toBe(session);
    });

    it('allows recreating an evicted session with the same id and fresh context', () => {
      vi.useFakeTimers();
      const manager = new SessionManager();
      manager.createSession('agent-1', { initialized: true }, 'fixed-id');

      // Simulate eviction
      vi.advanceTimersByTime(1000);
      manager.cleanupExpiredSessions(0);

      expect(manager.getSession('fixed-id')).toBeUndefined();

      const recreated = manager.createSession('agent-1', { initialized: true }, 'fixed-id');
      expect(recreated.id).toBe('fixed-id');
      expect(recreated.context.initialized).toBe(true);
      expect(recreated.activeRequests).toBe(0);
    });
  });

  describe('cleanupExpiredSessions', () => {
    it('only evicts sessions idle beyond the timeout with no active requests', () => {
      vi.useFakeTimers();
      const manager = new SessionManager();
      const idle = manager.createSession('agent-1');
      const busy = manager.createSession('agent-1');
      manager.incrementActiveRequests(busy.id);

      vi.advanceTimersByTime(10 * 60 * 1000);

      manager.cleanupExpiredSessions(5 * 60 * 1000);

      // Idle session evicted; busy session survives until its requests finish.
      expect(manager.getSession(idle.id)).toBeUndefined();
      expect(manager.getSession(busy.id)).toBeDefined();
    });
  });

  describe('session cap', () => {
    it('evicts oldest idle sessions when the cap is exceeded (safe under handle semantics)', () => {
      const manager = new SessionManager();
      for (let i = 0; i <= 10_000; i++) {
        manager.createSession('agent-1', {}, `s-${i}`);
      }

      // A buggy/hostile client presenting fresh ids per request cannot grow
      // the map without bound: the oldest idle sessions are evicted first.
      expect(manager.getSession('s-0')).toBeUndefined();
      expect(manager.getSession('s-10000')).toBeDefined();
      expect((manager as any).sessions.size).toBeLessThanOrEqual(10_001);
    });

    it('never evicts sessions with in-flight requests first', () => {
      const manager = new SessionManager();
      const busy = manager.createSession('agent-1', {}, 'busy-one');
      manager.incrementActiveRequests(busy.id);

      for (let i = 0; i <= 10_000; i++) {
        manager.createSession('agent-1', {}, `s-${i}`);
      }

      // The busy session may still be alive even though it is the oldest.
      expect(manager.getSession('busy-one')).toBeDefined();
      manager.decrementActiveRequests('busy-one');
    });
  });
});
