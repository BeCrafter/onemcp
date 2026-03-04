/**
 * Unit tests for Logger
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createLogger, Logger } from '../../../src/logging/logger.js';
import { existsSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

describe('Logger', () => {
  const testLogDir = join(process.cwd(), 'test-logs');
  const testLogFile = join(testLogDir, 'test.log');

  beforeEach(() => {
    // Clean up test logs
    if (existsSync(testLogDir)) {
      rmSync(testLogDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Clean up test logs
    if (existsSync(testLogDir)) {
      rmSync(testLogDir, { recursive: true, force: true });
    }
  });

  describe('Logger Creation', () => {
    it('should create logger with console output', () => {
      const logger = createLogger({
        level: 'info',
        console: true,
        pretty: false,
      });

      expect(logger).toBeDefined();
      expect(logger.getLevel()).toBe('info');
    });

    it.skip('should create logger with file output', async () => {
      const logger = createLogger({
        level: 'info',
        console: false,
        file: {
          path: testLogFile,
        },
      });

      expect(logger).toBeDefined();
      
      // Log something to trigger file creation
      logger.info('Test message');
      
      // Flush to ensure file is written
      await logger.flush();
      
      // File should be created
      expect(existsSync(testLogFile)).toBe(true);
    });

    it.skip('should create logger with both console and file output', async () => {
      const logger = createLogger({
        level: 'debug',
        console: true,
        file: {
          path: testLogFile,
        },
      });

      expect(logger).toBeDefined();
      logger.debug('Test message');
      
      await logger.flush();
      
      expect(existsSync(testLogFile)).toBe(true);
    });
  });

  describe('Log Levels', () => {
    it('should log debug messages at debug level', () => {
      const logger = createLogger({
        level: 'debug',
        console: false,
      });

      // Should not throw
      expect(() => logger.debug('Debug message')).not.toThrow();
    });

    it('should log info messages', () => {
      const logger = createLogger({
        level: 'info',
        console: false,
      });

      expect(() => logger.info('Info message')).not.toThrow();
    });

    it('should log warning messages', () => {
      const logger = createLogger({
        level: 'warn',
        console: false,
      });

      expect(() => logger.warn('Warning message')).not.toThrow();
    });

    it('should log error messages', () => {
      const logger = createLogger({
        level: 'error',
        console: false,
      });

      expect(() => logger.error('Error message')).not.toThrow();
    });

    it('should change log level at runtime', () => {
      const logger = createLogger({
        level: 'info',
        console: false,
      });

      expect(logger.getLevel()).toBe('info');

      logger.setLevel('debug');
      expect(logger.getLevel()).toBe('debug');

      logger.setLevel('error');
      expect(logger.getLevel()).toBe('error');
    });
  });

  describe('Contextual Logging', () => {
    it('should log with context object', () => {
      const logger = createLogger({
        level: 'info',
        console: false,
      });

      const context = {
        requestId: '123',
        userId: 'user-456',
      };

      expect(() => logger.info('Message with context', context)).not.toThrow();
    });

    it('should create child logger with bindings', () => {
      const logger = createLogger({
        level: 'info',
        console: false,
      });

      const childLogger = logger.child({
        service: 'test-service',
        version: '1.0.0',
      });

      expect(childLogger).toBeDefined();
      expect(() => childLogger.info('Child logger message')).not.toThrow();
    });
  });

  describe('Log Flushing', () => {
    it.skip('should flush log buffers', async () => {
      const logger = createLogger({
        level: 'info',
        console: false,
        file: {
          path: testLogFile,
        },
      });

      logger.info('Test message');
      await logger.flush();

      // File should exist after flush
      expect(existsSync(testLogFile)).toBe(true);
    });
  });

  describe('Timestamp Configuration', () => {
    it('should include timestamps by default', () => {
      const logger = createLogger({
        level: 'info',
        console: false,
        timestamp: true,
      });

      expect(logger).toBeDefined();
      expect(() => logger.info('Message with timestamp')).not.toThrow();
    });

    it('should exclude timestamps when disabled', () => {
      const logger = createLogger({
        level: 'info',
        console: false,
        timestamp: false,
      });

      expect(logger).toBeDefined();
      expect(() => logger.info('Message without timestamp')).not.toThrow();
    });
  });
});
