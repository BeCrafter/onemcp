import { describe, expect, it } from 'vitest';

import { clipboardCommands } from '../../../src/tui/clipboard.js';

describe('clipboardCommands', () => {
  it('uses pbcopy on macOS and clip on Windows', () => {
    expect(clipboardCommands('darwin')).toEqual([{ command: 'pbcopy', args: [] }]);
    expect(clipboardCommands('win32')).toEqual([{ command: 'clip', args: [] }]);
  });

  it('prefers wl-copy over xclip on Linux', () => {
    const commands = clipboardCommands('linux');
    expect(commands.map((c) => c.command)).toEqual(['wl-copy', 'xclip']);
    expect(commands[1]?.args).toEqual(['-selection', 'clipboard']);
  });
});
