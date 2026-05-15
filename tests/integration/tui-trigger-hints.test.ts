/**
 * Integration tests for triggerHints support across the three TUI input paths:
 *  - ServiceJsonEditor (validateJson) — mcpServers map and array branches
 *  - ServiceFormUnified (formDataToService)
 *  - ServiceForm (formDataToService)
 *
 * These tests pin the behaviour we just added: triggerHints fields must be
 * accepted from JSON, assembled from the form fields, and dropped only when
 * fully empty.
 */

import { describe, it, expect } from 'vitest';
import { validateJson, type ValidationResult } from '../../src/tui/components/ServiceJsonEditor.js';
import {
  formDataToService as unifiedFormDataToService,
  type FormData as UnifiedFormData,
} from '../../src/tui/components/ServiceFormUnified.js';
import {
  formDataToService as legacyFormDataToService,
  type FormData as LegacyFormData,
} from '../../src/tui/components/ServiceForm.js';

function expectValid(result: ValidationResult): NonNullable<ValidationResult['services']> {
  if (!result.valid || !result.services) {
    throw new Error(`expected valid result, got: ${JSON.stringify(result)}`);
  }
  return result.services;
}

const baseUnifiedForm: UnifiedFormData = {
  name: 'svc',
  transport: 'stdio',
  command: 'node',
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
};

const baseLegacyForm: LegacyFormData = {
  name: 'svc',
  transport: 'stdio',
  command: 'node',
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
};

describe('ServiceJsonEditor.validateJson — triggerHints passthrough', () => {
  it('preserves triggerHints in mcpServers map format', () => {
    const json = JSON.stringify({
      prompx: {
        transport: 'http',
        url: 'http://127.0.0.1:5203/mcp',
        triggerHints: {
          onSessionStart: 'recall role memory',
          onSessionEnd: 'persist new memory',
          phrases: ['我是X', 'switch role'],
        },
      },
    });

    const services = expectValid(validateJson(json));
    expect(services).toHaveLength(1);
    expect(services[0]?.triggerHints).toEqual({
      onSessionStart: 'recall role memory',
      onSessionEnd: 'persist new memory',
      phrases: ['我是X', 'switch role'],
    });
  });

  it('omits triggerHints when not present (no empty object injected)', () => {
    const json = JSON.stringify({
      plain: { transport: 'stdio', command: 'node' },
    });
    const services = expectValid(validateJson(json));
    expect(services[0]?.triggerHints).toBeUndefined();
  });

  it('rejects malformed triggerHints (array) by ignoring it, not crashing', () => {
    const json = JSON.stringify({
      bad: { transport: 'stdio', command: 'node', triggerHints: ['not', 'an', 'object'] },
    });
    const services = expectValid(validateJson(json));
    expect(services[0]?.triggerHints).toBeUndefined();
  });

  it('preserves triggerHints in single-service object format', () => {
    const json = JSON.stringify({
      name: 'prompx',
      transport: 'http',
      url: 'http://127.0.0.1:5203/mcp',
      enabled: true,
      tags: [],
      connectionPool: { maxConnections: 5, idleTimeout: 60000, connectionTimeout: 30000 },
      triggerHints: { onSessionStart: 'recall', phrases: ['我是X'] },
    });
    const services = expectValid(validateJson(json));
    expect(services[0]?.triggerHints).toEqual({
      onSessionStart: 'recall',
      phrases: ['我是X'],
    });
  });

  it('preserves triggerHints inside an array of services', () => {
    const json = JSON.stringify([
      {
        name: 'prompx',
        transport: 'http',
        url: 'http://127.0.0.1:5203/mcp',
        enabled: true,
        tags: [],
        connectionPool: { maxConnections: 5, idleTimeout: 60000, connectionTimeout: 30000 },
        triggerHints: { onSessionEnd: 'remember' },
      },
    ]);
    const services = expectValid(validateJson(json));
    expect(services[0]?.triggerHints).toEqual({ onSessionEnd: 'remember' });
  });
});

describe('ServiceFormUnified.formDataToService — triggerHints assembly', () => {
  it('assembles full triggerHints when all three fields are filled', () => {
    const svc = unifiedFormDataToService({
      ...baseUnifiedForm,
      triggerHintsStart: '  recall first  ',
      triggerHintsEnd: 'persist last',
      triggerHintsPhrases: '我是X, switch role , ,act as Y',
    });
    expect(svc.triggerHints).toEqual({
      onSessionStart: 'recall first',
      onSessionEnd: 'persist last',
      phrases: ['我是X', 'switch role', 'act as Y'],
    });
  });

  it('partial fields produce a partial object', () => {
    const svc = unifiedFormDataToService({
      ...baseUnifiedForm,
      triggerHintsStart: 'only start',
    });
    expect(svc.triggerHints).toEqual({ onSessionStart: 'only start' });
  });

  it('all-empty fields leave triggerHints undefined (no empty object)', () => {
    const svc = unifiedFormDataToService({ ...baseUnifiedForm });
    expect(svc.triggerHints).toBeUndefined();
  });

  it('whitespace-only fields are treated as empty', () => {
    const svc = unifiedFormDataToService({
      ...baseUnifiedForm,
      triggerHintsStart: '   ',
      triggerHintsEnd: '\t',
      triggerHintsPhrases: ' , , ',
    });
    expect(svc.triggerHints).toBeUndefined();
  });
});

describe('ServiceForm.formDataToService — triggerHints assembly', () => {
  it('assembles full triggerHints', () => {
    const svc = legacyFormDataToService({
      ...baseLegacyForm,
      triggerHintsStart: 'recall first',
      triggerHintsEnd: 'persist last',
      triggerHintsPhrases: 'a, b',
    });
    expect(svc.triggerHints).toEqual({
      onSessionStart: 'recall first',
      onSessionEnd: 'persist last',
      phrases: ['a', 'b'],
    });
  });

  it('all-empty fields leave triggerHints undefined', () => {
    const svc = legacyFormDataToService({ ...baseLegacyForm });
    expect(svc.triggerHints).toBeUndefined();
  });
});
