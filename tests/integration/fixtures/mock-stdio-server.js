#!/usr/bin/env node
/**
 * Mock MCP stdio backend for integration tests.
 *
 * Speaks NDJSON (one JSON-RPC message per line) on stdin/stdout. Exposes three
 * tools (echo, add, exit) so a test can verify tools/list returns a stable N,
 * and can trigger a clean "backend died mid-run" by calling the `exit` tool:
 * the server responds, flushes stdout, then exits with code 0 — exactly the
 * scenario the connection-pool fix must recover from.
 *
 * Used by tests/integration/backend-death-recovery.test.ts.
 */
'use strict';

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo back the provided message',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
  },
  {
    name: 'add',
    description: 'Add two numbers',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
  },
  {
    name: 'exit',
    description: 'Exit the backend with code 0 (simulates a backend that dies mid-run)',
    inputSchema: { type: 'object', properties: {} },
  },
];

function respond(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function handle(req) {
  // Notifications (no id) get no response.
  if (req.id === undefined || req.id === null) {
    return;
  }

  if (req.method === 'initialize') {
    respond({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        serverInfo: { name: 'mock-stdio', version: '1.0.0' },
      },
    });
    return;
  }

  if (req.method === 'tools/list') {
    respond({ jsonrpc: '2.0', id: req.id, result: { tools: TOOLS } });
    return;
  }

  if (req.method === 'tools/call') {
    const name = req.params && req.params.name;
    const args = (req.params && req.params.arguments) || {};

    if (name === 'exit') {
      // Respond, then exit code 0 AFTER the response is flushed to stdout so the
      // client always receives the reply before the transport's process 'exit'
      // fires — mirroring a backend that dies cleanly after serving a request.
      const resp = {
        jsonrpc: '2.0',
        id: req.id,
        result: { content: [{ type: 'text', text: 'exiting' }] },
      };
      process.stdout.write(JSON.stringify(resp) + '\n', () => process.exit(0));
      return;
    }

    if (name === 'echo') {
      respond({
        jsonrpc: '2.0',
        id: req.id,
        result: { content: [{ type: 'text', text: String(args.message ?? '') }] },
      });
      return;
    }

    if (name === 'add') {
      const sum = Number(args.a || 0) + Number(args.b || 0);
      respond({
        jsonrpc: '2.0',
        id: req.id,
        result: { content: [{ type: 'text', text: String(sum) }] },
      });
      return;
    }

    respond({
      jsonrpc: '2.0',
      id: req.id,
      error: { code: -32602, message: `Unknown tool: ${name}` },
    });
    return;
  }

  respond({
    jsonrpc: '2.0',
    id: req.id,
    error: { code: -32601, message: `Unknown method: ${req.method}` },
  });
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  const lines = buf.split('\n');
  buf = lines.pop() || '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let req;
    try {
      req = JSON.parse(trimmed);
    } catch {
      continue;
    }
    handle(req);
  }
});

// Don't terminate just because stdin closes; let the pool drive the lifecycle.
process.stdin.on('end', () => {});
