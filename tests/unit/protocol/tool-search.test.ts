/**
 * Unit tests for tool-search: synonym expansion, BM25-style scoring, and edge cases.
 */

import { describe, it, expect } from 'vitest';
import {
  searchTools,
  buildSynonymMap,
  expandTokens,
  BUILTIN_SYNONYMS,
} from '../../../src/protocol/tool-search';
import type { Tool } from '../../../src/types/tool';

function makeTool(namespacedName: string, description = ''): Tool {
  const [serviceName, name] = namespacedName.split('___');
  return {
    name: name ?? namespacedName,
    namespacedName,
    serviceName: serviceName ?? 'svc',
    description,
    inputSchema: { type: 'object', properties: {}, required: [] },
    enabled: true,
  };
}

const SAMPLE_TOOLS: Tool[] = [
  makeTool('filesystem___read_file', 'Read the contents of a file from disk'),
  makeTool('filesystem___write_file', 'Write content to a file on disk'),
  makeTool('filesystem___list_directory', 'List files in a directory'),
  makeTool('filesystem___delete_file', 'Delete a file from disk'),
  makeTool('filesystem___create_directory', 'Create a new directory'),
  makeTool('github___create_pull_request', 'Create a GitHub pull request'),
  makeTool('github___list_commits', 'List commits in a repository'),
  makeTool('github___search_code', 'Search code in a repository'),
  makeTool('database___execute_query', 'Execute a SQL query against the database'),
  makeTool('database___list_tables', 'List all tables in the database'),
  makeTool('http___send_request', 'Send an HTTP request'),
];

// ---------------------------------------------------------------------------
// buildSynonymMap
// ---------------------------------------------------------------------------
describe('buildSynonymMap', () => {
  it('returns BUILTIN_SYNONYMS when no custom map provided', () => {
    expect(buildSynonymMap()).toBe(BUILTIN_SYNONYMS);
    expect(buildSynonymMap({})).toBe(BUILTIN_SYNONYMS);
  });

  it('merges custom synonyms over built-in', () => {
    const map = buildSynonymMap({ deploy: ['publish', 'release'] });
    expect(map['deploy']).toEqual(['publish', 'release']);
    // built-in entries still present
    expect(map['create']).toBeDefined();
  });

  it('custom entry overrides built-in for same key', () => {
    const map = buildSynonymMap({ create: ['spawn'] });
    expect(map['create']).toEqual(['spawn']);
  });
});

// ---------------------------------------------------------------------------
// expandTokens
// ---------------------------------------------------------------------------
describe('expandTokens', () => {
  it('returns original tokens when no synonyms match', () => {
    const result = expandTokens(['xyzzy'], BUILTIN_SYNONYMS);
    expect(result).toEqual(['xyzzy']);
  });

  it('expands "delete" to include synonyms like "remove"', () => {
    const result = expandTokens(['delete'], BUILTIN_SYNONYMS);
    expect(result).toContain('delete');
    expect(result).toContain('remove');
    expect(result).toContain('drop');
  });

  it('expands Chinese term "删除" to English equivalents', () => {
    const result = expandTokens(['删除'], BUILTIN_SYNONYMS);
    expect(result).toContain('delete');
    expect(result).toContain('remove');
  });

  it('expands Chinese term "创建" correctly', () => {
    const result = expandTokens(['创建'], BUILTIN_SYNONYMS);
    expect(result).toContain('create');
    expect(result).toContain('new');
    expect(result).toContain('add');
  });

  it('deduplicates tokens', () => {
    const result = expandTokens(['create', 'new'], BUILTIN_SYNONYMS);
    // "create" expands to include "new"; "new" is also original — should not duplicate
    const set = new Set(result);
    expect(set.size).toBe(result.length);
  });
});

// ---------------------------------------------------------------------------
// searchTools — basic behaviour (backward-compatible)
// ---------------------------------------------------------------------------
describe('searchTools - basic', () => {
  it('returns empty result for empty query', () => {
    const result = searchTools(SAMPLE_TOOLS, { query: '' });
    expect(result.tools).toHaveLength(0);
  });

  it('returns empty result for empty tools list', () => {
    const result = searchTools([], { query: 'read' });
    expect(result.tools).toHaveLength(0);
  });

  it('finds exact tool by keyword in name', () => {
    const result = searchTools(SAMPLE_TOOLS, { query: 'read_file' });
    expect(result.tools[0]?.namespacedName).toBe('filesystem___read_file');
  });

  it('respects limit', () => {
    const result = searchTools(SAMPLE_TOOLS, { query: 'file', limit: 2 });
    expect(result.tools.length).toBeLessThanOrEqual(2);
  });

  it('returns result shape with all required fields', () => {
    const result = searchTools(SAMPLE_TOOLS, { query: 'read' });
    expect(result.tools.length).toBeGreaterThan(0);
    const first = result.tools[0]!;
    expect(first).toHaveProperty('namespacedName');
    expect(first).toHaveProperty('name');
    expect(first).toHaveProperty('serviceName');
    expect(first).toHaveProperty('description');
    expect(first).toHaveProperty('inputSchema');
  });

  it('ranks exact namespaced name match first', () => {
    const result = searchTools(SAMPLE_TOOLS, { query: 'filesystem___write_file' });
    expect(result.tools[0]?.namespacedName).toBe('filesystem___write_file');
  });

  it('multi-token query ranks coherent matches higher', () => {
    const result = searchTools(SAMPLE_TOOLS, { query: 'list directory' });
    // filesystem___list_directory contains both tokens
    const names = result.tools.map((t) => t.namespacedName);
    expect(names[0]).toBe('filesystem___list_directory');
  });

  it('description search enabled by default finds tools via description text', () => {
    // "disk" appears in filesystem tool descriptions but not in names
    const result = searchTools(SAMPLE_TOOLS, { query: 'disk', searchDescription: true });
    const names = result.tools.map((t) => t.namespacedName);
    expect(names.some((n) => n.startsWith('filesystem'))).toBe(true);
  });

  it('disabling description search excludes description-only matches', () => {
    // "disk" only in descriptions, not in names
    const result = searchTools(SAMPLE_TOOLS, { query: 'disk', searchDescription: false });
    expect(result.tools).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// searchTools — synonym expansion
// ---------------------------------------------------------------------------
describe('searchTools - synonym expansion', () => {
  it('query "remove" finds tools with "delete" in name via synonyms', () => {
    const result = searchTools(SAMPLE_TOOLS, { query: 'remove' });
    const names = result.tools.map((t) => t.namespacedName);
    expect(names).toContain('filesystem___delete_file');
  });

  it('query "新建" (Chinese: create) finds create_directory and create_pull_request', () => {
    const result = searchTools(SAMPLE_TOOLS, { query: '新建' });
    const names = result.tools.map((t) => t.namespacedName);
    expect(names.some((n) => n.includes('create'))).toBe(true);
  });

  it('query "删除" (Chinese: delete) finds delete_file', () => {
    const result = searchTools(SAMPLE_TOOLS, { query: '删除' });
    const names = result.tools.map((t) => t.namespacedName);
    expect(names).toContain('filesystem___delete_file');
  });

  it('query "查询" (Chinese: query) finds execute_query via synonyms', () => {
    const result = searchTools(SAMPLE_TOOLS, { query: '查询' });
    const names = result.tools.map((t) => t.namespacedName);
    expect(names).toContain('database___execute_query');
  });

  it('query "执行SQL" expands to find execute_query', () => {
    const result = searchTools(SAMPLE_TOOLS, { query: '执行SQL' });
    const names = result.tools.map((t) => t.namespacedName);
    expect(names).toContain('database___execute_query');
  });

  it('query "http request" finds send_request', () => {
    const result = searchTools(SAMPLE_TOOLS, { query: 'http request' });
    const names = result.tools.map((t) => t.namespacedName);
    expect(names).toContain('http___send_request');
  });

  it('custom synonyms override built-in and expand correctly', () => {
    const tools = [
      makeTool('deploy___publish_release', 'Publish a release'),
      makeTool('deploy___rollback', 'Rollback a deployment'),
    ];
    const result = searchTools(tools, {
      query: 'deploy',
      synonyms: { deploy: ['publish', 'release'] },
    });
    const names = result.tools.map((t) => t.namespacedName);
    expect(names).toContain('deploy___publish_release');
  });

  it('synonym expansion does not lower original direct matches', () => {
    // "delete" should still directly match delete_file highly
    const result = searchTools(SAMPLE_TOOLS, { query: 'delete' });
    expect(result.tools[0]?.namespacedName).toBe('filesystem___delete_file');
  });
});

// ---------------------------------------------------------------------------
// searchTools — IDF weighting
// ---------------------------------------------------------------------------
describe('searchTools - IDF weighting', () => {
  it('rare token scores higher than common token across tools', () => {
    // "pull_request" is unique; "file" appears in many tools
    const uniqueResult = searchTools(SAMPLE_TOOLS, { query: 'pull request' });
    const commonResult = searchTools(SAMPLE_TOOLS, { query: 'file' });

    // pull_request match should be at position 0 since it's unique
    expect(uniqueResult.tools[0]?.namespacedName).toBe('github___create_pull_request');

    // file matches multiple tools — should still return results
    expect(commonResult.tools.length).toBeGreaterThan(1);
  });

  it('discriminative token raises the right tool to top', () => {
    // "execute" appears only in execute_query
    const result = searchTools(SAMPLE_TOOLS, { query: 'execute' });
    expect(result.tools[0]?.namespacedName).toBe('database___execute_query');
  });
});

// ---------------------------------------------------------------------------
// searchTools — edge cases
// ---------------------------------------------------------------------------
describe('searchTools - edge cases', () => {
  it('handles whitespace-only query', () => {
    const result = searchTools(SAMPLE_TOOLS, { query: '   ' });
    expect(result.tools).toHaveLength(0);
  });

  it('handles query with mixed separators (dash, underscore, space)', () => {
    const result = searchTools(SAMPLE_TOOLS, { query: 'read-file_content' });
    // "read" and "file" tokens should still match filesystem___read_file
    const names = result.tools.map((t) => t.namespacedName);
    expect(names).toContain('filesystem___read_file');
  });

  it('is case-insensitive', () => {
    const result = searchTools(SAMPLE_TOOLS, { query: 'READ FILE' });
    const names = result.tools.map((t) => t.namespacedName);
    expect(names).toContain('filesystem___read_file');
  });

  it('default limit is 10', () => {
    // Create 15 tools all matching "test"
    const manyTools = Array.from({ length: 15 }, (_, i) =>
      makeTool(`svc___test_tool_${i}`, 'test description')
    );
    const result = searchTools(manyTools, { query: 'test' });
    expect(result.tools.length).toBeLessThanOrEqual(10);
  });
});
