/**
 * Unit tests for description-enhancer: nameToPhrase and enhanceDescription.
 */

import { describe, it, expect } from 'vitest';
import {
  nameToPhrase,
  enhanceDescription,
  MIN_USEFUL_DESCRIPTION_LENGTH,
} from '../../../src/protocol/description-enhancer';

// ---------------------------------------------------------------------------
// nameToPhrase
// ---------------------------------------------------------------------------
describe('nameToPhrase', () => {
  it('converts snake_case to Title Case', () => {
    expect(nameToPhrase('read_file')).toBe('Read File');
  });

  it('converts multi-word snake_case', () => {
    expect(nameToPhrase('create_pull_request')).toBe('Create Pull Request');
  });

  it('converts camelCase to Title Case', () => {
    expect(nameToPhrase('readFileContent')).toBe('Read File Content');
  });

  it('handles single word', () => {
    expect(nameToPhrase('filesystem')).toBe('Filesystem');
  });

  it('converts kebab-case to Title Case', () => {
    expect(nameToPhrase('send-http-request')).toBe('Send Http Request');
  });

  it('handles mixed separators', () => {
    expect(nameToPhrase('list_directory-items')).toBe('List Directory Items');
  });

  it('handles empty string', () => {
    expect(nameToPhrase('')).toBe('');
  });

  it('handles uppercase input', () => {
    expect(nameToPhrase('READ_FILE')).toBe('Read File');
  });
});

// ---------------------------------------------------------------------------
// enhanceDescription
// ---------------------------------------------------------------------------
describe('enhanceDescription', () => {
  it('returns original description when it is long enough', () => {
    const longDesc = 'Read the contents of a file from disk';
    expect(enhanceDescription('read_file', 'filesystem', longDesc)).toBe(longDesc);
  });

  it('MIN_USEFUL_DESCRIPTION_LENGTH is 20', () => {
    expect(MIN_USEFUL_DESCRIPTION_LENGTH).toBe(20);
  });

  it('generates phrase from tool name and service when description is empty', () => {
    const result = enhanceDescription('read_file', 'filesystem', '');
    expect(result).toBe('Read File (Filesystem)');
  });

  it('prepends phrase when description is short', () => {
    const result = enhanceDescription('delete_file', 'filesystem', 'Delete it');
    expect(result).toBe('Delete File: Delete it');
  });

  it('does not modify description exactly at the threshold', () => {
    // A description with exactly MIN_USEFUL_DESCRIPTION_LENGTH chars should be returned as-is
    const exactly20 = 'A'.repeat(MIN_USEFUL_DESCRIPTION_LENGTH);
    expect(enhanceDescription('tool', 'svc', exactly20)).toBe(exactly20);
  });

  it('enhances description one char below threshold', () => {
    const short = 'A'.repeat(MIN_USEFUL_DESCRIPTION_LENGTH - 1);
    const result = enhanceDescription('tool_name', 'my_service', short);
    // Should prepend derived phrase
    expect(result).toContain('Tool Name:');
    expect(result).toContain(short);
  });

  it('camelCase tool name is converted in generated phrase', () => {
    const result = enhanceDescription('executeQuery', 'database', '');
    expect(result).toBe('Execute Query (Database)');
  });

  it('service name is included in empty-description enhancement', () => {
    const result = enhanceDescription('list_tables', 'my_db', '');
    expect(result).toContain('My Db');
  });
});
