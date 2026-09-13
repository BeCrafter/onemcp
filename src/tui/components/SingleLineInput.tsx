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
import { isPrintableChunk } from '../input-text.js';
import { displayWidth } from '../text-layout.js';

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
    if (
      key.ctrl ||
      key.meta ||
      key.escape ||
      key.tab ||
      key.return ||
      key.upArrow ||
      key.downArrow
    ) {
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

    // Printable text: one keystroke, or a whole pasted/batched chunk. Ink
    // delivers a paste as a single multi-character `input`, so filtering on
    // `length === 1` would silently drop it.
    if (isPrintableChunk(input)) {
      onChange(value.slice(0, clampedCursor) + input + value.slice(clampedCursor));
      setCursor(clampedCursor + input.length);
    }
  });

  const showPlaceholder = value === '' && placeholder !== undefined && placeholder !== '';

  // Cursor-following window so the input always occupies exactly one row.
  //
  // Measured in display CELLS (a CJK character is 2), never in UTF-16 units:
  // slicing `value` by code units produced rows wider than the box for wide
  // characters (the cursor could also drift out of the visible window).
  const windowed =
    width === undefined
      ? null
      : (() => {
          const w = Math.max(4, width);
          const beforeRaw = value.slice(0, clampedCursor);
          const atRaw = value.slice(clampedCursor, clampedCursor + 1);
          const afterRaw = value.slice(clampedCursor + 1);
          // The cursor needs at least one cell; keep a little room for the two
          // clip indicators (the box truncates anyway, so being 1-2 cells
          // conservative is harmless, wrapping is not).
          let budget = Math.max(1, w - Math.max(1, displayWidth(atRaw)) - 2);

          let before = '';
          for (let i = beforeRaw.length - 1; i >= 0; i -= 1) {
            const ch = beforeRaw[i];
            if (ch === undefined) {
              break;
            }
            const cellWidth = displayWidth(ch);
            if (cellWidth > budget) {
              break;
            }
            budget -= cellWidth;
            before = ch + before;
          }
          const clippedLeft = before.length < beforeRaw.length;

          let after = '';
          for (const ch of afterRaw) {
            const cellWidth = displayWidth(ch);
            if (cellWidth > budget) {
              break;
            }
            budget -= cellWidth;
            after += ch;
          }

          return {
            before,
            at: atRaw,
            after,
            clippedLeft,
            clippedRight: after.length < afterRaw.length,
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
