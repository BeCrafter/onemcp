/**
 * Integration test: the TUI's tool-call path recovers from a backend that died
 * mid-call.
 *
 * The ToolRouter retries two failure families on a fresh connection — an expired
 * backend session and a dead-but-reconnectable transport (stdio child exit, SSE
 * drop). The TUI worker used to retry only the session family, so running a tool
 * against a crashed stdio backend failed in the tools view while the router
 * would have respawned and replayed. This pins the aligned behaviour with a real
 * subprocess: the fixture dies on its first `tools/call` and answers normally on
 * the next attempt.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callServiceTool } from '../../src/tui/discovery-worker.js';
import type { ServiceDefinition } from '../../src/types/service.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/flaky-stdio-mcp.cjs', import.meta.url));

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('callServiceTool transport recovery', () => {
  it('retries on a fresh connection when the stdio backend dies mid-call', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'onemcp-flaky-'));
    tempDirs.push(dir);
    const marker = join(dir, 'first-attempt-done');

    const service: ServiceDefinition = {
      name: 'flaky',
      transport: 'stdio',
      enabled: true,
      tags: [],
      command: `node ${FIXTURE}`,
      env: { FLAKY_MARKER: marker },
      connectionPool: { maxConnections: 1, idleTimeout: 60000, connectionTimeout: 10000 },
    };

    const outcome = await callServiceTool(service, 'echo', { text: 'hi' }, 10_000);

    expect(outcome.isError).toBe(false);
    expect(outcome.text).toContain('echo: "hi"');
  }, 20_000);

  it('still surfaces a non-recoverable failure instead of looping', async () => {
    const service: ServiceDefinition = {
      name: 'missing-command',
      transport: 'stdio',
      enabled: true,
      tags: [],
      command: 'node /nonexistent/definitely-not-here.cjs',
      connectionPool: { maxConnections: 1, idleTimeout: 60000, connectionTimeout: 5000 },
    };

    await expect(callServiceTool(service, 'echo', { text: 'hi' }, 5_000)).rejects.toThrow();
  }, 20_000);
});
