/**
 * Unit tests for the unified form's form-data → service conversion.
 *
 * Regression guard for the expensive one: editing a service and saving used to
 * drop `toolStates`, because the form has no input for it and `register()`
 * replaces the whole entry. Every tool the user had switched off came back on.
 */

import { describe, it, expect } from 'vitest';
import {
  formDataToService,
  type FormData,
} from '../../../src/tui/components/ServiceFormUnified.js';
import type { ServiceDefinition } from '../../../src/types/service.js';

const baseData = (overrides: Partial<FormData> = {}): FormData => ({
  name: 'svc',
  transport: 'stdio',
  command: 'npx',
  url: '',
  args: '',
  env: '',
  headers: '',
  tags: '',
  enabled: true,
  maxConnections: '5',
  idleTimeout: '60000',
  connectionTimeout: '30000',
  triggerHintsStart: '',
  triggerHintsEnd: '',
  triggerHintsPhrases: '',
  ...overrides,
});

const existing: ServiceDefinition = {
  name: 'svc',
  transport: 'stdio',
  command: 'npx',
  enabled: true,
  tags: ['keep'],
  connectionPool: { maxConnections: 5, idleTimeout: 60000, connectionTimeout: 30000 },
  toolStates: { do_something: false, other_tool: true },
};

describe('formDataToService', () => {
  it('keeps the tool states of the service being edited', () => {
    const saved = formDataToService(baseData(), existing);
    expect(saved.toolStates).toEqual({ do_something: false, other_tool: true });
  });

  it('omits tool states for a new service', () => {
    expect(formDataToService(baseData())).not.toHaveProperty('toolStates');
  });

  it('parses the comma-separated lists', () => {
    const saved = formDataToService(
      baseData({
        tags: 'prod, api ,,',
        args: '-y, @modelcontextprotocol/server-filesystem, /tmp',
        env: 'NODE_ENV=production, DEBUG=true',
      })
    );
    expect(saved.tags).toEqual(['prod', 'api']);
    expect(saved.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '/tmp']);
    expect(saved.env).toEqual({ NODE_ENV: 'production', DEBUG: 'true' });
  });

  it('drops the stdio fields when the transport is switched to http', () => {
    const saved = formDataToService(
      baseData({ transport: 'http', url: 'https://api.example.com/mcp', command: 'npx' }),
      existing
    );
    expect(saved.transport).toBe('http');
    expect(saved.url).toBe('https://api.example.com/mcp');
    expect(saved.command).toBeUndefined();
    expect(saved.args).toBeUndefined();
  });

  it('assembles trigger hints only from the values that are set', () => {
    expect(formDataToService(baseData()).triggerHints).toBeUndefined();
    expect(
      formDataToService(baseData({ triggerHintsStart: 'start here', triggerHintsPhrases: 'a, b' }))
        .triggerHints
    ).toEqual({ onSessionStart: 'start here', phrases: ['a', 'b'] });
  });

  it('falls back to the documented pool defaults for empty values', () => {
    const saved = formDataToService(
      baseData({ maxConnections: '', idleTimeout: '', connectionTimeout: '' })
    );
    expect(saved.connectionPool).toEqual({
      maxConnections: 5,
      idleTimeout: 60000,
      connectionTimeout: 30000,
    });
  });
});
