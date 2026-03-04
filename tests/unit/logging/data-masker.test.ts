/**
 * Unit tests for DataMasker
 */

import { describe, it, expect } from 'vitest';
import { createDataMasker, DEFAULT_SENSITIVE_PATTERNS } from '../../../src/logging/data-masker.js';

describe('DataMasker', () => {
  describe('Object Masking', () => {
    it('should mask sensitive fields in flat objects', () => {
      const masker = createDataMasker({
        enabled: true,
        patterns: ['password', 'token', 'secret'],
      });

      const obj = {
        username: 'john',
        password: 'secret123',
        token: 'abc-def-ghi',
        email: 'john@example.com',
      };

      const masked = masker.maskObject(obj) as any;

      expect(masked.username).toBe('john');
      expect(masked.password).toBe('***MASKED***');
      expect(masked.token).toBe('***MASKED***');
      expect(masked.email).toBe('john@example.com');
    });

    it('should mask sensitive fields in nested objects', () => {
      const masker = createDataMasker({
        enabled: true,
        patterns: ['password', 'apiKey'],
      });

      const obj = {
        user: {
          name: 'Alice',
          password: 'pass123',
        },
        config: {
          apiKey: 'key-123',
          timeout: 5000,
        },
      };

      const masked = masker.maskObject(obj) as any;

      expect(masked.user.name).toBe('Alice');
      expect(masked.user.password).toBe('***MASKED***');
      expect(masked.config.apiKey).toBe('***MASKED***');
      expect(masked.config.timeout).toBe(5000);
    });

    it('should mask sensitive fields in arrays', () => {
      const masker = createDataMasker({
        enabled: true,
        patterns: ['password'],
      });

      const obj = {
        users: [
          { name: 'Alice', password: 'pass1' },
          { name: 'Bob', password: 'pass2' },
        ],
      };

      const masked = masker.maskObject(obj) as any;

      expect(masked.users[0].name).toBe('Alice');
      expect(masked.users[0].password).toBe('***MASKED***');
      expect(masked.users[1].name).toBe('Bob');
      expect(masked.users[1].password).toBe('***MASKED***');
    });

    it('should handle null and undefined values', () => {
      const masker = createDataMasker({
        enabled: true,
        patterns: ['password'],
      });

      expect(masker.maskObject(null)).toBe(null);
      expect(masker.maskObject(undefined)).toBe(undefined);
      expect(masker.maskObject({ value: null })).toEqual({ value: null });
    });

    it('should not mask when disabled', () => {
      const masker = createDataMasker({
        enabled: false,
        patterns: ['password', 'token'],
      });

      const obj = {
        password: 'secret',
        token: 'abc123',
      };

      const masked = masker.maskObject(obj);

      expect(masked).toEqual(obj);
    });

    it('should use custom replacement string', () => {
      const masker = createDataMasker({
        enabled: true,
        patterns: ['password'],
        replacement: '[REDACTED]',
      });

      const obj = { password: 'secret' };
      const masked = masker.maskObject(obj) as any;

      expect(masked.password).toBe('[REDACTED]');
    });
  });

  describe('String Masking', () => {
    it('should mask sensitive patterns in strings', () => {
      const masker = createDataMasker({
        enabled: true,
        patterns: ['password', 'token'],
      });

      const str = 'User login with password=secret123 and token=abc-def';
      const masked = masker.maskString(str);

      // Both the pattern and the value should be masked
      expect(masked).toContain('***MASKED***');
      expect(masked).not.toContain('secret123');
      expect(masked).not.toContain('abc-def');
      expect(masked).not.toContain('password');
      expect(masked).not.toContain('token');
    });

    it('should mask patterns with colon separator', () => {
      const masker = createDataMasker({
        enabled: true,
        patterns: ['apiKey'],
      });

      const str = 'Config: apiKey: my-secret-key';
      const masked = masker.maskString(str);

      expect(masked).toContain('***MASKED***');
      expect(masked).not.toContain('my-secret-key');
      expect(masked).not.toContain('apiKey');
    });

    it('should not mask when disabled', () => {
      const masker = createDataMasker({
        enabled: false,
        patterns: ['password'],
      });

      const str = 'password=secret123';
      const masked = masker.maskString(str);

      expect(masked).toBe(str);
    });
  });

  describe('Pattern Management', () => {
    it('should support case-insensitive matching', () => {
      const masker = createDataMasker({
        enabled: true,
        patterns: ['password'],
      });

      const obj = {
        Password: 'secret1',
        PASSWORD: 'secret2',
        password: 'secret3',
      };

      const masked = masker.maskObject(obj) as any;

      expect(masked.Password).toBe('***MASKED***');
      expect(masked.PASSWORD).toBe('***MASKED***');
      expect(masked.password).toBe('***MASKED***');
    });

    it('should update patterns dynamically', () => {
      const masker = createDataMasker({
        enabled: true,
        patterns: ['password'],
      });

      let obj = { password: 'secret', token: 'abc' };
      let masked = masker.maskObject(obj) as any;

      expect(masked.password).toBe('***MASKED***');
      expect(masked.token).toBe('abc');

      // Update patterns
      masker.updatePatterns(['password', 'token']);

      obj = { password: 'secret', token: 'abc' };
      masked = masker.maskObject(obj) as any;

      expect(masked.password).toBe('***MASKED***');
      expect(masked.token).toBe('***MASKED***');
    });

    it('should enable/disable masking dynamically', () => {
      const masker = createDataMasker({
        enabled: true,
        patterns: ['password'],
      });

      const obj = { password: 'secret' };

      let masked = masker.maskObject(obj) as any;
      expect(masked.password).toBe('***MASKED***');

      masker.setEnabled(false);
      masked = masker.maskObject(obj) as any;
      expect(masked.password).toBe('secret');

      masker.setEnabled(true);
      masked = masker.maskObject(obj) as any;
      expect(masked.password).toBe('***MASKED***');
    });
  });

  describe('Default Patterns', () => {
    it('should include common sensitive patterns', () => {
      expect(DEFAULT_SENSITIVE_PATTERNS).toContain('password');
      expect(DEFAULT_SENSITIVE_PATTERNS).toContain('token');
      expect(DEFAULT_SENSITIVE_PATTERNS).toContain('secret');
      expect(DEFAULT_SENSITIVE_PATTERNS).toContain('key');
      expect(DEFAULT_SENSITIVE_PATTERNS).toContain('apikey');
    });

    it('should mask all default patterns', () => {
      const masker = createDataMasker({
        enabled: true,
        patterns: DEFAULT_SENSITIVE_PATTERNS,
      });

      const obj = {
        password: 'pass',
        token: 'tok',
        secret: 'sec',
        apiKey: 'key',
        authorization: 'auth',
      };

      const masked = masker.maskObject(obj) as any;

      expect(masked.password).toBe('***MASKED***');
      expect(masked.token).toBe('***MASKED***');
      expect(masked.secret).toBe('***MASKED***');
      expect(masked.apiKey).toBe('***MASKED***');
      expect(masked.authorization).toBe('***MASKED***');
    });
  });
});
