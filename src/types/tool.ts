/**
 * Tool-related type definitions for the MCP Router System
 */

/**
 * Tool definition from an MCP server
 */
export interface Tool {
  /** Original tool name */
  name: string;
  /** Namespaced tool name (serviceName__toolName) */
  namespacedName: string;
  /** Service that provides this tool */
  serviceName: string;
  /** Tool description */
  description: string;
  /** JSON Schema for input validation */
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** Whether the tool is enabled */
  enabled: boolean;
}

/**
 * Tag filter logic
 */
export type TagFilterLogic = 'AND' | 'OR';

/**
 * Tag filter for querying services/tools
 */
export interface TagFilter {
  /** Tags to filter by */
  tags: string[];
  /** Filter logic (AND or OR) */
  logic: TagFilterLogic;
}
