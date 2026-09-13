/**
 * Input-chunk classification for the TUI editors.
 *
 * Ink delivers a paste as ONE multi-character `input` string and a keystroke as
 * a one-character string — they are indistinguishable except by length. Editors
 * therefore have to accept chunks of any length; filtering on `length === 1`
 * silently discards everything a user pastes.
 */

/** True when every code point is printable text (no control bytes at all). */
export function isPrintableChunk(text: string): boolean {
  if (text.length === 0) {
    return false;
  }
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }
  return true;
}

/** True when the chunk is editable text; newlines are text (multi-line paste). */
export function isEditableChunk(text: string): boolean {
  if (text.length === 0) {
    return false;
  }
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code !== 0x0a && (code < 0x20 || code === 0x7f)) {
      return false;
    }
  }
  return true;
}
