/**
 * Terminal size that stays current.
 *
 * ink subscribes to `stdout`'s `resize` event itself, but what it does there is
 * re-run the yoga layout of the EXISTING element tree and repaint — it does not
 * re-execute the React components. A component that reads `useStdout().columns`
 * during render therefore keeps laying out with the size it saw at mount: the
 * frame re-wraps to the new width while every explicitly laid-out cell (the
 * form's label/value columns, the list's dropped columns) stays stale, until
 * some unrelated state change — a keystroke moving the focus — happens to
 * re-render it.
 *
 * Reading the size through this hook turns the resize into a normal React
 * update, so width-driven layouts reflow the moment the window changes.
 */

import { useEffect, useState } from 'react';
import { useStdout } from 'ink';

export interface TerminalSize {
  columns: number;
  rows: number;
}

const FALLBACK: TerminalSize = { columns: 80, rows: 24 };

export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();
  const [size, setSize] = useState<TerminalSize>(() => ({
    columns: stdout?.columns || FALLBACK.columns,
    rows: stdout?.rows || FALLBACK.rows,
  }));

  useEffect(() => {
    if (stdout === undefined) {
      return undefined;
    }
    const sync = (): void => {
      const next: TerminalSize = {
        columns: stdout.columns || FALLBACK.columns,
        rows: stdout.rows || FALLBACK.rows,
      };
      // Same reference when nothing moved, so mounting does not cost a render.
      setSize((prev) => (prev.columns === next.columns && prev.rows === next.rows ? prev : next));
    };
    // The window may have changed between the first render and this effect.
    sync();
    stdout.on('resize', sync);
    return () => {
      stdout.off('resize', sync);
    };
  }, [stdout]);

  return size;
}
