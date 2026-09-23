/**
 * TUI single-row inline radio selector.
 *
 * Deliberately PRESENTATIONAL: it registers no `useInput`, the form owns every
 * key. The previous dropdown (ink-select-input) registered its own handler, and
 * ink runs ALL active handlers on the same keystroke — the form's ↑/↓ moved the
 * focus off the field while the select's handler moved a highlight that was
 * unmounted along with the component, so the transport/enabled value could never
 * be changed from the keyboard (it also left an undocumented 1-9 shortcut as the
 * only way to switch).
 *
 * With the options rendered inline the keystroke semantics stay unambiguous:
 * ↑/↓ always navigate fields, ←/→ always change the focused field's value.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { displayWidth, truncateDisplay } from '../text-layout.js';

export interface InlineSelectOption {
  label: string;
  value: string;
}

/** Cells an option spends on its radio glyph and trailing space: `(•) `. */
const OPTION_CHROME = 4;
const OPTION_SEPARATOR = '  ';
const ELLIPSIS = ' …';

export interface InlineSelectLayout {
  /** How many leading options fit in the width (at least 1). */
  count: number;
  /** True when options had to be dropped. */
  truncated: boolean;
}

/**
 * How many options fit on one row of `width` cells.
 *
 * Kept pure so the row-height guarantee can be tested without a terminal: the
 * form's frame math assumes this row never wraps, which only holds if the
 * caller renders at most `count` options (plus the ellipsis when truncated).
 */
export function inlineSelectLayout(labels: readonly string[], width: number): InlineSelectLayout {
  if (labels.length === 0) {
    return { count: 0, truncated: false };
  }

  let used = 0;
  let count = 0;
  for (const label of labels) {
    const need =
      (count === 0 ? 0 : displayWidth(OPTION_SEPARATOR)) + OPTION_CHROME + displayWidth(label);
    if (used + need > width) {
      break;
    }
    used += need;
    count += 1;
  }

  if (count === 0) {
    return { count: 1, truncated: labels.length > 1 };
  }
  if (count === labels.length) {
    return { count, truncated: false };
  }

  // Room for the ellipsis comes out of the options, so the row cannot overflow.
  let fitted = count;
  while (fitted > 1 && used + displayWidth(ELLIPSIS) > width) {
    fitted -= 1;
    used -= OPTION_CHROME + displayWidth(labels[fitted] ?? '') + displayWidth(OPTION_SEPARATOR);
  }
  return { count: fitted, truncated: true };
}

export interface InlineSelectProps {
  options: readonly InlineSelectOption[];
  value: string;
  /** Drawn in the focus colour; the form only focuses one field at a time. */
  focused: boolean;
  /** Render width in cells — the row is clipped to it. */
  width: number;
}

export const InlineSelect: React.FC<InlineSelectProps> = ({ options, value, focused, width }) => {
  const { count, truncated } = inlineSelectLayout(
    options.map((option) => option.label),
    width
  );
  const visible = options.slice(0, count);
  const selectedColor = focused ? 'cyan' : 'white';

  return (
    <Box width={Math.max(4, width)}>
      <Text wrap="truncate">
        {visible.map((option, index) => {
          const selected = option.value === value;
          const color = selected ? selectedColor : 'gray';
          const label = selected
            ? option.label
            : truncateDisplay(option.label, Math.max(1, width - OPTION_CHROME));
          return (
            <Text key={option.value}>
              {index > 0 ? OPTION_SEPARATOR : ''}
              <Text color={color}>{selected ? '(•)' : '( )'}</Text>
              <Text bold={selected} color={color}>
                {' '}
                {label}
              </Text>
            </Text>
          );
        })}
        {truncated && <Text color="gray">{ELLIPSIS}</Text>}
      </Text>
    </Box>
  );
};
