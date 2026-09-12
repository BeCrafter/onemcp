/**
 * Stringify helpers for values of unknown shape (backend payloads, error data).
 *
 * `JSON.stringify` throws on circular structures and returns `undefined` for
 * functions/symbols, so call sites that log or display such values need a
 * total function instead of ad-hoc try/catch copies.
 */

/** JSON.stringify that never throws and never yields `undefined`. */
export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
