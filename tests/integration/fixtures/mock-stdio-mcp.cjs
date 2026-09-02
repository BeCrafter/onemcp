/**
 * Minimal stdio MCP backend used by integration tests.
 *
 * Speaks NDJSON over stdin/stdout (OneMCP's stdio transport framing):
 *   - initialize           -> success result
 *   - notifications/initialized -> no response (notification)
 *   - tools/list           -> N tools
 *   - tools/call           -> success result
 *
 * When ONEMCP_FIXTURE_EXIT_AFTER_LIST=1, the process exits with code 0 a short
 * time after responding to tools/list, simulating a backend that dies mid-run.
 * The small delay ensures the response is flushed to the reader before exit.
 */
'use strict';

const readline = require('readline');

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo back the input text',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
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
];

const EXIT_AFTER_LIST = process.env.ONEMCP_FIXTURE_EXIT_AFTER_LIST === '1';
// Exit after responding to the Nth tools/call (deterministic mid-conversation death)
const EXIT_AFTER_CALLS = parseInt(process.env.ONEMCP_FIXTURE_EXIT_AFTER_CALLS || '', 10);
let toolsCallCount = 0;

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return; // ignore malformed lines
  }
  if (!request || !request.method) {
    return;
  }

  switch (request.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          serverInfo: { name: 'mock-stdio-mcp', version: '1.0.0' },
        },
      });
      break;
    case 'notifications/initialized':
      // Notification — no response.
      break;
    case 'tools/list':
      send({ jsonrpc: '2.0', id: request.id, result: { tools: TOOLS } });
      if (EXIT_AFTER_LIST) {
        rl.close();
        setTimeout(() => process.exit(0), 50);
      }
      break;
    case 'tools/call':
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: { content: [{ type: 'text', text: 'ok' }] },
      });
      toolsCallCount += 1;
      if (Number.isFinite(EXIT_AFTER_CALLS) && toolsCallCount >= EXIT_AFTER_CALLS) {
        rl.close();
        setTimeout(() => process.exit(0), 50);
      }
      break;
    default:
      if (request.id !== undefined && request.id !== null) {
        send({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32601, message: 'Method not found' },
        });
      }
      break;
  }
});

// Keep stderr quiet so it doesn't interfere with the transport.
process.stderr.on('error', () => {});
