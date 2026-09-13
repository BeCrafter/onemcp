/**
 * Integration tests for triggerHints support across the TUI form input paths:
 *  - ServiceFormUnified (formDataToService)
 *  - ServiceForm (formDataToService)
 *
 * These tests pin the behaviour we just added: triggerHints fields must be
 * accepted from JSON, assembled from the form fields, and dropped only when
 * fully empty.
 */

import { describe, it, expect } from 'vitest';
import {
  formDataToService as unifiedFormDataToService,
  type FormData as UnifiedFormData,
} from '../../src/tui/components/ServiceFormUnified.js';
import {
  formDataToService as legacyFormDataToService,
  type FormData as LegacyFormData,
} from '../../src/tui/components/ServiceForm.js';

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
