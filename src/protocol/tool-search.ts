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
  description: `Search for available tools across all connected MCP services.

WHEN TO USE:
- Before any operation you haven't done before in this session
- When the exact tool name is unknown
- After getting a "tool not found" error

QUERY TIPS (what works best):
- Action + object: "read file", "create PR", "execute query", "list tables"
- Single specific verb: "delete", "upload", "search"
- Service + action: "github create", "filesystem write", "database list"
- Avoid vague terms like "do", "help", "use" — be specific about the operation

READING RESULTS:
- "namespacedName" is the exact string to use as the tool name when calling
- "inputSchema" shows required and optional parameters
- "description" explains what the tool does — verify it matches your intent
- Results are ranked by relevance; the top result is usually correct

ITERATING:
- If results look wrong, try rephrasing with different action words
- Narrow down with more specific terms (e.g., "read binary file" vs "read file")`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description:
          'Describe the operation you want to perform. Use action + object format for best results. Examples: "read file", "create pull request", "execute sql query", "list directory contents", "send http request"',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 10, max: 50)',
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
 * Tokenize a query string into lowercase tokens.
 * Splits on whitespace, hyphens, underscores, AND at CJK ↔ non-CJK boundaries
 * (e.g. "执行SQL" → ["执行", "sql"]).
 */
export function tokenizeQuery(query: string): string[] {
  // Insert a split point at CJK ↔ non-CJK transitions, then split on separators
  const marked = query
    .replace(/([^\u4e00-\u9fff\u3400-\u4dbf])(?=[\u4e00-\u9fff\u3400-\u4dbf])/g, '$1 ')
    .replace(/([\u4e00-\u9fff\u3400-\u4dbf])(?=[^\u4e00-\u9fff\u3400-\u4dbf])/g, '$1 ');
  return marked
    .toLowerCase()
    .split(/[\s\-_]+/)
    .filter((t) => t.length > 0);
}

// ---------------------------------------------------------------------------
// IDF helpers (separate for name-only and description-only corpora)
// ---------------------------------------------------------------------------

/**
 * Smoothed IDF: log((N+1)/(df+1)) + 1
 * Tokens rare in the corpus score higher.
 */
function idf(df: number, N: number): number {
  return Math.log((N + 1) / (df + 1)) + 1;
}

/** Precompute per-token IDF over tool *names* only. */
function buildNameIdfMap(tokens: string[], tools: Tool[]): Map<string, number> {
  const N = tools.length;
  const map = new Map<string, number>();
  for (const token of tokens) {
    let df = 0;
    for (const tool of tools) {
      if (tool.namespacedName.toLowerCase().includes(token)) df++;
    }
    map.set(token, idf(df, N));
  }
  return map;
}

/** Precompute per-token IDF over tool *descriptions* only. */
function buildDescIdfMap(tokens: string[], tools: Tool[]): Map<string, number> {
  const N = tools.length;
  const map = new Map<string, number>();
  for (const token of tokens) {
    let df = 0;
    for (const tool of tools) {
      if (tool.description.toLowerCase().includes(token)) df++;
    }
    map.set(token, idf(df, N));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Phase 1: Name-based scoring (high precision)
// ---------------------------------------------------------------------------

/**
 * Score a tool purely on name matching.
 *
 * Tier weights:
 *   Full query exact match in name : +100
 *   Token prefix match on name part : +60 × nameIdf × synonymWeight
 *   Token substring match in name   : +40 × nameIdf × synonymWeight
 *   All original tokens in name     : +50 coherence bonus
 *
 * Synonym-expanded tokens are weighted at 0.5× (semantic signal, less certain).
 */
function scoreByName(
  tool: Tool,
  originalTokens: string[],
  expandedTokens: string[],
  nameIdfMap: Map<string, number>
): number {
  const nameLower = tool.namespacedName.toLowerCase();
  const nameParts = nameLower.split('__');
  const originalSet = new Set(originalTokens);
  let score = 0;

  // Full query exact match
  const fullQuery = originalTokens.join(' ');
  if (nameLower.includes(fullQuery)) {
    score += 100;
  }

  for (const token of expandedTokens) {
    const w = originalSet.has(token) ? 1.0 : 0.5;
    const tokenIdf = nameIdfMap.get(token) ?? 1;

    let prefixHit = false;
    for (const part of nameParts) {
      if (part.startsWith(token)) {
        score += 60 * tokenIdf * w;
        prefixHit = true;
        break;
      }
    }
    if (!prefixHit && nameLower.includes(token)) {
      score += 40 * tokenIdf * w;
    }
  }

  // Coherence bonus: all original tokens found in name
  if (originalTokens.length > 1 && originalTokens.every((t) => nameLower.includes(t))) {
    score += 50;
  }

  return score;
}

// ---------------------------------------------------------------------------
// Phase 2: Description-based scoring (high recall fallback)
// ---------------------------------------------------------------------------

/**
 * Score a tool purely on description matching.
 * Only used when Phase 1 yields fewer results than the requested limit.
 *
 * Tier weights:
 *   Token in description             : +25 × descIdf
 *   All original tokens in desc      : +15 coherence bonus
 */
function scoreByDescription(
  tool: Tool,
  originalTokens: string[],
  descIdfMap: Map<string, number>
): number {
  const descLower = tool.description.toLowerCase();
  if (!descLower) return 0;

  let score = 0;
  for (const token of originalTokens) {
    if (descLower.includes(token)) {
      score += 25 * (descIdfMap.get(token) ?? 1);
    }
  }

  if (originalTokens.length > 1 && originalTokens.every((t) => descLower.includes(t))) {
    score += 15;
  }

  return score;
}

// ---------------------------------------------------------------------------
// Public search entry point
// ---------------------------------------------------------------------------

/**
 * Two-phase tool search:
 *
 * Phase 1 — Name matching (high precision):
 *   Score all tools by their namespaced name.
 *   Tools with a positive name score are "strong candidates".
 *   Results are ranked by name score descending.
 *
 * Phase 2 — Description matching (high recall, fallback only):
 *   Activated only when Phase 1 produces fewer results than `limit`.
 *   Fills remaining slots with tools whose *descriptions* match the query.
 *   These are appended after all Phase 1 results.
 *
 * This separation prevents description false-positives from displacing
 * genuine name matches at the top of the result list.
 */
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

  // Precompute name-corpus IDF (used in Phase 1)
  const nameIdfMap = buildNameIdfMap(expandedTokens, tools);

  // --- Phase 1: name matching ---
  const phase1 = tools
    .map((tool) => ({
      tool,
      score: scoreByName(tool, originalTokens, expandedTokens, nameIdfMap),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.tool);

  // --- Phase 2: description matching (only when needed) ---
  let phase2: Tool[] = [];
  if (searchDescription && phase1.length < limit) {
    const remaining = limit - phase1.length;
    const usedNames = new Set(phase1.map((t) => t.namespacedName));

    // Precompute description-corpus IDF (used only in Phase 2)
    const descIdfMap = buildDescIdfMap(originalTokens, tools);

    phase2 = tools
      .filter((t) => !usedNames.has(t.namespacedName))
      .map((tool) => ({
        tool,
        score: scoreByDescription(tool, originalTokens, descIdfMap),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, remaining)
      .map((r) => r.tool);
  }

  const matched = [...phase1, ...phase2];

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
