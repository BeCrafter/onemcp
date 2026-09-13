/**
 * TUI multi-line JSON text area
 *
 * A controlled editor for the raw-arguments JSON mode of ToolRunner.
 * Handles only editing keys (printable, backspace, Enter, arrows); control
 * chords (Ctrl+S / Ctrl+J / ...) are ignored here so the parent component
 * owns them exclusively.
 */

import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { isEditableChunk } from '../input-text.js';

export interface JsonTextAreaProps {
  value: string;
  onChange: (next: string) => void;
  /** Viewport height in lines. */
  height: number;
}

export const JsonTextArea: React.FC<JsonTextAreaProps> = ({ value, onChange, height }) => {
  const [cursor, setCursor] = useState(value.length);

  const lines = useMemo(() => value.split('\n'), [value]);

  /** Resolve a 0-based cursor offset to [lineIndex, columnIndex]. */
  const locate = (offset: number): { line: number; column: number } => {
    let remaining = Math.max(0, Math.min(offset, value.length));
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) {
        break;
      }
      if (remaining <= line.length) {
        return { line: i, column: remaining };
      }
      remaining -= line.length + 1;
    }
    return { line: Math.max(0, lines.length - 1), column: 0 };
  };

  const offsetOfLineStart = (lineIndex: number): number => {
    let offset = 0;
    for (let i = 0; i < lineIndex; i++) {
      offset += (lines[i]?.length ?? 0) + 1;
    }
    return offset;
  };

  const clampCursor = (next: number): number => Math.max(0, Math.min(next, value.length));

  useInput((input, key) => {
    if (key.ctrl || key.escape || key.tab) {
      return;
    }

    if (key.backspace || key.delete) {
      if (cursor === 0) {
        return;
      }
      onChange(value.slice(0, cursor - 1) + value.slice(cursor));
      setCursor(clampCursor(cursor - 1));
      return;
    }

    if (key.leftArrow) {
      setCursor((prev) => clampCursor(prev - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor((prev) => clampCursor(prev + 1));
      return;
    }
    if (key.upArrow || key.downArrow) {
      const pos = locate(cursor);
      const targetLine = key.upArrow
        ? Math.max(0, pos.line - 1)
        : Math.min(lines.length - 1, pos.line + 1);
      setCursor(
        clampCursor(
          offsetOfLineStart(targetLine) + Math.min(pos.column, lines[targetLine]?.length ?? 0)
        )
      );
      return;
    }

    if (key.return) {
      // Enter inserts a newline (Ctrl+J — a bare \n — is reserved for the
      // parent's mode toggle and never reaches this handler as an edit).
      onChange(value.slice(0, cursor) + '\n' + value.slice(cursor));
      setCursor(cursor + 1);
      return;
    }

    // Printable text: one keystroke, or a pasted chunk — which may legitimately
    // span several lines, so newlines are kept (only other control bytes are
    // dropped). Filtering on `length === 1` would silently discard a paste.
    if (input.length > 0) {
      const chunk = input.replace(/\r\n?/g, '\n');
      if (isEditableChunk(chunk)) {
        onChange(value.slice(0, cursor) + chunk + value.slice(cursor));
        setCursor(cursor + chunk.length);
      }
    }
  });

  // Cursor-following viewport: the window scrolls only once the cursor would
  // fall below the last visible line, so it never jumps while editing.
  const cursorPos = locate(cursor);
  const visibleHeight = Math.max(1, height);
  const maxStart = Math.max(0, lines.length - visibleHeight);
  const adjustedStart = Math.max(0, Math.min(cursorPos.line - (visibleHeight - 1), maxStart));

  const visibleLines = lines.slice(adjustedStart, adjustedStart + visibleHeight);

  return (
    <Box flexDirection="column">
      {visibleLines.map((line, i) => {
        const lineIndex = adjustedStart + i;
        if (lineIndex !== cursorPos.line) {
          return (
            <Text key={i} wrap="truncate">
              {line}
            </Text>
          );
        }
        const before = line.slice(0, cursorPos.column);
        const at = line.slice(cursorPos.column, cursorPos.column + 1);
        const after = line.slice(cursorPos.column + 1);
        return (
          <Box key={i}>
            <Text wrap="truncate">{before}</Text>
            <Text underline>{at === '' ? ' ' : at}</Text>
            <Text wrap="truncate">{after}</Text>
          </Box>
        );
      })}
      {lines.length > visibleHeight && (
        <Text dimColor>
          {adjustedStart > 0 ? '↑' : ' '}
          {adjustedStart + visibleHeight < lines.length
            ? `↓ ${lines.length - adjustedStart - visibleHeight} more`
            : ''}
        </Text>
      )}
    </Box>
  );
};
