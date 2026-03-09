/**
 * Integration tests for CLI mode
 *
 * Tests the complete CLI mode workflow including:
 * - CLI startup and initialization
 * - Request processing via stdio
 * - Graceful shutdown
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { resolve } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import type {
  JsonRpcRequest,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
} from '../../src/types/jsonrpc.js';

describe('CLI Mode Integration Tests', () => {
  let testConfigDir: string;
  let cliProcess: ChildProcess | null = null;

  beforeEach(() => {
    // Create temporary config directory
    testConfigDir = resolve(tmpdir(), `onemcp-test-${Date.now()}`);
    mkdirSync(testConfigDir, { recursive: true });
    mkdirSync(resolve(testConfigDir, 'services'), { recursive: true });
    mkdirSync(resolve(testConfigDir, 'logs'), { recursive: true });
    mkdirSync(resolve(testConfigDir, 'backups'), { recursive: true });

    // Create test configuration
    const config = {
      mode: 'cli',
      logLevel: 'ERROR', // Reduce noise in tests
      configDir: testConfigDir,
      services: [],
      connectionPool: {
        maxConnections: 5,
        idleTimeout: 60000,
        connectionTimeout: 30000,
      },
      healthCheck: {
        enabled: false, // Disable for faster tests
        interval: 30000,
        failureThreshold: 3,
        autoUnload: true,
      },
      audit: {
        enabled: false, // Disable for faster tests
        level: 'minimal' as const,
        logInput: false,
        logOutput: false,
        retention: {
          days: 30,
          maxSize: '1GB',
        },
      },
      security: {
        dataMasking: {
          enabled: true,
          patterns: ['password', 'token'],
        },
      },
      logging: {
        level: 'ERROR' as const,
        outputs: ['console' as const],
        format: 'json' as const,
      },
      metrics: {
        enabled: false, // Disable for faster tests
        collectionInterval: 60000,
        retentionPeriod: 86400000,
      },
    };

    writeFileSync(resolve(testConfigDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
  });

  afterEach(async () => {
    // Clean up CLI process
    if (cliProcess) {
      cliProcess.kill('SIGTERM');

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        cliProcess?.once('exit', () => resolve());

        // Force kill after timeout
        setTimeout(() => {
          if (cliProcess && !cliProcess.killed) {
            cliProcess.kill('SIGKILL');
          }
          resolve();
        }, 5000);
      });

      cliProcess = null;
    }

    // Clean up test directory
    try {
      rmSync(testConfigDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  /**
   * Start the CLI process
   */
  function startCliProcess(): ChildProcess {
    // Build the CLI if not already built
    // In a real test, we'd ensure the build is up to date
    const cliPath = resolve(__dirname, '../../dist/cli.js');

    const process = spawn('node', [cliPath, '--config-dir', testConfigDir], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return process;
  }

  /**
   * Send a JSON-RPC request to the CLI process
   */
  function sendRequest(process: ChildProcess, request: JsonRpcRequest): void {
    const message = JSON.stringify(request) + '\n';
    process.stdin?.write(message);
  }

  /**
   * Wait for a JSON-RPC response from the CLI process
   */
  function waitForResponse(
    process: ChildProcess,
    timeout = 5000
  ): Promise<JsonRpcSuccessResponse | JsonRpcErrorResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Response timeout'));
      }, timeout);

      const onData = (chunk: Buffer) => {
        clearTimeout(timer);
        process.stdout?.off('data', onData);

        try {
          const response = JSON.parse(chunk.toString().trim()) as
            | JsonRpcSuccessResponse
            | JsonRpcErrorResponse;
          resolve(response);
        } catch (error) {
          reject(new Error(`Failed to parse response: ${String(error)}`));
        }
      };

      process.stdout?.on('data', onData);
    });
  }

  it('should start CLI process successfully', async () => {
    cliProcess = startCliProcess();

    // Wait for process to be ready (stderr will contain startup messages)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('CLI startup timeout'));
      }, 10000);

      const onStderr = (chunk: Buffer) => {
        const message = chunk.toString();
        if (message.includes('ready and listening')) {
          clearTimeout(timeout);
          cliProcess?.stderr?.off('data', onStderr);
          resolve();
        }
      };

      if (cliProcess) {
        cliProcess.stderr?.on('data', onStderr);

        // Also handle process exit as failure
        cliProcess.once('exit', (code) => {
          clearTimeout(timeout);
          if (code !== 0) {
            reject(new Error(`CLI process exited with code ${code}`));
          }
        });
      }
    });

    expect(cliProcess.killed).toBe(false);
  });

  it('should handle initialize request', async () => {
    cliProcess = startCliProcess();

    // Wait for process to be ready
    await new Promise<void>((resolve) => {
      const onStderr = (chunk: Buffer) => {
        if (chunk.toString().includes('ready and listening')) {
          cliProcess?.stderr?.off('data', onStderr);
          resolve();
        }
      };
      cliProcess?.stderr?.on('data', onStderr);
    });

    // Send initialize request
    const initRequest: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        clientInfo: {
          name: 'test-client',
          version: '1.0.0',
        },
      },
    };

    sendRequest(cliProcess, initRequest);

    // Wait for response
    const response = await waitForResponse(cliProcess);

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(1);
    expect('result' in response).toBe(true);

    if ('result' in response) {
      const result = response.result as {
        protocolVersion: string;
        serverInfo?: { name: string } | null;
      };
      expect(result.protocolVersion).toBe('2024-11-05');
      expect(result.serverInfo).toBeDefined();
      if (result.serverInfo) {
        expect(result.serverInfo.name).toBe('onemcp');
      }
    }
  });

  it('should handle tools/list request', async () => {
    cliProcess = startCliProcess();

    // Wait for process to be ready
    await new Promise<void>((resolve) => {
      const onStderr = (chunk: Buffer) => {
        if (chunk.toString().includes('ready and listening')) {
          cliProcess?.stderr?.off('data', onStderr);
          resolve();
        }
      };
      cliProcess?.stderr?.on('data', onStderr);
    });

    // Initialize first
    const initRequest: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
      },
    };

    sendRequest(cliProcess, initRequest);
    await waitForResponse(cliProcess);

    // Send tools/list request
    const toolsListRequest: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    };

    sendRequest(cliProcess, toolsListRequest);

    // Wait for response
    const response = await waitForResponse(cliProcess);

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(2);
    expect('result' in response).toBe(true);

    if ('result' in response) {
      const result = response.result as { tools?: unknown[] };
      expect(result.tools).toBeDefined();
      expect(Array.isArray(result.tools)).toBe(true);
      // With no services configured, tools array should be empty
      if (Array.isArray(result.tools)) {
        expect(result.tools.length).toBe(0);
      }
    }
  });

  it('should return error for unknown method', async () => {
    const proc = startCliProcess();
    cliProcess = proc;

    // Wait for process to be ready
    await new Promise<void>((resolve) => {
      const onStderr = (chunk: Buffer) => {
        if (chunk.toString().includes('ready and listening')) {
          proc.stderr?.off('data', onStderr);
          resolve();
        }
      };
      proc.stderr?.on('data', onStderr);
    });

    // Send request with unknown method
    const unknownRequest: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'unknown/method',
      params: {},
    };

    sendRequest(proc, unknownRequest);

    // Wait for response
    const response = await waitForResponse(proc);

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(1);
    expect('error' in response).toBe(true);

    if ('error' in response) {
      expect(response.error.code).toBe(-32601); // Method not found
    }
  });

  it('should handle graceful shutdown on SIGTERM', async () => {
    cliProcess = startCliProcess();

    // Wait for process to be ready
    await new Promise<void>((resolve) => {
      const onStderr = (chunk: Buffer) => {
        if (chunk.toString().includes('ready and listening')) {
          cliProcess!.stderr?.off('data', onStderr);
          resolve();
        }
      };
      cliProcess!.stderr?.on('data', onStderr);
    });

    // Send SIGTERM
    cliProcess.kill('SIGTERM');

    // Wait for process to exit
    const exitCode = await new Promise<number | null>((resolve) => {
      cliProcess!.once('exit', (code) => {
        resolve(code);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        resolve(null);
      }, 5000);
    });

    expect(exitCode).toBe(0);
  });

  it('should handle graceful shutdown on SIGINT', async () => {
    cliProcess = startCliProcess();

    // Wait for process to be ready
    await new Promise<void>((resolve) => {
      const onStderr = (chunk: Buffer) => {
        if (chunk.toString().includes('ready and listening')) {
          cliProcess!.stderr!.off('data', onStderr);
          resolve();
        }
      };
      cliProcess!.stderr!.on('data', onStderr);
    });

    // Send SIGINT
    cliProcess.kill('SIGINT');

    // Wait for process to exit
    const exitCode = await new Promise<number | null>((resolve) => {
      cliProcess!.once('exit', (code) => {
        resolve(code);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        resolve(null);
      }, 5000);
    });

    expect(exitCode).toBe(0);
  });

  it('should handle stdin close', async () => {
    cliProcess = startCliProcess();

    // Wait for process to be ready
    await new Promise<void>((resolve) => {
      const onStderr = (chunk: Buffer) => {
        if (chunk.toString().includes('ready and listening')) {
          cliProcess!.stderr!.off('data', onStderr);
          resolve();
        }
      };
      cliProcess!.stderr!.on('data', onStderr);
    });

    // Close stdin
    cliProcess.stdin!.end();

    // Wait for process to exit
    const exitCode = await new Promise<number | null>((resolve) => {
      cliProcess!.once('exit', (code) => {
        resolve(code);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        resolve(null);
      }, 5000);
    });

    // Process should exit gracefully when stdin closes
    expect(exitCode).not.toBeNull();
  });
});
