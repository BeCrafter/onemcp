/**
 * System clipboard integration.
 *
 * Terminals expose no clipboard API, so this shells out to the platform's
 * clipboard utility. It is only ever called from an explicit user keypress and
 * the text never leaves the machine — no network, no files.
 */

import { spawnSync } from 'node:child_process';

/** One clipboard utility invocation, in preference order. */
export interface ClipboardCommand {
  command: string;
  args: string[];
}

/**
 * Clipboard utilities to try, most-preferred first. Wayland's wl-copy is tried
 * before X11's xclip because Linux desktops are increasingly Wayland-only.
 */
export function clipboardCommands(
  platform: NodeJS.Platform = process.platform
): readonly ClipboardCommand[] {
  if (platform === 'darwin') {
    return [{ command: 'pbcopy', args: [] }];
  }
  if (platform === 'win32') {
    return [{ command: 'clip', args: [] }];
  }
  return [
    { command: 'wl-copy', args: [] },
    { command: 'xclip', args: ['-selection', 'clipboard'] },
  ];
}

/** Whether a spelling of text-to-copy is worth attempting at all. */
function isCopiable(text: string): boolean {
  return text.length > 0;
}

/**
 * Copy `text` to the system clipboard.
 *
 * Returns false when no clipboard utility is available or all of them fail, so
 * the caller can surface a notice instead of throwing inside the render loop.
 */
export function copyToClipboard(text: string): boolean {
  if (!isCopiable(text)) {
    return false;
  }
  for (const { command, args } of clipboardCommands()) {
    try {
      const result = spawnSync(command, args, { input: text, encoding: 'utf8' });
      if (result.status === 0) {
        return true;
      }
    } catch {
      // Utility missing or not executable — try the next candidate.
    }
  }
  return false;
}
