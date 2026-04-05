import { useState, useRef, useEffect, useMemo } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useUIModeStore } from '../../stores/uiModeStore';
import { EASING, DURATION, getDuration, prefersReducedMotion } from '../../lib/animations';

export interface Command {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  commands: Command[];
  onClose: () => void;
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    return commands.filter((c) =>
      fuzzyMatch(query, c.label) || fuzzyMatch(query, c.category)
    );
  }, [query, commands]);

  useEffect(() => { setSelectedIdx(0); }, [query]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIdx] as HTMLElement;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIdx]) {
        filtered[selectedIdx].action();
        onClose();
      }
    }
  };

  const categoryColors: Record<string, string> = {
    File: '#98C379',
    Edit: '#D19A66',
    View: '#48CAE4',
    Run: '#00B4D8',
    Dirac: '#7B2D8E',
    Circuit: '#E06C75',
    Learn: '#10B981',
    Settings: '#6A737D',
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(12px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '15vh',
        animation: prefersReducedMotion() ? 'none' : `nuclei-fade-in ${DURATION.fast}ms`,
      }}
      onClick={onClose}
      role="dialog"
      aria-label="Command palette"
      aria-modal="true"
    >
      <div
        style={{
          background: colors.bg,
          border: `1px solid ${colors.border}`,
          borderRadius: 12,
          width: '100%', maxWidth: 520, maxHeight: '50vh',
          overflow: 'hidden',
          boxShadow: shadow.lg,
          animation: prefersReducedMotion() ? 'none' : `nuclei-slide-down ${DURATION.normal}ms ${EASING.spring}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${colors.border}` }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            style={{
              width: '100%', background: 'transparent',
              border: 'none', outline: 'none',
              color: colors.text, fontSize: 15,
              fontFamily: "'Geist Sans', Inter, sans-serif",
            }}
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-list"
          />
        </div>

        {/* Results */}
        <div ref={listRef} id="command-list" style={{ maxHeight: '40vh', overflow: 'auto', padding: '4px 0' }} role="listbox">
          {filtered.length === 0 ? (
            <div style={{ padding: 16, color: colors.textMuted, fontSize: 13, fontFamily: "'Geist Sans', sans-serif", textAlign: 'center' }}>
              No matching commands
            </div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                onClick={() => { cmd.action(); onClose(); }}
                style={{
                  display: 'flex', alignItems: 'center',
                  width: '100%', padding: '8px 16px',
                  background: i === selectedIdx ? colors.border : 'transparent',
                  border: 'none', cursor: 'pointer',
                  color: colors.text, fontSize: 13,
                  fontFamily: "'Geist Sans', Inter, sans-serif",
                  textAlign: 'left', gap: 10,
                  transition: `background ${getDuration(DURATION.instant)}ms`,
                }}
                role="option"
                aria-selected={i === selectedIdx}
              >
                <span style={{
                  fontSize: 10, fontWeight: 600,
                  color: categoryColors[cmd.category] ?? colors.textMuted,
                  minWidth: 48, fontFamily: "'Geist Sans', sans-serif",
                }}>
                  {cmd.category}
                </span>
                <span style={{ flex: 1 }}>{cmd.label}</span>
                {cmd.shortcut && (
                  <kbd style={{
                    fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                    color: colors.textMuted, background: colors.bgPanel,
                    padding: '1px 6px', borderRadius: 3,
                    border: `1px solid ${colors.border}`,
                  }}>
                    {cmd.shortcut}
                  </kbd>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** Build the full command list for Nuclei */
export function buildCommands(actions: {
  run: () => void;
  openFile: () => void;
  saveFile: () => void;
  newFile: () => void;
  toggleTheme: () => void;
  toggleDirac: () => void;
  cycleMode: () => void;
  toggleShortcuts: () => void;
}): Command[] {
  return [
    // Run
    { id: 'run', label: 'Run Circuit', category: 'Run', shortcut: '⌘+Enter', action: actions.run },
    // File
    { id: 'open', label: 'Open File', category: 'File', shortcut: '⌘+O', action: actions.openFile },
    { id: 'save', label: 'Save File', category: 'File', shortcut: '⌘+S', action: actions.saveFile },
    { id: 'new', label: 'New File', category: 'File', shortcut: '⌘+N', action: actions.newFile },
    // View
    { id: 'theme', label: 'Toggle Theme', category: 'View', shortcut: '⌘+Shift+T', action: actions.toggleTheme },
    { id: 'mode', label: 'Cycle UI Mode (Beginner/Intermediate/Advanced)', category: 'View', shortcut: '⌘+Shift+L', action: actions.cycleMode },
    // Dirac
    { id: 'dirac', label: 'Toggle Dirac Panel', category: 'Dirac', shortcut: '⌘+D', action: actions.toggleDirac },
    { id: 'dirac-focus', label: 'Focus Dirac Input', category: 'Dirac', shortcut: '⌘+L', action: actions.toggleDirac },
    // Circuit
    { id: 'step-through', label: 'Step Through Circuit', category: 'Circuit', action: () => {
      import('../../stores/circuitStore').then(({ useCircuitStore }) => {
        useCircuitStore.getState().setStepMode(true);
      });
    }},
    { id: 'reset-step', label: 'Reset Step-Through', category: 'Circuit', action: () => {
      import('../../stores/circuitStore').then(({ useCircuitStore }) => {
        useCircuitStore.getState().setStepMode(false);
      });
    }},
    // Learn
    { id: 'exercise', label: 'Start Exercise (via Dirac)', category: 'Learn', action: actions.toggleDirac },
    // Settings
    { id: 'shortcuts', label: 'Keyboard Shortcuts', category: 'Settings', shortcut: '⌘+/', action: actions.toggleShortcuts },
  ];
}
