import { describe, it, expect, vi } from 'vitest';
import { buildCommands } from './CommandPalette';

function noop() {}

describe('buildCommands', () => {
  it('includes a "Switch workspace mode" action wired to switchWorkspaceMode', () => {
    const switchWorkspaceMode = vi.fn();
    const commands = buildCommands({
      run: noop,
      openFile: noop,
      saveFile: noop,
      newFile: noop,
      toggleTheme: noop,
      toggleDirac: noop,
      cycleMode: noop,
      toggleShortcuts: noop,
      switchWorkspaceMode,
    });

    const command = commands.find((c) => /switch workspace mode/i.test(c.label));
    expect(command).toBeDefined();

    command?.action();
    expect(switchWorkspaceMode).toHaveBeenCalledTimes(1);
  });
});
