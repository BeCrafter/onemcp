import type { Tool } from '../types/tool.js';

export interface SearchParams {
  query: string;
  limit?: number;
  searchDescription?: boolean;
  /** Custom synonyms to merge with built-in table */
  synonyms?: Record<string, string[]>;
}

export interface SearchResult {
  tools: Array<{
    namespacedName: string;
    name: string;
    serviceName: string;
    description: string;
    inputSchema: unknown;
  }>;
}

export const SEARCH_TOOL_DEFINITION = {
  name: 'onemcp__search',
  description: `Search for available tools in this MCP server. Use this tool FIRST when you need to perform any operation - it helps you discover the exact tool name and parameters to use.

When to use:
- User asks to read, write, or manipulate files → search first
- User asks to run a command or API request → search first
- Any time you're unsure which tool to use → search first

How to use the results:
1. This search returns a list of matching tools with their full names (e.g., "filesystem__read_file")
2. Use the "namespacedName" from results as the tool name to call
3. Use "inputSchema" to understand what parameters the tool accepts
4. Each result includes the tool's description to verify it's what you need`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: `What you want to do. Be descriptive!
Examples: "read file", "write data", "delete folder", "list directory", "http request", "database query"
Supports partial matches and multiple keywords.`,
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 10)',
        default: 10,
      },
    },
    required: ['query'],
  },
};

/**
 * Built-in synonym table.
 * Keys are lowercase query terms; values are arrays of equivalent terms to also match.
 * Covers common CRUD operations, file/network actions, and Chinese→English mappings.
 */
export const BUILTIN_SYNONYMS: Record<string, string[]> = {
  // CRUD verbs
  create: ['new', 'add', 'make', 'write', 'insert', 'post', 'build', 'generate'],
  new: ['create', 'add', 'make'],
  add: ['create', 'new', 'insert', 'append', 'push'],
  read: ['get', 'fetch', 'load', 'retrieve', 'show', 'view', 'open', 'cat'],
  get: ['read', 'fetch', 'load', 'retrieve', 'show'],
  fetch: ['get', 'read', 'load', 'retrieve'],
  list: ['ls', 'dir', 'show', 'enumerate', 'find', 'all'],
  update: ['edit', 'modify', 'change', 'patch', 'set', 'put', 'replace'],
  edit: ['update', 'modify', 'change', 'patch'],
  delete: ['remove', 'drop', 'destroy', 'erase', 'rm', 'unlink', 'clear'],
  remove: ['delete', 'drop', 'destroy', 'rm'],
  search: ['find', 'query', 'lookup', 'seek', 'filter', 'grep'],
  find: ['search', 'query', 'lookup', 'locate'],
  run: ['execute', 'exec', 'invoke', 'call', 'start', 'launch'],
  execute: ['run', 'exec', 'invoke', 'call'],
  send: ['post', 'emit', 'publish', 'push', 'write'],
  // File / storage
  file: ['document', 'doc', 'path', 'blob'],
  folder: ['directory', 'dir', 'path'],
  directory: ['folder', 'dir', 'path'],
  move: ['rename', 'mv'],
  rename: ['move', 'mv'],
  copy: ['cp', 'duplicate', 'clone'],
  // Network / API
  request: ['http', 'api', 'call', 'fetch'],
  http: ['request', 'api', 'rest', 'curl'],
  download: ['fetch', 'pull', 'get'],
  upload: ['push', 'send', 'post'],
  // Database
  query: ['sql', 'select', 'search', 'find'],
  sql: ['query', 'database', 'db'],
  // Git / code
  commit: ['save', 'push'],
  push: ['upload', 'send', 'publish'],
  pull: ['fetch', 'download', 'sync'],
  branch: ['checkout', 'switch'],
  // Chinese → English mappings
  新建: ['create', 'new', 'add'],
  创建: ['create', 'new', 'add'],
  读取: ['read', 'get', 'fetch'],
  获取: ['get', 'fetch', 'read'],
  查询: ['query', 'search', 'find', 'list', 'select'],
  搜索: ['search', 'find', 'query'],
  删除: ['delete', 'remove', 'drop'],
  修改: ['update', 'edit', 'modify'],
  更新: ['update', 'modify', 'patch'],
  列出: ['list', 'ls', 'dir'],
  执行: ['execute', 'run', 'exec'],
  发送: ['send', 'post', 'push'],
  下载: ['download', 'fetch', 'get'],
  上传: ['upload', 'push', 'send'],
  文件: ['file', 'document'],
  文件夹: ['folder', 'directory'],
  目录: ['directory', 'folder'],
  移动: ['move', 'rename', 'mv'],
  复制: ['copy', 'cp', 'duplicate'],
  请求: ['request', 'http', 'api'],
  数据库: ['database', 'db', 'sql'],
  提交: ['commit', 'push'],
  分支: ['branch'],
};

/**
 * Build the effective synonym map by merging built-in and custom entries.
 * Custom entries override built-in ones for the same key.
 */
export function buildSynonymMap(custom?: Record<string, string[]>): Record<string, string[]> {
  if (!custom || Object.keys(custom).length === 0) {
    return BUILTIN_SYNONYMS;
  }
  return { ...BUILTIN_SYNONYMS, ...custom };
}

/**
 * Expand a set of query tokens using the synonym map.
 * Returns a deduplicated array of original tokens + their synonyms.
 */
export function expandTokens(tokens: string[], synonymMap: Record<string, string[]>): string[] {
  const expanded = new Set<string>(tokens);
  for (const token of tokens) {
    const synonyms = synonymMap[token];
    if (synonyms) {
      for (const s of synonyms) {
        expanded.add(s);
      }
    }
  }
  return Array.from(expanded);
}

/**
 * Compute IDF weight for a token across all tool documents.
 * Tokens that appear in many tools get lower weight (they're less discriminative).
 * Uses a smoothed IDF: log((N + 1) / (df + 1)) + 1
 */
function computeIdf(token: string, tools: Tool[], searchDescription: boolean): number {
  const N = tools.length;
  if (N === 0) return 1;
  let df = 0;
  for (const tool of tools) {
    const text = searchDescription
      ? `${tool.namespacedName} ${tool.description}`.toLowerCase()
      : tool.namespacedName.toLowerCase();
    if (text.includes(token)) {
      df++;
    }
  }
  return Math.log((N + 1) / (df + 1)) + 1;
}

/**
 * Score a tool against the query using BM25-inspired term weighting.
 *
 * Scoring breakdown:
 * - Name exact match (full query in namespaced name): highest priority
 * - Name prefix match (token matches start of name part): high priority
 * - Name token match (IDF-weighted): medium-high priority
 * - Description match (IDF-weighted): lower weight, configurable
 * - Synonym-expanded token hits: same tiers but half-weight (indicate semantic match)
 */
function scoreToolBm25(
  tool: Tool,
  originalTokens: string[],
  expandedTokens: string[],
  idfMap: Map<string, number>,
  searchDescription: boolean
): number {
  const nameLower = tool.namespacedName.toLowerCase();
  const nameParts = nameLower.split('__');
  const descLower = searchDescription ? tool.description.toLowerCase() : '';
  let score = 0;

  const fullQuery = originalTokens.join(' ');
  const originalSet = new Set(originalTokens);

  // --- Exact match on full query in name: strong signal ---
  if (nameLower.includes(fullQuery)) {
    score += 100;
  }

  // --- Per-token scoring ---
  for (const token of expandedTokens) {
    const idf = idfMap.get(token) ?? 1;
    const isOriginal = originalSet.has(token);
    // Synonym hits count as half-weight (semantic signal, less certain)
    const weight = isOriginal ? 1.0 : 0.5;

    // Prefix match in any name part (e.g. token "read" matches "read_file")
    let prefixHit = false;
    for (const part of nameParts) {
      if (part.startsWith(token)) {
        score += 60 * idf * weight;
        prefixHit = true;
        break;
      }
    }

    // Substring match in name (fallback if no prefix)
    if (!prefixHit && nameLower.includes(token)) {
      score += 40 * idf * weight;
    }

    // Description match (optional)
    if (searchDescription && descLower.includes(token)) {
      score += 15 * idf * weight;
    }
  }

  // --- Bonus: all original tokens present in name (multi-keyword coherence) ---
  if (originalTokens.length > 1) {
    const allInName = originalTokens.every((t) => nameLower.includes(t));
    if (allInName) {
      score += 50;
    }
  }

  return score;
}

/**
 * Tokenize a query string into lowercase tokens.
 * Splits on whitespace, hyphens, underscores, AND at CJK ↔ non-CJK boundaries
 * (e.g. "执行SQL" → ["执行", "sql"]).
 */
export function tokenizeQuery(query: string): string[] {
  // Insert a split point at CJK ↔ non-CJK transitions, then split on separators
  const marked = query.replace(/([^\u4e00-\u9fff\u3400-\u4dbf])(?=[\u4e00-\u9fff\u3400-\u4dbf])/g, '$1 ')
                      .replace(/([\u4e00-\u9fff\u3400-\u4dbf])(?=[^\u4e00-\u9fff\u3400-\u4dbf])/g, '$1 ');
  return marked.toLowerCase().split(/[\s\-_]+/).filter((t) => t.length > 0);
}

export function searchTools(tools: Tool[], params: SearchParams): SearchResult {
  const query = params.query.trim();
  const limit = params.limit ?? 10;
  const searchDescription = params.searchDescription ?? true;

  if (!query) {
    return { tools: [] };
  }

  const originalTokens = tokenizeQuery(query);
  const synonymMap = buildSynonymMap(params.synonyms);
  const expandedTokens = expandTokens(originalTokens, synonymMap);

  // Pre-compute IDF for all expanded tokens (amortised across all tool scorings)
  const idfMap = new Map<string, number>();
  for (const token of expandedTokens) {
    idfMap.set(token, computeIdf(token, tools, searchDescription));
  }

  const scoredResults = tools.map((tool) => ({
    tool,
    score: scoreToolBm25(tool, originalTokens, expandedTokens, idfMap, searchDescription),
  }));

  const matched = scoredResults
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.tool);

  return {
    tools: matched.map((tool) => ({
      namespacedName: tool.namespacedName,
      name: tool.name,
      serviceName: tool.serviceName,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  };
}
