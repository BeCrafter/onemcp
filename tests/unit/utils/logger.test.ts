import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeLogger, configureLogger, info, setStderrEnabled } from '../../../src/utils/logger.js';
import type { SystemConfig } from '../../../src/types/config.js';

const createConfig = (configDir: string): SystemConfig => ({
  mode: 'server',
  logLevel: 'INFO',
  configDir,
  mcpServers: {},
  connectionPool: { maxConnections: 1, idleTimeout: 1000, connectionTimeout: 1000 },
  healthCheck: { enabled: false, interval: 1000, failureThreshold: 1, autoUnload: true },
  audit: {
    enabled: false,
    level: 'minimal',
    logInput: false,
    logOutput: false,
    retention: { days: 1, maxSize: '1MB' },
  },
  security: { dataMasking: { enabled: true, patterns: ['token', 'password'] } },
  logging: { level: 'INFO', outputs: ['file'], format: 'json', filePath: 'router.log' },
});

describe('configuration-driven logger', () => {
  let configDir: string | null = null;

  afterEach(async () => {
    await closeLogger();
    setStderrEnabled(true);
    if (configDir !== null) {
      await rm(configDir, { recursive: true, force: true });
      configDir = null;
    }
  });

  it('writes structured configured file logs and masks sensitive values', async () => {
    configDir = await mkdtemp(join(tmpdir(), 'onemcp-logger-'));
    configureLogger(createConfig(configDir));
    setStderrEnabled(false);

    info('backend token=super-secret', {
      correlationId: 'correlation-123',
      password: 'not-for-logs',
    });
    await closeLogger();

    const content = await readFile(join(configDir, 'router.log'), 'utf8');
    const record = JSON.parse(content) as Record<string, unknown>;
    expect(record['level']).toBe('INFO');
    expect(record['correlationId']).toBe('correlation-123');
    expect(record['password']).toBe('***MASKED***');
    expect(content).not.toContain('super-secret');
    expect(content).not.toContain('not-for-logs');
  });
});
