/**
 * Mock stdio MCP backend for the TUI end-to-end script (scripts/tui-e2e.mjs).
 *
 * Intentionally separate from tests/integration/fixtures/mock-stdio-mcp.cjs:
 * that fixture is asserted on by scripts/e2e-local.mjs (exact tool list), so it
 * must stay as-is. This one is richer — parameters of every kind, a large
 * payload, JSON output and a failing tool — so the TUI's tools view (parameter
 * form, run, result panel, paging) can be exercised without a real backend.
 *
 * Speaks NDJSON over stdin/stdout (OneMCP's stdio transport framing):
 *   initialize / notifications/initialized / tools/list / tools/call
 */
'use strict';

const readline = require('readline');

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo back the input text.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to echo' } },
      required: ['text'],
    },
  },
  {
    name: 'add',
    description: 'Add two numbers together.',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'number', description: 'First addend' },
        b: { type: 'number', description: 'Second addend' },
      },
      required: ['a', 'b'],
    },
  },
  {
    name: 'big_output',
    // Deliberately long: the TUI expands it with Ctrl+E and then scrolls it with
    // the arrow keys (scenario T14), which needs more lines than the panel shows.
    description: [
      'Returns a large text payload for paging and copy checks.',
      ...Array.from(
        { length: 24 },
        (_, i) => `desc-line-${String(i).padStart(2, '0')} — filler line for the description-scroll scenario`
      ),
    ].join('\n'),
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'fail',
    description: 'Always returns an error result.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
];

const text = (content) => ({ content: [{ type: 'text', text: content }] });
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

  switch (request.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          serverInfo: { name: 'tui-mock-mcp', version: '1.0.0' },
        },
      });
      break;
    case 'notifications/initialized':
      break;
    case 'tools/list':
      send({ jsonrpc: '2.0', id: request.id, result: { tools: TOOLS } });
      break;
    case 'tools/call': {
      const name = request.params && request.params.name;
      const args = (request.params && request.params.arguments) || {};
      if (name === 'echo') {
        send({ jsonrpc: '2.0', id: request.id, result: text('echo: ' + JSON.stringify(args.text)) });
        return;
      }
      if (name === 'add') {
        const sum = Number(args.a) + Number(args.b);
        send({ jsonrpc: '2.0', id: request.id, result: text('sum: ' + String(sum)) });
        return;
      }
      if (name === 'big_output') {
        const lines = [];
        for (let i = 1; i <= 120; i += 1) {
          lines.push(`[${String(i).padStart(3, '0')}] line ${i} — the quick brown fox jumps over the lazy dog`);
        }
        send({ jsonrpc: '2.0', id: request.id, result: text(lines.join('\n')) });
        return;
      }
      if (name === 'fail') {
        send({
          jsonrpc: '2.0',
          id: request.id,
          result: { content: [{ type: 'text', text: 'boom: simulated backend failure' }], isError: true },
        });
        return;
      }
      send({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32602, message: `Unknown tool: ${String(name)}` },
      });
      break;
    }
    default:
      if (request.id !== undefined && request.id !== null) {
        send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } });
      }
      break;
  }
});

process.stderr.on('error', () => {});
