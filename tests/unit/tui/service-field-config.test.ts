import { describe, it, expect } from 'vitest';
import {
  fieldHelp,
  fieldPlaceholder,
  type HelpFieldKey,
} from '../../../src/tui/components/service-field-config.js';

describe('service-field-config', () => {
  it('provides non-empty help for every configured field', () => {
    for (const [field, help] of Object.entries(fieldHelp)) {
      expect(help, `help for ${field} should not be empty`).toBeTruthy();
    }
  });

  it('only provides placeholders for complex structured fields', () => {
    expect(Object.keys(fieldPlaceholder).sort()).toEqual(['args', 'env', 'headers']);
  });

  it('gives headers help with the Key: Value format and hyphen hint', () => {
    expect(fieldHelp.headers).toContain('Key: Value');
    expect(fieldHelp.headers).toContain('hyphens');
  });

  it('gives env help with the KEY=VALUE format', () => {
    expect(fieldHelp.env).toContain('KEY=VALUE');
  });

  it('does not provide placeholders for simple fields', () => {
    const simpleFields: HelpFieldKey[] = [
      'name',
      'command',
      'url',
      'tags',
      'enabled',
      'maxConnections',
      'idleTimeout',
      'connectionTimeout',
      'triggerHintsStart',
      'triggerHintsEnd',
      'triggerHintsPhrases',
      'confirm',
      'quickMode',
    ];
    for (const field of simpleFields) {
      expect(fieldPlaceholder[field], `no placeholder for ${field}`).toBeUndefined();
    }
  });
});
