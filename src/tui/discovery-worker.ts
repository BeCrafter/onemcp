/**
 * Discovery Worker
 * Handles tool discovery for individual services
 */

import { StdioTransport } from '../transport/stdio.js';
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
 * Discover tools via stdio transport
 */
async function discoverToolsViaStdio(service: ServiceDefinition, timeout: number): Promise<Tool[]> {
  if (service.command === undefined || service.command === null) {
    return [];
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
    const initRequest = {
      jsonrpc: '2.0' as const,
      id: `init-${Date.now()}`,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'onemcp-tui',
          version: '0.1.0',
        },
      },
    };
    await transport.send(initRequest);

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
      method: 'initialized',
      params: {},
    });

    // Send tools/list request
    const toolsRequest = {
      jsonrpc: '2.0' as const,
      id: `tools-${Date.now()}`,
      method: 'tools/list',
      params: {},
    };
    await transport.send(toolsRequest);

    // Wait for tools response
    const toolsIter = transport.receive();
    const toolsResult = await toolsIter.next();

    if (toolsResult.value === undefined || toolsResult.value === null) {
      throw new Error('No response for tools/list request');
    }

    if ('error' in toolsResult.value) {
      throw new Error(
        `tools/list failed: ${(toolsResult.value as { error: { message: string } }).error.message}`
      );
    }

    const result = toolsResult.value as {
      result?: { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> };
    };
    if (result.result?.tools !== undefined && result.result.tools !== null) {
      return result.result.tools.map((t) => ({
        name: t.name,
        namespacedName: `${service.name}__${t.name}`,
        serviceName: service.name,
        description: t.description || '',
        inputSchema: (t.inputSchema as {
          type: 'object';
          properties: Record<string, unknown>;
          required?: string[];
        }) || {
          type: 'object',
          properties: {},
        },
        enabled: true,
      }));
    }

    return [];
  } catch (err) {
    if (err instanceof Error && err.message.includes('timeout')) {
      throw new DiscoveryError(
        DiscoveryErrorType.TIMEOUT,
        service.name,
        `Discovery timeout after ${timeout}ms`,
        err
      );
    }
    throw new DiscoveryError(
      DiscoveryErrorType.CONNECTION_FAILED,
      service.name,
      err instanceof Error ? err.message : String(err),
      err instanceof Error ? err : undefined
    );
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
 * Discover tools via HTTP transport
 */
async function discoverToolsViaHttp(service: ServiceDefinition, timeout: number): Promise<Tool[]> {
  if (service.url === undefined || service.url === null) {
    return [];
  }

  if (service.transport !== 'http' && service.transport !== 'sse') {
    return [];
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };

  if (service.headers !== undefined && service.headers !== null) {
    Object.assign(headers, service.headers);
  }

  let sessionId: string | undefined;

  try {
    // Initialize with timeout
    const initResponse = await Promise.race([
      fetch(service.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `init-${Date.now()}`,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: 'onemcp-tui',
              version: '0.1.0',
            },
          },
        }),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), timeout)
      ),
    ]);

    sessionId = initResponse.headers.get('mcp-session-id') || undefined;

    const initText = await initResponse.text();
    let initData: { error?: { message: string } } | undefined;

    // Handle SSE response format
    if (initText.startsWith('event:') || initText.includes('\ndata: ')) {
      const lines = initText.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          initData = JSON.parse(line.slice(6)) as { error?: { message: string } };
          break;
        }
      }
    } else {
      initData = JSON.parse(initText) as { error?: { message: string } };
    }

    if (initData !== undefined && initData.error !== undefined) {
      throw new Error(initData.error.message);
    }

    // Send initialized notification
    await fetch(service.url, {
      method: 'POST',
      headers: {
        ...headers,
        ...(sessionId !== undefined ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `notif-${Date.now()}`,
        method: 'initialized',
        params: {},
      }),
    });

    // List tools
    const toolsResponse = await fetch(service.url, {
      method: 'POST',
      headers: {
        ...headers,
        ...(sessionId !== undefined ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `tools-${Date.now()}`,
        method: 'tools/list',
        params: {},
      }),
    });

    const toolsText = await toolsResponse.text();
    let toolsData:
      | {
          error?: { message: string };
          result?: { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> };
        }
      | undefined;

    if (toolsText.startsWith('event:') || toolsText.includes('\ndata: ')) {
      const lines = toolsText.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          toolsData = JSON.parse(line.slice(6)) as {
            error?: { message: string };
            result?: {
              tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
            };
          };
          break;
        }
      }
    } else {
      toolsData = JSON.parse(toolsText) as {
        error?: { message: string };
        result?: { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> };
      };
    }

    if (toolsData !== undefined && toolsData.error !== undefined) {
      throw new Error(toolsData.error.message);
    }

    if (
      toolsData !== undefined &&
      toolsData.result?.tools !== undefined &&
      toolsData.result.tools !== null
    ) {
      return toolsData.result.tools.map((t) => ({
        name: t.name,
        namespacedName: `${service.name}__${t.name}`,
        serviceName: service.name,
        description: t.description || '',
        inputSchema: (t.inputSchema as {
          type: 'object';
          properties: Record<string, unknown>;
          required?: string[];
        }) || {
          type: 'object',
          properties: {},
        },
        enabled: true,
      }));
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('timeout')) {
      throw new DiscoveryError(
        DiscoveryErrorType.TIMEOUT,
        service.name,
        `Discovery timeout after ${timeout}ms`,
        err
      );
    }
    throw new DiscoveryError(
      DiscoveryErrorType.CONNECTION_FAILED,
      service.name,
      err instanceof Error ? err.message : String(err),
      err instanceof Error ? err : undefined
    );
  }

  return [];
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
    let tools: Tool[];

    if (service.transport === 'stdio') {
      tools = await discoverToolsViaStdio(service, timeout);
    } else {
      tools = await discoverToolsViaHttp(service, timeout);
    }

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
