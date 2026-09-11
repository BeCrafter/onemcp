/**
 * TUI single-line controlled text input
 *
 * Used by the ServiceTools detail panel for scalar parameters. Unlike
 * ink-text-input, this component explicitly ignores control chords
 * (Ctrl+R/J/O/P), Tab, and Enter, so control characters can never be inserted
 * into the field value — the parent component owns those keys exclusively
 * (its useInput fires after this child's, which is safe because nothing is
 * inserted here for chords).
 *
 * Renders at most ONE terminal row: when `width` is given, the value is shown
 * through a cursor-following window and overlong segments are truncated.
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface SingleLineInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** Render width; the value is windowed to fit one terminal row. */
  width?: number;
}

export const SingleLineInput: React.FC<SingleLineInputProps> = ({
  value,
  onChange,
  placeholder,
  width,
}) => {
  const [cursor, setCursor] = useState(value.length);
  const clampedCursor = Math.min(cursor, value.length);

  useInput((input, key) => {
    if (key.ctrl || key.escape || key.tab || key.return || key.upArrow || key.downArrow) {
      return;
    }

    if (key.leftArrow) {
      setCursor((prev) => Math.max(0, Math.min(prev, value.length) - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor((prev) => Math.min(value.length, Math.min(prev, value.length) + 1));
      return;
    }
    if (key.backspace || key.delete) {
      if (clampedCursor > 0) {
        onChange(value.slice(0, clampedCursor - 1) + value.slice(clampedCursor));
        setCursor(clampedCursor - 1);
      }
      return;
    }

    // Printable character
    if (input && input.length === 1 && input >= ' ' && input !== '\n') {
      onChange(value.slice(0, clampedCursor) + input + value.slice(clampedCursor));
      setCursor(clampedCursor + input.length);
    }
  });

  const showPlaceholder = value === '' && placeholder !== undefined && placeholder !== '';

  // Cursor-following window so the input always occupies exactly one row.
  const windowed =
    width === undefined
      ? null
      : (() => {
          const w = Math.max(4, width);
          const winStart = Math.max(0, Math.min(clampedCursor - (w - 2), value.length));
          return {
            start: winStart,
            before: value.slice(winStart, clampedCursor),
            at: value.slice(clampedCursor, clampedCursor + 1),
            after: value.slice(clampedCursor + 1, winStart + w - 1),
            clippedLeft: winStart > 0,
            clippedRight: winStart + w - 1 < value.length,
          };
        })();

  return (
    <Box {...(width !== undefined ? { width: Math.max(4, width) } : {})}>
      {showPlaceholder ? (
        <>
          <Text wrap="truncate" color="gray">
            {placeholder}
          </Text>
          <Text underline> </Text>
        </>
      ) : windowed !== null ? (
        <>
          {windowed.clippedLeft && <Text>{'…'}</Text>}
          <Text wrap="truncate">{windowed.before}</Text>
          <Text underline>{windowed.at === '' ? ' ' : windowed.at}</Text>
          <Text wrap="truncate">{windowed.after}</Text>
          {windowed.clippedRight && <Text>{'…'}</Text>}
        </>
      ) : (
        <>
          <Text>{value.slice(0, clampedCursor)}</Text>
          <Text underline>
            {value.slice(clampedCursor, clampedCursor + 1) === ''
              ? ' '
              : value.slice(clampedCursor, clampedCursor + 1)}
          </Text>
          <Text>{value.slice(clampedCursor + 1)}</Text>
        </>
      )}
    </Box>
  );
};
