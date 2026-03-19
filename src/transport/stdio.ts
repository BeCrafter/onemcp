/**
 * Stdio Transport implementation for MCP servers using child process stdin/stdout
 */

import { ChildProcess, spawn } from 'child_process';
import { BaseTransport, TransportError } from './base.js';
import type { JsonRpcMessage } from '../types/jsonrpc.js';
import type { TransportType } from '../types/service.js';

const isWindows = process.platform === 'win32';

/**
 * Gracefully terminate a child process in a cross-platform way.
 * On Windows, POSIX signals are not supported; we use process.kill() without
 * a signal argument which sends the default termination signal on each platform.
 */
function killProcess(proc: ChildProcess, force: boolean): void {
  // proc.exitCode is null while the process is running; non-null means it has exited
  if (proc.killed || (proc.exitCode !== null && proc.exitCode !== undefined)) {
    return;
  }
  if (isWindows) {
    // On Windows, only the default (no-signal) kill is reliable.
    // taskkill /F /PID is the forceful equivalent but requires a shell call;
    // Node's .kill() maps to TerminateProcess on Windows regardless of signal.
    proc.kill();
  } else {
    proc.kill(force ? 'SIGKILL' : 'SIGTERM');
  }
}

/**
 * Configuration for StdioTransport
 */
export interface StdioTransportConfig {
  /** Command to execute */
  command: string;
  /** Command arguments */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Working directory */
  cwd?: string;
}

/**
 * StdioTransport implementation using child process stdin/stdout
 * Handles message framing and parsing for stdio streams
 */
export class StdioTransport extends BaseTransport {
  private process: ChildProcess | null = null;
  private messageBuffer: string = '';
  private messageQueue: JsonRpcMessage[] = [];
  private resolveQueue: Array<(value: IteratorResult<JsonRpcMessage>) => void> = [];
  private rejectQueue: Array<(error: Error) => void> = [];
  private receiveClosed = false;

  constructor(private config: StdioTransportConfig) {
    super();
    this.startProcess();
  }

  /**
   * Get the transport type
   */
  public getType(): TransportType {
    return 'stdio';
  }

  /**
   * Start the child process
   */
  private startProcess(): void {
    try {
      // Spawn the child process
      this.process = spawn(this.config.command, this.config.args || [], {
        env: { ...process.env, ...this.config.env },
        cwd: this.config.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Set up stdout handler for receiving messages
      if (this.process.stdout) {
        this.process.stdout.setEncoding('utf8');
        this.process.stdout.on('data', (chunk: string) => {
          this.handleStdoutData(chunk);
        });

        this.process.stdout.on('end', () => {
          this.handleStreamEnd();
        });
      }

      // Set up stderr handler for logging errors
      if (this.process.stderr) {
        this.process.stderr.setEncoding('utf8');
        this.process.stderr.on('data', (chunk: string) => {
          // Log stderr output (could be enhanced with proper logging)
          console.error(`[${this.config.command}] ${chunk}`);
        });
      }

      // Handle process exit
      this.process.on('exit', (code, signal) => {
        this.handleProcessExit(code, signal);
      });

      // Handle process errors
      this.process.on('error', (error) => {
        this.handleError(
          new TransportError(`Process error: ${error.message}`, 'PROCESS_ERROR', error)
        );
      });

      // Mark as connected once process is spawned
      this.setConnected();
    } catch (error) {
      this.handleError(
        new TransportError(
          `Failed to start process: ${error instanceof Error ? error.message : String(error)}`,
          'PROCESS_START_FAILED',
          error instanceof Error ? error : undefined
        )
      );
      throw error;
    }
  }

  /**
   * Handle stdout data and parse JSON-RPC messages
   */
  private handleStdoutData(chunk: string): void {
    this.messageBuffer += chunk;

    // Parse complete JSON messages from buffer
    // Messages are separated by newlines
    const lines = this.messageBuffer.split('\n');

    // Keep the last incomplete line in the buffer
    this.messageBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        try {
          const message = JSON.parse(trimmed) as JsonRpcMessage;
          this.enqueueMessage(message);
        } catch (error) {
          console.error(`Failed to parse JSON-RPC message: ${trimmed}`, error);
          // Continue processing other messages
        }
      }
    }
  }

  /**
   * Enqueue a received message
   */
  private enqueueMessage(message: JsonRpcMessage): void {
    if (this.resolveQueue.length > 0) {
      // If there's a waiting receiver, resolve it immediately
      const resolve = this.resolveQueue.shift();
      if (resolve) {
        resolve({ value: message, done: false });
      }
    } else {
      // Otherwise, add to message queue
      this.messageQueue.push(message);
    }
  }

  /**
   * Handle stream end
   */
  private handleStreamEnd(): void {
    this.receiveClosed = true;
    // Resolve all waiting receivers with done
    while (this.resolveQueue.length > 0) {
      const resolve = this.resolveQueue.shift();
      if (resolve) {
        resolve({ value: undefined, done: true });
      }
    }
  }

  /**
   * Handle process exit
   */
  private handleProcessExit(code: number | null, signal: NodeJS.Signals | null): void {
    const exitInfo = signal ? `signal ${signal}` : `code ${code}`;

    // Only treat non-zero exit codes as errors
    // Signals like SIGTERM are normal termination
    if (code !== null && code !== 0) {
      this.handleError(new TransportError(`Process exited with ${exitInfo}`, 'PROCESS_EXITED'));
    }

    // Reject all waiting receivers
    const error = new TransportError(`Process exited with ${exitInfo}`, 'PROCESS_EXITED');
    while (this.rejectQueue.length > 0) {
      const reject = this.rejectQueue.shift();
      if (reject) {
        reject(error);
      }
    }
  }

  /**
   * Send a message to the child process stdin
   */
  protected async doSend(message: JsonRpcMessage): Promise<void> {
    if (!this.process || !this.process.stdin) {
      throw new TransportError('Process stdin is not available', 'STDIN_UNAVAILABLE');
    }

    if (this.process.stdin.destroyed) {
      throw new TransportError('Process stdin is destroyed', 'STDIN_DESTROYED');
    }

    try {
      // Serialize message and write to stdin with newline
      const serialized = JSON.stringify(message) + '\n';

      return new Promise<void>((resolve, reject) => {
        if (!this.process || !this.process.stdin) {
          reject(new TransportError('Process or stdin not available', 'STDIN_UNAVAILABLE'));
          return;
        }
        this.process.stdin.write(serialized, (error) => {
          if (error) {
            reject(
              new TransportError(
                `Failed to write to stdin: ${error.message}`,
                'STDIN_WRITE_FAILED',
                error
              )
            );
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      throw new TransportError(
        `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
        'SEND_FAILED',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Receive messages from the child process stdout
   */
  protected async *doReceive(): AsyncIterator<JsonRpcMessage> {
    while (true) {
      // If there are queued messages, yield them first
      if (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift();
        if (message) {
          yield message;
        }
        continue;
      }

      // If receive is closed, we're done
      if (this.receiveClosed) {
        return;
      }

      // Wait for next message
      const result = await new Promise<IteratorResult<JsonRpcMessage>>((resolve, reject) => {
        this.resolveQueue.push(resolve);
        this.rejectQueue.push(reject);
      });

      if (result.done) {
        return;
      }

      yield result.value;
    }
  }

  /**
   * Close the transport and terminate the child process
   */
  protected async doClose(): Promise<void> {
    if (!this.process) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      if (!this.process) {
        reject(new TransportError('Process is null', 'PROCESS_NULL'));
        return;
      }

      const timeout = setTimeout(() => {
        // Force kill if graceful shutdown takes too long
        if (this.process && !this.process.killed) {
          killProcess(this.process, true);
        }
        reject(new TransportError('Process termination timeout', 'CLOSE_TIMEOUT'));
      }, 5000); // 5 second timeout

      this.process.once('exit', () => {
        clearTimeout(timeout);
        this.process = null;
        resolve();
      });

      // Try graceful shutdown first: close stdin so the child can exit cleanly
      if (this.process.stdin && !this.process.stdin.destroyed) {
        this.process.stdin.end();
      }

      // Send termination signal (platform-aware)
      killProcess(this.process, false);
    });
  }
}
