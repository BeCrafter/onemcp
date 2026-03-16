import type { Tool } from '../types/tool.js';

export interface SearchParams {
  query: string;
  limit?: number;
  searchDescription?: boolean;
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
 * Layered scoring algorithm for tool search
 * Score levels: exact(100) > prefix(80) > token(70) > partial(50) > description(30)
 */
function scoreTool(tool: Tool, queryTokens: string[], searchDescription: boolean): number {
  const nameLower = tool.namespacedName.toLowerCase();
  let score = 0;

  // exact match
  const fullQuery = queryTokens.join(' ');
  if (nameLower.includes(fullQuery)) {
    score += 100;
  }

  // prefix match
  const nameParts = nameLower.split('__');
  for (const part of nameParts) {
    for (const token of queryTokens) {
      if (part.startsWith(token)) {
        score += 80;
      }
    }
  }

  // token full match
  const allTokensMatch = queryTokens.every((token) => nameLower.includes(token));
  if (allTokensMatch && queryTokens.length > 1) {
    score += 70;
  }

  // partial token match
  const anyTokenMatch = queryTokens.some((token) => nameLower.includes(token));
  if (anyTokenMatch) {
    score += 50;
  }

  // description match
  if (searchDescription) {
    const descLower = tool.description.toLowerCase();
    if (descLower.includes(fullQuery)) {
      score += 30;
    }
    const descTokenMatch = queryTokens.some((token) => descLower.includes(token));
    if (descTokenMatch) {
      score += 20;
    }
  }

  return score;
}

export function searchTools(tools: Tool[], params: SearchParams): SearchResult {
  const query = params.query.toLowerCase().trim();
  const limit = params.limit ?? 10;
  const searchDescription = params.searchDescription ?? true;

  if (!query) {
    return { tools: [] };
  }

  const queryTokens = query.split(/[\s\-_]+/).filter((t) => t.length > 0);

  const scoredResults = tools.map((tool) => ({
    tool,
    score: scoreTool(tool, queryTokens, searchDescription),
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
