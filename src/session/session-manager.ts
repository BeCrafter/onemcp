/**
 * Session Manager
 *
 * Manages multiple AI Agent sessions in Server mode, ensuring complete isolation
 * between different clients.
 */

import { randomUUID } from 'node:crypto';
import type { TagFilter } from '../types/tool.js';

/**
 * Session context containing session-specific configuration
 */
export interface SessionContext {
  tagFilter?: TagFilter;
  resourceLimits?: ResourceLimits;
  metadata?: Record<string, unknown>;
}

/**
 * Resource limits for a session
 */
export interface ResourceLimits {
  maxConcurrentRequests?: number;
  requestTimeout?: number;
}

/**
 * Session representing a single AI Agent connection
 */
export interface Session {
  id: string;
  agentId: string;
  createdAt: Date;
  lastActivity: Date;
  context: SessionContext;
  activeRequests: number;
}

/**
 * Session Manager class
 *
 * Manages the lifecycle of sessions in Server mode:
 * - Creates new sessions for connecting clients
 * - Tracks active sessions
 * - Cleans up expired sessions
 * - Ensures session isolation
 */
export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  /**
   * Create a new session for an AI Agent
   *
   * @param agentId - Identifier for the AI Agent
   * @param context - Session-specific context
   * @returns The created session
   */
  createSession(agentId: string, context: SessionContext = {}): Session {
    const session: Session = {
      id: randomUUID(),
      agentId,
      createdAt: new Date(),
      lastActivity: new Date(),
      context,
      activeRequests: 0,
    };

    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Get a session by ID
   *
   * @param sessionId - Session ID
   * @returns The session if found, undefined otherwise
   */
  getSession(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Update last activity time
      session.lastActivity = new Date();
    }
    return session;
  }

  /**
   * Close a session and clean up resources
   *
   * @param sessionId - Session ID to close
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    // Wait for active requests to complete (with timeout)
    const timeout = 5000; // 5 seconds
    const startTime = Date.now();
    while (session.activeRequests > 0 && Date.now() - startTime < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Remove the session
    this.sessions.delete(sessionId);
  }

  /**
   * List all active sessions
   *
   * @returns Array of all active sessions
   */
  listActiveSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Clean up expired sessions
   *
   * @param timeout - Session timeout in milliseconds
   */
  cleanupExpiredSessions(timeout: number): void {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      const inactiveTime = now - session.lastActivity.getTime();
      if (inactiveTime > timeout && session.activeRequests === 0) {
        expiredSessions.push(sessionId);
      }
    }

    for (const sessionId of expiredSessions) {
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Start automatic cleanup of expired sessions
   *
   * @param interval - Cleanup interval in milliseconds
   * @param timeout - Session timeout in milliseconds
   */
  startAutoCleanup(interval: number, timeout: number): void {
    if (this.cleanupInterval) {
      return;
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions(timeout);
    }, interval);
  }

  /**
   * Stop automatic cleanup
   */
  stopAutoCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Increment active request count for a session
   *
   * @param sessionId - Session ID
   */
  incrementActiveRequests(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.activeRequests++;
    }
  }

  /**
   * Decrement active request count for a session
   *
   * @param sessionId - Session ID
   */
  decrementActiveRequests(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.activeRequests = Math.max(0, session.activeRequests - 1);
    }
  }

  /**
   * Get the number of active sessions
   */
  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Close all sessions
   */
  async closeAllSessions(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map((id) => this.closeSession(id)));
  }
}
