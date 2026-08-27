/**
 * Shared per-field help text and placeholders for the TUI service forms.
 *
 * Only structurally complex fields (args, env, headers) carry a format example
 * and a placeholder; simple fields (name, tags, command, url, ...) get a one-line
 * description only, keeping the forms quiet where the expected format is obvious.
 */

import { DEFAULT_CONNECTION_POOL } from '../../types/service.js';

export type HelpFieldKey =
  | 'name'
  | 'transport'
  | 'command'
  | 'url'
  | 'args'
  | 'env'
  | 'headers'
  | 'tags'
  | 'enabled'
  | 'maxConnections'
  | 'idleTimeout'
  | 'connectionTimeout'
  | 'triggerHintsStart'
  | 'triggerHintsEnd'
  | 'triggerHintsPhrases'
  | 'confirm'
  | 'quickMode';

const ARGS_EXAMPLE = '-y, @modelcontextprotocol/server-filesystem, /tmp';
const ENV_EXAMPLE = 'NODE_ENV=production, DEBUG=true';
const HEADERS_EXAMPLE = 'Authorization: Bearer token, Content-Type: application/json';

export const fieldHelp: Record<HelpFieldKey, string> = {
  name: 'Unique service identifier.',
  transport: 'stdio = local subprocess; sse = Server-Sent Events; http = Streamable HTTP.',
  command: 'Executable to launch the MCP server (stdio only).',
  url: 'HTTP(S) URL of the MCP server (sse/http).',
  args: `Command arguments, comma-separated. e.g. ${ARGS_EXAMPLE}`,
  env: `Environment variables as KEY=VALUE, comma-separated. e.g. ${ENV_EXAMPLE}`,
  headers: `HTTP headers as Key: Value, comma-separated. Names use hyphens. e.g. ${HEADERS_EXAMPLE}`,
  tags: 'Labels for filtering, comma-separated.',
  enabled: 'Whether this service should be active.',
  maxConnections: `Maximum number of concurrent connections (default: ${DEFAULT_CONNECTION_POOL.maxConnections}).`,
  idleTimeout: `Time before idle connections are closed, in ms (default: ${DEFAULT_CONNECTION_POOL.idleTimeout}).`,
  connectionTimeout: `Maximum time to wait for a connection, in ms (default: ${DEFAULT_CONNECTION_POOL.connectionTimeout}).`,
  triggerHintsStart: 'Reason the LLM should call this service at conversation start.',
  triggerHintsEnd: 'Reason the LLM should call this service before conversation ends.',
  triggerHintsPhrases: 'Extra trigger phrases the LLM should treat as a search signal.',
  confirm: 'Review and save the configuration.',
  quickMode: 'Use quick mode with defaults for advanced options.',
};

export const fieldPlaceholder: Partial<Record<HelpFieldKey, string>> = {
  args: ARGS_EXAMPLE,
  env: ENV_EXAMPLE,
  headers: HEADERS_EXAMPLE,
};
