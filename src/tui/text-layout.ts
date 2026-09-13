/**
 * Display-width-aware text layout primitives.
 *
 * Terminal cells do not map 1:1 to UTF-16 code units — CJK characters occupy
 * two cells — so every width computation in the TUI panel goes through these
 * helpers instead of String.length.
 */

import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';

/** Visible cell width of a string (CJK counts as 2, ANSI codes as 0). */
export function displayWidth(s: string): number {
  return stringWidth(s);
}

/** Right-pad with spaces until the string occupies exactly `width` cells. */
export function padDisplay(s: string, width: number): string {
  const missing = Math.max(0, width - displayWidth(s));
  return s + ' '.repeat(missing);
}

/** Truncate to at most `width` cells, appending … when something was cut. */
export function truncateDisplay(s: string, width: number): string {
  if (displayWidth(s) <= width) {
    return s;
  }
  const budget = Math.max(1, width - 1);
  let out = '';
  for (const char of s) {
    const next = out + char;
    if (displayWidth(next) > budget) {
      break;
    }
    out = next;
  }
  return out + '…';
}

const MIN_WRAP_WIDTH = 4;
const MAX_HANGING_INDENT = 8;

/**
 * Word/hard wrap at `width` display cells, PRESERVING each logical line's
 * leading indentation as a hanging indent on continuation lines.
 *
 * wrap-ansi handles the CJK-aware breaking; it deliberately does NOT add
 * hanging indents and mangles very narrow widths, so this wrapper:
 *  - expands tabs to spaces (wrap-ansi passes them through unpredictably),
 *  - clamps the width (width < one CJK char makes wrap-ansi emit a stray
 *    leading empty line),
 *  - re-prefixes continuation lines with the source indent,
 *  - maps an empty input line to [''] so callers never lose a row.
 */
export function wrapDisplay(text: string, width: number): string[] {
  const effectiveWidth = Math.max(MIN_WRAP_WIDTH, width);
  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    if (rawLine === '') {
      lines.push('');
      continue;
    }
    const expanded = rawLine.replace(/\t/g, '  ');
    const indentMatch = /^ */.exec(expanded);
    const indent = (indentMatch?.[0] ?? '').slice(
      0,
      Math.min(
        expanded.length - expanded.trimStart().length,
        MAX_HANGING_INDENT,
        Math.max(0, effectiveWidth - MIN_WRAP_WIDTH)
      )
    );
    const body = expanded.slice(indent.length);
    const wrapped = wrapAnsi(body, Math.max(MIN_WRAP_WIDTH, effectiveWidth - indent.length), {
      hard: true,
      trim: false,
      wordWrap: true,
    });
    const pieces = wrapped.split('\n');
    if (pieces.length === 1 && pieces[0] === '') {
      lines.push('');
      continue;
    }
    for (const piece of pieces) {
      if (piece === '') {
        continue; // wrap-ansi can emit stray empty lines at extreme widths
      }
      lines.push(indent + piece);
    }
  }
  return lines.length > 0 ? lines : [''];
}

/** The top edge of a hand-drawn box, with the title embedded after the corner. */
export function boxTop(title: string, innerWidth: number): string {
  const inner = Math.max(0, innerWidth);
  const fitted = truncateDisplay(title, inner);
  const fill = Math.max(0, inner - displayWidth(fitted));
  return `╭${fitted}${'─'.repeat(fill)}╮`;
}

/** The bottom edge of a hand-drawn box, with an optional right-aligned hint. */
export function boxBottom(hint: string, innerWidth: number): string {
  const inner = Math.max(0, innerWidth);
  const fitted = truncateDisplay(hint, inner);
  const fill = Math.max(0, inner - displayWidth(fitted));
  return `╰${'─'.repeat(fill)}${fitted}╯`;
}

/** One content row of a hand-drawn box, padded to the inner width. */
export function boxRow(content: string, innerWidth: number): string {
  const inner = Math.max(0, innerWidth);
  return `│${padDisplay(truncateDisplay(content, inner), inner)}│`;
}

/** Focus bar glyph for section headers; always ONE cell so row math is stable. */
export const SECTION_BAR = '▌';

/**
 * A section header row: accent bar + uppercased label + a rule filling the rest
 * of `width`. The bar glyph is identical whether or not the section is focused —
 * focus shows up through the bar's COLOR, which the caller applies to the first
 * `SECTION_BAR.length` cells (the test harness discards SGR, so color cannot be
 * asserted; callers keep the glyph constant on purpose).
 */
export function sectionTitle(label: string, width: number): string {
  const safeWidth = Math.max(0, width);
  const bar = SECTION_BAR;
  // Too narrow for `bar + ' ' + label + ' '` — degrade to the bare focus bar.
  if (safeWidth <= 0) {
    return '';
  }
  if (safeWidth < 4) {
    return bar;
  }
  const maxLabel = Math.max(0, safeWidth - displayWidth(bar) - 2);
  const text = truncateDisplay(label.toUpperCase(), maxLabel);
  if (text === '') {
    return bar;
  }
  const fill = Math.max(0, safeWidth - displayWidth(bar) - 1 - displayWidth(text) - 1);
  return `${bar} ${text} ${'─'.repeat(fill)}`;
}
