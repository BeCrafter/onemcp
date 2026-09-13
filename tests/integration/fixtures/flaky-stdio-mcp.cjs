/**
 * stdio MCP fixture whose FIRST run dies in the middle of `tools/call`.
 *
 * Liveness is tracked with a marker file (path in FLAKY_MARKER): absent → this
 * process is the "first attempt", so it answers `initialize` and then exits
 * without answering `tools/call` (a backend that died mid-call). Present → the
 * process behaves normally.
 *
 * Used by tests/integration/tui-call-dead-transport-recovery.test.ts to prove
 * the TUI call path retries a dead-but-reconnectable transport, the way the
 * ToolRouter does. The delay before exiting lets the request reach the child.
 */
'use strict';

const fs = require('node:fs');
const readline = require('node:readline');

const marker = process.env.FLAKY_MARKER;
const dieOnCall = marker !== undefined && !fs.existsSync(marker);
if (dieOnCall && marker !== undefined) {
  fs.writeFileSync(marker, String(process.pid));
}

const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (!request || !request.method) return;

  if (request.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        serverInfo: { name: 'flaky-stdio-mcp', version: '1.0.0' },
      },
    });
    return;
  }
  if (request.method === 'notifications/initialized') return;
  if (request.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        tools: [
          {
            name: 'echo',
            description: 'Echo back the input text.',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
          },
        ],
      },
    });
    return;
  }
  if (request.method === 'tools/call') {
    if (dieOnCall) {
      // Die mid-call: the caller must see a dead transport, not a refusal.
      setTimeout(() => process.exit(0), 20);
      return;
    }
    send({
      jsonrpc: '2.0',
      id: request.id,
      result: { content: [{ type: 'text', text: 'echo: ' + JSON.stringify(request.params?.arguments?.text) }] },
    });
    return;
  }
  if (request.id !== undefined && request.id !== null) {
    send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } });
  }
});

process.stderr.on('error', () => {});
