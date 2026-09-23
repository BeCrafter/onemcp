/**
 * Unit tests for the unified form's inline radio layout.
 *
 * The form's row math assumes this row never wraps, so the guarantee under test
 * is "the returned option count always fits in `width` cells" — a wrapped row
 * would make the frame taller than the terminal, which corrupts every absolute
 * write after it.
 */

import { describe, it, expect } from 'vitest';
import { inlineSelectLayout } from '../../../src/tui/components/InlineSelect.js';
import { displayWidth } from '../../../src/tui/text-layout.js';

const TRANSPORT = ['stdio', 'sse', 'http'];
const ENABLED = ['On', 'Off'];

/** Cells the rendered row occupies: `(•) label` joined by two spaces. */
const rowWidth = (labels: readonly string[], count: number, truncated: boolean): number => {
  let width = 0;
  for (let i = 0; i < count; i += 1) {
    width += 4 + displayWidth(labels[i] ?? '');
    if (i > 0) {
      width += 2;
    }
  }
  return width + (truncated ? 2 : 0);
};

describe('inlineSelectLayout', () => {
  it('fits every option when there is room', () => {
    expect(inlineSelectLayout(TRANSPORT, 40)).toEqual({ count: 3, truncated: false });
    expect(inlineSelectLayout(ENABLED, 20)).toEqual({ count: 2, truncated: false });
  });

  it('never exceeds the width it was given', () => {
    // Below ~9 cells even a single `(•) stdio` cannot fit; the form's row box
    // clips those, so the layout invariant is asserted where it is meaningful.
    for (const width of [12, 16, 20, 24, 30, 40, 60, 94]) {
      const layout = inlineSelectLayout(TRANSPORT, width);
      expect(rowWidth(TRANSPORT, layout.count, layout.truncated)).toBeLessThanOrEqual(width);
    }
  });

  it('drops options from the right and reports the truncation', () => {
    const layout = inlineSelectLayout(TRANSPORT, 20);
    expect(layout.truncated).toBe(true);
    expect(layout.count).toBeLessThan(3);
    expect(layout.count).toBeGreaterThan(0);
  });

  it('always renders at least one option', () => {
    expect(inlineSelectLayout(TRANSPORT, 1).count).toBe(1);
    expect(inlineSelectLayout(ENABLED, 0).count).toBe(1);
  });

  it('handles an empty option list', () => {
    expect(inlineSelectLayout([], 40)).toEqual({ count: 0, truncated: false });
  });

  it('counts CJK labels in cells, not code units', () => {
    // '中文' occupies 4 cells; two code units would under-count by half.
    const labels = ['中文', 'abc'];
    const layout = inlineSelectLayout(labels, rowWidth(labels, 2, false));
    expect(layout).toEqual({ count: 2, truncated: false });
  });
});
