/**
 * Shared ANSI-terminal test harness for TUI integration tests.
 *
 * Ink writes escape sequences to its stdout; these helpers keep a small grid
 * that mirrors what a real terminal would show, so tests can assert on the
 * RENDERED screen instead of on raw escape codes. `maxRowWritten` is tracked
 * separately: a frame that writes past the last row is exactly the overflow
 * that corrupts a real terminal (it scrolls mid-frame and every later absolute
 * cursor move lands on the wrong line).
 */

import React from 'react';
import { Readable } from 'stream';
import { render } from 'ink';

export class Terminal {
  grid: string[][];
  rows: number;
  cols: number;
  /** Highest 0-based row the renderer has written to. */
  maxRowWritten = 0;
  private r = 0;
  private c = 0;

  constructor(rows: number, cols: number) {
    this.rows = rows;
    this.cols = cols;
    this.grid = Array.from({ length: rows }, () => Array(cols).fill(' '));
  }

  feed(data: string): void {
    let i = 0;
    while (i < data.length) {
      const ch = data[i]!;
      if (ch === '\x1b') {
        if (data[i + 1] === '[') {
          let j = i + 2;
          let paramStr = '';
          while (j < data.length && !/[A-Za-z]/.test(data[j]!)) {
            paramStr += data[j]!;
            j++;
          }
          const final = data[j]!;
          j++;
          const isPrivate = paramStr.includes('?');
          const clean = paramStr.replace(/[^0-9;]/g, '');
          const parts = clean.split(';');
          const num = (s: string) => (s === '' ? 1 : parseInt(s, 10) || 1);
          if (!isPrivate) {
            if (final === 'H' || final === 'f') {
              this.r = Math.min(this.rows - 1, Math.max(0, num(parts[0] ?? '1') - 1));
              this.c = Math.min(this.cols - 1, Math.max(0, num(parts[1] ?? '1') - 1));
            } else if (final === 'A') this.r = Math.max(0, this.r - num(parts[0] ?? '1'));
            else if (final === 'B') this.r = Math.min(this.rows - 1, this.r + num(parts[0] ?? '1'));
            else if (final === 'C') this.c = Math.min(this.cols - 1, this.c + num(parts[0] ?? '1'));
            else if (final === 'D') this.c = Math.max(0, this.c - num(parts[0] ?? '1'));
            else if (final === 'G')
              this.c = Math.min(this.cols - 1, Math.max(0, num(parts[0] ?? '1') - 1));
            else if (final === 'K') {
              if (this.r >= 0 && this.r < this.rows) {
                for (let k = this.c; k < this.cols; k++) this.grid[this.r]![k] = ' ';
              }
            } else if (final === 'J' && parts[0] === '2') {
              for (let rr = 0; rr < this.rows; rr++)
                for (let cc = 0; cc < this.cols; cc++) this.grid[rr]![cc] = ' ';
            }
          }
          i = j;
        } else {
          i += 2;
          while (i < data.length && !/[A-Za-z]/.test(data[i]!)) i++;
          i++;
        }
      } else if (ch === '\n') {
        this.r++;
        this.maxRowWritten = Math.max(this.maxRowWritten, this.r);
        this.c = 0;
        i++;
      } else if (ch === '\r') {
        this.c = 0;
        i++;
      } else if (ch >= ' ') {
        if (this.r >= 0 && this.r < this.rows && this.c >= 0 && this.c < this.cols) {
          this.grid[this.r]![this.c] = ch;
        }
        this.maxRowWritten = Math.max(this.maxRowWritten, this.r);
        this.c++;
        i++;
      } else {
        i++;
      }
    }
  }

  text(): string {
    return this.grid.map((row) => row.join('').replace(/\s+$/, '')).join('\n');
  }

  /** Rendered lines with trailing blank rows removed. */
  lines(): string[] {
    const all = this.text().split('\n');
    let last = all.length - 1;
    while (last >= 0 && all[last]!.trim() === '') last--;
    return all.slice(0, last + 1);
  }
}

export const createStdin = (): any => {
  const stdin: any = new Readable({ read() {} });
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.ref = () => {};
  stdin.unref = () => {};
  return stdin;
};

export interface RenderOptions {
  rows: number;
  cols: number;
}

/** Render an element against a fake TTY of the given size. */
export function renderWithTerminal(
  element: React.ReactElement,
  { rows, cols }: RenderOptions
): { instance: ReturnType<typeof render>; term: Terminal; stdin: any } {
  const term = new Terminal(rows, cols);
  const stdin = createStdin();
  const stdout: any = {
    columns: cols,
    rows,
    isTTY: true,
    write: (s: string) => {
      term.feed(s);
      return true;
    },
    on: () => {},
    off: () => {},
    emit: () => {},
    once: () => {},
    removeListener: () => {},
    setEncoding: () => {},
    getWindowSize: () => [cols, rows],
  };
  const instance = render(element, { stdout, stdin, exitOnCtrlC: false });
  return { instance, term, stdin };
}

export const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

export const waitFor = async (pred: () => boolean, timeoutMs = 5000): Promise<boolean> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setImmediate(r));
    await sleep(20);
    if (pred()) return true;
  }
  return pred();
};

/** Type text one character at a time (how a human types). */
export const typeKeys = async (stdin: any, chars: string, perKey = 40): Promise<void> => {
  for (const ch of chars) {
    stdin.push(Buffer.from(ch, 'utf8'));
    await new Promise((r) => setImmediate(r));
    await sleep(perKey);
  }
};

/** Send a raw key sequence (escape codes, control chords). */
export const pressKey = async (stdin: any, bytes: string): Promise<void> => {
  stdin.push(Buffer.from(bytes, 'utf8'));
  await new Promise((r) => setImmediate(r));
  await sleep(80);
};

/** Push a chunk in one write — what a paste looks like to the app. */
export const paste = async (stdin: any, text: string): Promise<void> => {
  stdin.push(Buffer.from(text, 'utf8'));
  await new Promise((r) => setImmediate(r));
  await sleep(120);
};
