/**
 * Discovery Worker
 * Handles tool discovery for individual services
 */

import EventSource from 'eventsource';
import { StdioTransport } from '../transport/stdio.js';
import { isRecoverableConnectionError, isSessionExpiryError } from '../routing/session-error.js';
import { safeStringify } from '../utils/safe-json.js';
import { getPackageVersion } from '../utils/package-version.js';
import { isRecord } from './tool-param-schema.js';
import type { JsonRpcMessage } from '../types/jsonrpc.js';
import type { ServiceDefinition } from '../types/service.js';
import type { Tool } from '../types/tool.js';

/**
 * Discovery error types
 */
export enum DiscoveryErrorType {
  TIMEOUT = 'timeout',
  CONNECTION_FAILED = 'connection_failed',
  PROTOCOL_ERROR = 'protocol_error',
  INVALID_RESPONSE = 'invalid_response',
  SERVICE_UNAVAILABLE = 'service_unavailable',
}

/**
 * Discovery error class
 */
export class DiscoveryError extends Error {
  public readonly type: DiscoveryErrorType;
  public readonly serviceName: string;
  public readonly errorCause?: Error;

  constructor(type: DiscoveryErrorType, serviceName: string, message: string, errorCause?: Error) {
    super(message);
    this.name = 'DiscoveryError';
    this.type = type;
    this.serviceName = serviceName;
    if (errorCause !== undefined) {
      this.errorCause = errorCause;
    }
  }
}

/**
 * Raised when a one-shot session ended before answering a request.
 *
 * That is the worker-level shape of "the connection died while we were using
 * it" (stdio child exit, SSE drop) — the transport's own error never reaches the
 * caller because the receive stream simply ends. Typed rather than inferred from
 * the message so the retry predicate can classify it reliably.
 */
export class SessionClosedError extends Error {
  constructor(method: string) {
    super(`No response for ${method} request`);
    this.name = 'SessionClosedError';
  }
}

/**
 * Parse command string into command and args
 */
function parseCommandString(command: string): { command: string; args: string[] } {
  const tokens: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (inSingleQuote) {
      if (char === "'") {
        inSingleQuote = false;
      } else {
        current += char;
      }
    } else if (inDoubleQuote) {
      if (char === '"') {
        inDoubleQuote = false;
      } else {
        current += char;
      }
    } else {
      if (char === "'") {
        inSingleQuote = true;
      } else if (char === '"') {
        inDoubleQuote = true;
      } else if (char === ' ') {
        if (current.length > 0) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  if (tokens.length === 0) {
    return { command: '', args: [] };
  }

  return {
    command: tokens[0] || '',
    args: tokens.slice(1),
  };
}

/**
 * A request sender bound to an established MCP session (stdio process,
 * Streamable HTTP session id, or SSE endpoint). Each call sends one JSON-RPC
 * request and resolves with the raw response message (which may carry an
 * `error` field — classification is the caller's job).
 */
type SessionRequest = (msg: Record<string, unknown>) => Promise<Record<string, unknown>>;

const MCP_PROTOCOL_VERSION = '2024-11-05';

function initializeParams(): Record<string, unknown> {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: {
      name: 'onemcp-tui',
      version: getPackageVersion(),
    },
  };
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.message.toLowerCase().includes('timeout');
}

/**
 * Parse an HTTP response body that is either a bare JSON-RPC message or an
 * SSE-framed stream (`event:` / `data:` lines) containing one.
 */
function parseJsonRpcBody(text: string): Record<string, unknown> {
  if (text.startsWith('event:') || text.includes('\ndata: ')) {
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        return JSON.parse(line.slice(6)) as Record<string, unknown>;
      }
    }
    return {};
  }
  return JSON.parse(text) as Record<string, unknown>;
}

/**
 * Map a tools/list result payload to Tool records (empty when absent).
 */
function mapRawTools(result: unknown, service: ServiceDefinition): Tool[] {
  if (typeof result !== 'object' || result === null) {
    return [];
  }
  const tools = (result as Record<string, unknown>)['tools'];
  if (!Array.isArray(tools)) {
    return [];
  }
  return tools.map((t) => {
    const raw = t as { name: string; description?: string; inputSchema?: unknown };
    return {
      name: raw.name,
      namespacedName: `${service.name}__${raw.name}`,
      serviceName: service.name,
      description: raw.description || '',
      inputSchema: (raw.inputSchema as Tool['inputSchema']) || {
        type: 'object',
        properties: {},
      },
      enabled: true,
    };
  });
}

/**
 * Send tools/list over an established session and map the response.
 */
async function discoverToolsList(
  send: SessionRequest,
  service: ServiceDefinition
): Promise<Tool[]> {
  const resp = await send({
    jsonrpc: '2.0',
    id: `tools-${Date.now()}`,
    method: 'tools/list',
    params: {},
  });
  if (resp['error'] !== undefined) {
    throw new Error(
      `tools/list failed: ${String((resp['error'] as Record<string, unknown>)['message'] ?? 'unknown error')}`
    );
  }
  return mapRawTools(resp['result'], service);
}

/**
 * Shared stdio session: spawn process → initialize → notifications/initialized,
 * then hand a request sender to `fn` and close the process afterwards.
 * Errors propagate raw — callers decide the classification.
 */
async function stdioSession<T>(
  service: ServiceDefinition,
  timeout: number,
  fn: (sendRequest: SessionRequest) => Promise<T>
): Promise<T> {
  if (service.command === undefined || service.command === null) {
    throw new Error('Service has no command configured');
  }

  // Parse command string if args not provided or command contains spaces
  let command: string;
  let args: string[] | undefined;
  if (service.args !== undefined && service.args.length > 0) {
    command = service.command;
    args = service.args;
  } else if (service.command.includes(' ')) {
    const parsed = parseCommandString(service.command);
    command = parsed.command;
    args = parsed.args.length > 0 ? parsed.args : undefined;
  } else {
    command = service.command;
    args = undefined;
  }

  let transport: StdioTransport | null = null;

  try {
    transport = new StdioTransport({
      command,
      args: args || [],
      env: service.env || {},
    });

    // Wait for connection with timeout
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        const onConnected = () => {
          transport?.removeListener('error', onError);
          resolve();
        };

        const onError = (err: Error) => {
          transport?.removeListener('connected', onConnected);
          reject(err);
        };

        transport?.once('connected', onConnected);
        transport?.once('error', onError);

        if (transport?.isConnected()) {
          resolve();
        }
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), timeout)
      ),
    ]);

    // Send initialize request
    await transport.send({
      jsonrpc: '2.0' as const,
      id: `init-${Date.now()}`,
      method: 'initialize',
      params: initializeParams(),
    });

    // Wait for initialize response
    const initIter = transport.receive();
    const initResult = await initIter.next();

    if (initResult.value === undefined || initResult.value === null) {
      throw new Error('No response for initialize request');
    }

    if ('error' in initResult.value) {
      throw new Error(
        `Initialize failed: ${(initResult.value as { error: { message: string } }).error.message}`
      );
    }

    // Send initialized notification
    await transport.send({
      jsonrpc: '2.0' as const,
      method: 'notifications/initialized',
      params: {},
    });

    const boundTransport = transport;
    const sendRequest: SessionRequest = async (msg) => {
      await boundTransport.send(msg as unknown as JsonRpcMessage);
      const iter = boundTransport.receive();
      const res = await iter.next();
      if (res.value === undefined || res.value === null) {
        throw new SessionClosedError(String(msg['method']));
      }
      return res.value as Record<string, unknown>;
    };

    return await fn(sendRequest);
  } finally {
    if (transport !== null) {
      try {
        await transport.close();
      } catch {
        // Ignore close errors
      }
    }
  }
}

/**
 * Shared Streamable HTTP session: POST initialize (capture mcp-session-id) →
 * notifications/initialized, then hand a request sender to `fn`.
 * Errors propagate raw — callers decide the classification.
 */
async function httpSession<T>(
  service: ServiceDefinition,
  timeout: number,
  fn: (sendRequest: SessionRequest) => Promise<T>
): Promise<T> {
  if (service.url === undefined || service.url === null) {
    throw new Error('Service has no URL configured');
  }
  const url = service.url;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };

  if (service.headers !== undefined && service.headers !== null) {
    Object.assign(headers, service.headers);
  }

  // Initialize with timeout
  const initResponse = await Promise.race([
    fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `init-${Date.now()}`,
        method: 'initialize',
        params: initializeParams(),
      }),
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    ),
  ]);

  const sessionId = initResponse.headers.get('mcp-session-id') || undefined;
  const initData = parseJsonRpcBody(await initResponse.text());

  if (initData['error'] !== undefined) {
    throw new Error(
      String((initData['error'] as Record<string, unknown>)['message'] ?? 'initialize failed')
    );
  }

  // Send initialized notification (no id field - it's a notification, not a request)
  await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      ...(sessionId !== undefined ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    }),
  });

  const sendRequest: SessionRequest = async (msg) => {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        ...headers,
        ...(sessionId !== undefined ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify(msg),
    });

    if (!resp.ok) {
      // Per the MCP Streamable HTTP spec, a 404 on a request carrying
      // Mcp-Session-Id means the backend terminated the session — word it so
      // the session-expiry recovery in fetchServiceTools retries it.
      const method = String(msg['method'] ?? 'request');
      if (resp.status === 404) {
        throw new Error(`${method} failed: HTTP 404, session not found or expired`);
      }
      throw new Error(`${method} failed: HTTP ${resp.status}`);
    }

    return parseJsonRpcBody(await resp.text());
  };

  return await fn(sendRequest);
}

/**
 * Shared MCP SSE session (two-phase handshake):
 *  1. Client opens SSE connection (GET sseUrl)
 *  2. Server sends 'endpoint' SSE event containing the POST URL (may be relative)
 *  3. Client POSTs JSON-RPC messages to that URL; responses arrive via SSE 'message' events
 *
 * Handshake/transport failures become DiscoveryError (TIMEOUT / CONNECTION_FAILED).
 * Errors thrown by `fn` keep their identity and propagate unwrapped.
 */
async function sseSession<T>(
  service: ServiceDefinition,
  timeout: number,
  timeoutLabel: string,
  fn: (sendRequest: SessionRequest) => Promise<T>
): Promise<T> {
  if (service.url === undefined || service.url === null) {
    throw new Error('Service has no URL configured');
  }

  const sseUrl = service.url;
  const extraHeaders: Record<string, string> =
    service.headers !== undefined && service.headers !== null ? { ...service.headers } : {};

  return await new Promise<T>((resolve, reject) => {
    let done = false;

    const rejectWith = (err: Error): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      es.close();
      reject(err);
    };

    const fail = (err: Error): void => {
      const isTimeout = err.message.toLowerCase().includes('timeout');
      rejectWith(
        new DiscoveryError(
          isTimeout ? DiscoveryErrorType.TIMEOUT : DiscoveryErrorType.CONNECTION_FAILED,
          service.name,
          err.message,
          err
        )
      );
    };

    const timer = setTimeout(
      () => fail(new Error(`${timeoutLabel} timeout after ${timeout}ms`)),
      timeout
    );

    const es = new EventSource(sseUrl);

    // Map from request-id → resolver, so we can match SSE message events to requests
    const pending = new Map<string, (msg: Record<string, unknown>) => void>();

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as Record<string, unknown>;
        const id = msg['id'] as string | undefined;
        if (id !== undefined) {
          const handler = pending.get(id);
          if (handler !== undefined) {
            pending.delete(id);
            handler(msg);
          }
        }
      } catch {
        // Ignore unparseable messages
      }
    };

    es.onerror = () => {
      // Only treat as failure if we haven't finished yet
      if (!done) {
        fail(new Error('SSE connection failed'));
      }
    };

    if (typeof es.addEventListener !== 'function') {
      fail(new Error('EventSource does not support addEventListener'));
      return;
    }

    es.addEventListener('endpoint', (rawEvent) => {
      if (done) return;

      // Resolve the POST URL (may be relative or absolute)
      const data = rawEvent.data as string;
      let postUrl: string;
      try {
        postUrl =
          data.startsWith('http://') || data.startsWith('https://')
            ? data
            : new URL(data, new URL(sseUrl)).href;
      } catch {
        fail(new Error(`Invalid endpoint URL from server: ${data}`));
        return;
      }

      const postJson = (body: unknown): Promise<void> =>
        fetch(postUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...extraHeaders },
          body: JSON.stringify(body),
        }).then((r) => {
          if (!r.ok) throw new Error(`POST ${postUrl} failed: HTTP ${r.status}`);
        });

      const sendRequest: SessionRequest = (msg) =>
        new Promise((res, rej) => {
          const id = msg['id'] as string;
          pending.set(id, res);
          postJson(msg).catch((err: Error) => {
            pending.delete(id);
            rej(err);
          });
        });

      const run = async (): Promise<void> => {
        const initResp = await sendRequest({
          jsonrpc: '2.0',
          id: `init-${Date.now()}`,
          method: 'initialize',
          params: initializeParams(),
        });

        if (initResp['error'] !== undefined) {
          throw new Error(
            String((initResp['error'] as Record<string, unknown>)['message'] ?? 'initialize failed')
          );
        }

        // 'notifications/initialized' is a notification — no response expected
        await postJson({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });

        let outcome: T;
        try {
          outcome = await fn(sendRequest);
        } catch (err) {
          // fn errors keep their identity — no DiscoveryError wrapping here.
          rejectWith(err instanceof Error ? err : new Error(String(err)));
          return;
        }

        if (!done) {
          done = true;
          clearTimeout(timer);
          es.close();
          resolve(outcome);
        }
      };

      run().catch(fail);
    });
  });
}

/**
 * Discover tools via stdio transport
 */
/**
 * Map a discovery failure onto the DiscoveryError the UI reports.
 *
 * The three transports fail identically from the caller's point of view, so the
 * classification lives here instead of in three copies of the same catch body.
 */
function toDiscoveryFailure(
  err: unknown,
  service: ServiceDefinition,
  timeout: number
): DiscoveryError {
  if (err instanceof DiscoveryError) {
    return err;
  }
  if (isTimeoutError(err)) {
    return new DiscoveryError(
      DiscoveryErrorType.TIMEOUT,
      service.name,
      `Discovery timeout after ${timeout}ms`,
      err instanceof Error ? err : undefined
    );
  }
  return new DiscoveryError(
    DiscoveryErrorType.CONNECTION_FAILED,
    service.name,
    err instanceof Error ? err.message : String(err),
    err instanceof Error ? err : undefined
  );
}

async function discoverToolsViaStdio(service: ServiceDefinition, timeout: number): Promise<Tool[]> {
  if (service.command === undefined || service.command === null) {
    return [];
  }

  try {
    return await stdioSession(service, timeout, (send) => discoverToolsList(send, service));
  } catch (err) {
    throw toDiscoveryFailure(err, service, timeout);
  }
}

/**
 * Discover tools via standard MCP SSE transport (two-phase handshake).
 */
async function discoverToolsViaSse(service: ServiceDefinition, timeout: number): Promise<Tool[]> {
  if (service.url === undefined || service.url === null) {
    return [];
  }

  try {
    return await sseSession(service, timeout, 'Discovery', (send) =>
      discoverToolsList(send, service)
    );
  } catch (err) {
    throw toDiscoveryFailure(err, service, timeout);
  }
}

/**
 * Discover tools via HTTP transport
 */
async function discoverToolsViaHttp(service: ServiceDefinition, timeout: number): Promise<Tool[]> {
  if (service.url === undefined || service.url === null) {
    return [];
  }

  if (service.transport !== 'http' && service.transport !== 'sse') {
    return [];
  }

  try {
    return await httpSession(service, timeout, (send) => discoverToolsList(send, service));
  } catch (err) {
    throw toDiscoveryFailure(err, service, timeout);
  }
}

/**
 * Outcome of one tools/call, normalized for display.
 */
export interface ToolCallOutcome {
  /** Backend flagged the tool execution as failed (result.isError === true). Not a transport failure. */
  isError: boolean;
  /** Text assembled from result.content (text blocks joined with \n). */
  text: string;
  /** The tool's text re-formatted as pretty JSON when it parses as JSON, else verbatim. */
  formatted: string;
  /** Non-text content block types present, e.g. ['image','resource']. */
  nonTextTypes: string[];
  /** Pretty-printed raw JSON-RPC result, for the full-output dump. */
  raw: string;
}

/**
 * JSON-RPC level failure returned by the backend for a tools/call
 * (has a numeric code / data). Transport failures use DiscoveryError.
 */
export class ToolCallError extends Error {
  public readonly serviceName: string;
  public readonly code?: number;
  public readonly data?: unknown;

  constructor(serviceName: string, message: string, code?: number, data?: unknown) {
    super(message);
    this.name = 'ToolCallError';
    this.serviceName = serviceName;
    if (code !== undefined) {
      this.code = code;
    }
    if (data !== undefined) {
      this.data = data;
    }
  }
}

/** Safely pretty-print a value, degrading on circular refs / BigInt. */
/**
 * Re-format tool output as pretty JSON when it parses as JSON; otherwise
 * return the text verbatim. Only strings starting with { or [ are considered
 * JSON candidates, so plain text output never gets mangled.
 */
export function formatToolOutput(text: string): string {
  const trimmed = text.trim();
  const first = trimmed.charAt(0);
  if (first !== '{' && first !== '[') {
    return text;
  }
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2) ?? text;
  } catch {
    return text;
  }
}

/**
 * Flatten an MCP CallToolResult into display text plus the raw pretty JSON.
 */
export function normalizeToolResult(result: unknown): ToolCallOutcome {
  const isError = isRecord(result) && result['isError'] === true;
  const textParts: string[] = [];
  const nonTextTypes: string[] = [];

  const content = isRecord(result) && Array.isArray(result['content']) ? result['content'] : [];
  for (const block of content) {
    if (!isRecord(block)) {
      textParts.push(String(block));
      continue;
    }
    const type = typeof block['type'] === 'string' ? block['type'] : 'unknown';
    if (type === 'text' && typeof block['text'] === 'string') {
      textParts.push(block['text']);
    } else if (type === 'resource' && isRecord(block['resource'])) {
      const uri = block['resource']['uri'];
      nonTextTypes.push(type);
      textParts.push(typeof uri === 'string' ? `[resource: ${uri}]` : '[resource]');
    } else {
      nonTextTypes.push(type);
      textParts.push(`[${type}]`);
    }
  }

  if (textParts.length === 0 && isRecord(result) && result['structuredContent'] !== undefined) {
    textParts.push(safeStringify(result['structuredContent']));
  }

  const joinedText = textParts.length > 0 ? textParts.join('\n') : '(empty result)';
  return {
    isError,
    text: joinedText,
    formatted: formatToolOutput(joinedText),
    nonTextTypes,
    raw: safeStringify(result),
  };
}

/**
 * Unwrap a tools/call response: JSON-RPC error → ToolCallError, else the result.
 */
function unwrapToolCallResult(resp: Record<string, unknown>, serviceName: string): unknown {
  const error = resp['error'];
  if (error !== undefined) {
    const errRecord = isRecord(error) ? error : {};
    const code = typeof errRecord['code'] === 'number' ? errRecord['code'] : undefined;
    const message =
      typeof errRecord['message'] === 'string' ? errRecord['message'] : 'tool call failed';
    throw new ToolCallError(serviceName, message, code, errRecord['data']);
  }
  return resp['result'];
}

/**
 * Reject with `message` when `promise` does not settle within `ms`.
 * The timer is always cleared so fast responses leave nothing pending.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/** Map a raw transport failure to the call-path DiscoveryError taxonomy. */
function toCallFailure(err: unknown, service: ServiceDefinition, timeout: number): DiscoveryError {
  if (isTimeoutError(err)) {
    return new DiscoveryError(
      DiscoveryErrorType.TIMEOUT,
      service.name,
      `Tool call timeout after ${timeout}ms — the tool may still be running on the backend`,
      err instanceof Error ? err : undefined
    );
  }
  return new DiscoveryError(
    DiscoveryErrorType.CONNECTION_FAILED,
    service.name,
    err instanceof Error ? err.message : String(err),
    err instanceof Error ? err : undefined
  );
}

function sendToolsCallRequest(
  send: SessionRequest,
  serviceName: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  return send({
    jsonrpc: '2.0',
    id: `call-${Date.now()}`,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  }).then((resp) => unwrapToolCallResult(resp, serviceName));
}

async function callToolViaStdio(
  service: ServiceDefinition,
  toolName: string,
  args: Record<string, unknown>,
  timeout: number
): Promise<ToolCallOutcome> {
  try {
    const result = await withTimeout(
      stdioSession(service, timeout, (send) =>
        sendToolsCallRequest(send, service.name, toolName, args)
      ),
      timeout,
      `tools/call timeout after ${timeout}ms`
    );
    return normalizeToolResult(result);
  } catch (err) {
    if (err instanceof ToolCallError || err instanceof DiscoveryError) {
      throw err;
    }
    throw toCallFailure(err, service, timeout);
  }
}

async function callToolViaSse(
  service: ServiceDefinition,
  toolName: string,
  args: Record<string, unknown>,
  timeout: number
): Promise<ToolCallOutcome> {
  try {
    const result = await sseSession(service, timeout, 'Tool call', (send) =>
      sendToolsCallRequest(send, service.name, toolName, args)
    );
    return normalizeToolResult(result);
  } catch (err) {
    if (err instanceof ToolCallError || err instanceof DiscoveryError) {
      throw err;
    }
    throw toCallFailure(err, service, timeout);
  }
}

async function callToolViaHttp(
  service: ServiceDefinition,
  toolName: string,
  args: Record<string, unknown>,
  timeout: number
): Promise<ToolCallOutcome> {
  try {
    const result = await withTimeout(
      httpSession(service, timeout, (send) =>
        sendToolsCallRequest(send, service.name, toolName, args)
      ),
      timeout,
      `tools/call timeout after ${timeout}ms`
    );
    return normalizeToolResult(result);
  } catch (err) {
    if (err instanceof ToolCallError || err instanceof DiscoveryError) {
      throw err;
    }
    throw toCallFailure(err, service, timeout);
  }
}

async function callServiceToolOnce(
  service: ServiceDefinition,
  toolName: string,
  args: Record<string, unknown>,
  timeout: number
): Promise<ToolCallOutcome> {
  if (service.transport === 'stdio') {
    return callToolViaStdio(service, toolName, args, timeout);
  } else if (service.transport === 'sse') {
    return callToolViaSse(service, toolName, args, timeout);
  }
  return callToolViaHttp(service, toolName, args, timeout);
}

/**
 * Whether a call failure may be transparently retried on a fresh connection.
 *
 * Same two families the ToolRouter retries: an expired backend session
 * (re-initialized on a fresh connection) and a dead-but-reconnectable
 * transport (stdio respawn, SSE reconnect) — see routing/session-error.ts.
 * A backend that REFUSED to execute the tool (validation error, unknown tool,
 * ...) must not be replayed, so a ToolCallError only retries on a genuine
 * -32001; every other ToolCallError is final.
 */
function isRetryableToolCallFailure(err: unknown): boolean {
  if (err instanceof ToolCallError) {
    return err.code === -32001;
  }
  return isRetryableConnectionFailure(err);
}

/**
 * Session expiry or a dead-but-reconnectable transport — as the router
 * classifies them. Transport failures arrive here wrapped in a DiscoveryError
 * (which keeps the original as `errorCause`), so the wrapper is inspected too;
 * without that, a stdio child dying mid-call would never be retried.
 */
function isRetryableConnectionFailure(err: unknown): boolean {
  if (isRecoverableFailure(err)) {
    return true;
  }
  const cause = err instanceof DiscoveryError ? err.errorCause : undefined;
  return cause !== undefined && cause !== err && isRecoverableFailure(cause);
}

/** One of the three shapes a dead/renewable connection takes at this layer. */
function isRecoverableFailure(err: unknown): boolean {
  return (
    err instanceof SessionClosedError ||
    isSessionExpiryError(err) ||
    isRecoverableConnectionError(err)
  );
}

/**
 * Invoke a tool on a service over a one-shot connection.
 *
 * Mirrors fetchServiceTools: each attempt opens initialize →
 * notifications/initialized → tools/call → close, so a session expiry
 * (-32001 / HTTP 404) is recovered by retrying once on a fresh session.
 * Tool-level backend refusals (other JSON-RPC errors) are thrown as
 * ToolCallError without a retry; result.isError outcomes resolve normally.
 */
export async function callServiceTool(
  service: ServiceDefinition,
  toolName: string,
  args: Record<string, unknown>,
  timeout: number
): Promise<ToolCallOutcome> {
  try {
    return await callServiceToolOnce(service, toolName, args, timeout);
  } catch (err) {
    if (isRetryableToolCallFailure(err)) {
      return await callServiceToolOnce(service, toolName, args, timeout);
    }
    throw err;
  }
}

/**
 * Fetch all tools for a service, returning full tool objects.
 * Used by ServiceTools view to display tool details.
 *
 * Each attempt opens a one-shot connection (initialize → tools/list → close),
 * so a recoverable failure is handled by simply retrying once: the fresh
 * attempt establishes a brand-new backend session (lazy rebuild) and respawns
 * a dead stdio child — the same two families the ToolRouter retries
 * (session expiry, dead-but-reconnectable transport).
 */
export async function fetchServiceTools(
  service: ServiceDefinition,
  timeout: number
): Promise<Tool[]> {
  try {
    return await fetchServiceToolsOnce(service, timeout);
  } catch (err) {
    if (isRetryableConnectionFailure(err)) {
      return await fetchServiceToolsOnce(service, timeout);
    }
    throw err;
  }
}

async function fetchServiceToolsOnce(service: ServiceDefinition, timeout: number): Promise<Tool[]> {
  if (service.transport === 'stdio') {
    return discoverToolsViaStdio(service, timeout);
  } else if (service.transport === 'sse') {
    return discoverToolsViaSse(service, timeout);
  } else {
    return discoverToolsViaHttp(service, timeout);
  }
}

/**
 * Discover tools for a service
 * @param service - Service definition
 * @param timeout - Timeout in milliseconds
 * @returns Number of tools discovered
 */
export async function discoverServiceTools(
  service: ServiceDefinition,
  timeout: number
): Promise<number> {
  try {
    const tools = await fetchServiceTools(service, timeout);
    return tools.length;
  } catch (err) {
    if (err instanceof DiscoveryError) {
      throw err;
    }
    throw new DiscoveryError(
      DiscoveryErrorType.SERVICE_UNAVAILABLE,
      service.name,
      err instanceof Error ? err.message : String(err),
      err instanceof Error ? err : undefined
    );
  }
}
