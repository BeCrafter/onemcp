import { describe, expect, it } from 'vitest';

import {
  boxBottom,
  boxRow,
  boxTop,
  displayWidth,
  padDisplay,
  SECTION_BAR,
  sectionTitle,
  truncateDisplay,
  wrapDisplay,
} from '../../../src/tui/text-layout.js';

describe('displayWidth', () => {
  it('counts CJK as two cells and ASCII as one', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('批次')).toBe(4);
    expect(displayWidth('批次ID列表')).toBe(10);
    expect(displayWidth('batch_ids 数组')).toBe(14);
  });
});

describe('truncateDisplay', () => {
  it('returns the string unchanged when it fits', () => {
    expect(truncateDisplay('abc', 5)).toBe('abc');
    expect(truncateDisplay('批次', 4)).toBe('批次');
  });

  it('appends … and never exceeds the width', () => {
    const out = truncateDisplay('批次ID列表', 6);
    expect(displayWidth(out)).toBeLessThanOrEqual(6);
    expect(out.endsWith('…')).toBe(true);
  });

  it('never cuts a double-width character in half', () => {
    const out = truncateDisplay('a批次列表很长', 5);
    expect(displayWidth(out)).toBeLessThanOrEqual(5);
  });

  it('handles widths smaller than one CJK char', () => {
    expect(truncateDisplay('批次', 1)).toBe('…');
  });
});

describe('padDisplay', () => {
  it('pads to the display width', () => {
    expect(displayWidth(padDisplay('ab', 5))).toBe(5);
    expect(displayWidth(padDisplay('批次', 6))).toBe(6);
  });

  it('never produces negative repeat counts', () => {
    expect(padDisplay('批次列表超宽了', 2)).toBe('批次列表超宽了');
  });
});

describe('wrapDisplay', () => {
  it('preserves JSON indentation and hangs continuation lines', () => {
    const json = JSON.stringify({ a: 1, b: { c: [1, 2, 3] } }, null, 2);
    const lines = wrapDisplay(json, 12);
    // Every logical line that was indented keeps its indent on continuations.
    for (const line of lines) {
      expect(displayWidth(line)).toBeLessThanOrEqual(12);
    }
    expect(lines).toContain('  "a": 1,');
    // The nested object's inner lines stay indented (not flattened to col 0).
    expect(lines.some((l) => l.startsWith('    "c"'))).toBe(true);
  });

  it('wraps CJK by display width', () => {
    const lines = wrapDisplay('批次ID列表,若传没有的批次ID则自动忽略,最多100个', 10);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(displayWidth(line)).toBeLessThanOrEqual(10);
    }
  });

  it('keeps a leading indent on wrapped CJK continuations', () => {
    const lines = wrapDisplay('  批次ID列表,若传没有的批次ID则自动忽略', 12);
    expect(lines[0]?.startsWith('  ')).toBe(true);
    expect(lines[1]?.startsWith('  ')).toBe(true);
    for (const line of lines) {
      expect(displayWidth(line)).toBeLessThanOrEqual(12);
    }
  });

  it('maps empty input to a single empty line', () => {
    expect(wrapDisplay('', 10)).toEqual(['']);
    expect(wrapDisplay('a\n\nb', 10)).toEqual(['a', '', 'b']);
  });

  it('does not loop or drop rows at extremely narrow widths', () => {
    const lines = wrapDisplay('批次内容', 1); // clamped to MIN_WRAP_WIDTH
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(displayWidth(line)).toBeLessThanOrEqual(4);
    }
    expect(wrapDisplay('ab\tcd', 8)).toEqual(['ab  cd']);
  });
});

describe('box helpers', () => {
  it('draws a top edge with an embedded title at exactly the panel width', () => {
    const row = boxTop(' Result: ✓ 312ms ', 30);
    expect(displayWidth(row)).toBe(32); // 2 corners + inner
    expect(row.startsWith('╭')).toBe(true);
    expect(row.endsWith('╮')).toBe(true);
    expect(row).toContain('Result: ✓ 312ms');
  });

  it('draws a bottom edge with a right-aligned hint', () => {
    const row = boxBottom('↓ 12 more', 30);
    expect(displayWidth(row)).toBe(32);
    expect(row.startsWith('╰')).toBe(true);
    expect(row.endsWith('╯')).toBe(true);
    expect(row.trimEnd().endsWith('↓ 12 more╯')).toBe(true);
  });

  it('pads content rows to the inner width', () => {
    const row = boxRow('  "total": 1,', 30);
    expect(displayWidth(row)).toBe(32);
    expect(row.startsWith('│')).toBe(true);
    expect(row.endsWith('│')).toBe(true);
  });

  it('truncates oversized titles and CJK content safely', () => {
    const top = boxTop(' Result: ✗ 一个非常非常长的错误信息标题 ', 20);
    expect(displayWidth(top)).toBe(22);
    const row = boxRow('  中文内容也很长很长很长', 20);
    expect(displayWidth(row)).toBe(22);
  });
});

describe('sectionTitle', () => {
  it('renders a bar, uppercased label and a rule filling the width', () => {
    const row = sectionTitle('Description', 40);
    expect(displayWidth(row)).toBe(40);
    expect(row.startsWith('▌ DESCRIPTION ')).toBe(true);
    expect(row.endsWith('─')).toBe(true);
    expect(row).toContain('DESCRIPTION');
  });

  it('always leads with the same single-cell bar (focus is a color cue)', () => {
    expect(SECTION_BAR).toBe('▌');
    expect(displayWidth(SECTION_BAR)).toBe(1);
    expect(sectionTitle('Result', 20).startsWith(SECTION_BAR)).toBe(true);
    // Degenerate widths fall back to the bare bar.
    expect(sectionTitle('Description', 1)).toBe(SECTION_BAR);
    expect(sectionTitle('Description', 0)).toBe('');
  });

  it('never exceeds the width for long labels, CJK or tiny terminals', () => {
    expect(displayWidth(sectionTitle('Parameters', 12))).toBeLessThanOrEqual(12);
    expect(displayWidth(sectionTitle('参数区块标题很长很长', 20))).toBeLessThanOrEqual(20);
    expect(displayWidth(sectionTitle('Description', 1))).toBeLessThanOrEqual(1);
  });
});
