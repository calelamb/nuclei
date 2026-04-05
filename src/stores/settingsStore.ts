import { create } from 'zustand';
import type { Framework } from '../types/quantum';

/* ── Editor Settings ─────────────────────────────────── */
export interface EditorSettings {
  fontSize: number;          // 10–24, default 14
  tabSize: number;           // 2 | 4
  wordWrap: boolean;
  minimap: boolean;
  lineNumbers: boolean;
  bracketPairColorization: boolean;
  autoCloseBrackets: boolean;
}

/* ── Dirac AI Settings ───────────────────────────────── */
export interface DiracSettings {
  ghostCompletions: boolean;      // inline ghost suggestions
  autoExplainErrors: boolean;     // Dirac auto-explains on error
  extendedThinking: boolean;      // allow /think mode
  preferredModel: 'auto' | 'haiku' | 'sonnet';
  contextDepth: 'minimal' | 'standard' | 'full'; // how much context to inject
}

/* ── Kernel Settings ─────────────────────────────────── */
export interface KernelSettings {
  defaultFramework: Framework;
  defaultShots: number;           // 100–100000
  autoParseOnType: boolean;       // live circuit parsing as you type
  parseDebounceMs: number;        // 100–1000
}

/* ── General Settings ────────────────────────────────── */
export interface GeneralSettings {
  animationsEnabled: boolean;
  showWelcomeOnStart: boolean;
  autoSave: boolean;
  language: 'en' | 'es' | 'zh' | 'ja';
  telemetryEnabled: boolean;
  educatorMode: boolean;
}

/* ── Combined ────────────────────────────────────────── */
export interface SettingsState {
  editor: EditorSettings;
  dirac: DiracSettings;
  kernel: KernelSettings;
  general: GeneralSettings;

  updateEditor: (patch: Partial<EditorSettings>) => void;
  updateDirac: (patch: Partial<DiracSettings>) => void;
  updateKernel: (patch: Partial<KernelSettings>) => void;
  updateGeneral: (patch: Partial<GeneralSettings>) => void;
  resetAll: () => void;
}

const DEFAULT_EDITOR: EditorSettings = {
  fontSize: 14,
  tabSize: 2,
  wordWrap: false,
  minimap: false,
  lineNumbers: true,
  bracketPairColorization: true,
  autoCloseBrackets: true,
};

const DEFAULT_DIRAC: DiracSettings = {
  ghostCompletions: true,
  autoExplainErrors: true,
  extendedThinking: true,
  preferredModel: 'auto',
  contextDepth: 'standard',
};

const DEFAULT_KERNEL: KernelSettings = {
  defaultFramework: 'qiskit',
  defaultShots: 1024,
  autoParseOnType: true,
  parseDebounceMs: 300,
};

const DEFAULT_GENERAL: GeneralSettings = {
  animationsEnabled: true,
  showWelcomeOnStart: true,
  autoSave: true,
  language: 'en',
  telemetryEnabled: false,
  educatorMode: false,
};

/** Try to hydrate settings from localStorage */
function loadPersistedSettings(): Partial<SettingsState> {
  try {
    const raw = localStorage.getItem('nuclei-settings');
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function persistSettings(state: Pick<SettingsState, 'editor' | 'dirac' | 'kernel' | 'general'>) {
  try {
    localStorage.setItem('nuclei-settings', JSON.stringify({
      editor: state.editor,
      dirac: state.dirac,
      kernel: state.kernel,
      general: state.general,
    }));
  } catch { /* silently fail in restricted environments */ }
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const persisted = loadPersistedSettings();

  return {
    editor: { ...DEFAULT_EDITOR, ...(persisted.editor ?? {}) },
    dirac: { ...DEFAULT_DIRAC, ...(persisted.dirac ?? {}) },
    kernel: { ...DEFAULT_KERNEL, ...(persisted.kernel ?? {}) },
    general: { ...DEFAULT_GENERAL, ...(persisted.general ?? {}) },

    updateEditor: (patch) => {
      set((s) => ({ editor: { ...s.editor, ...patch } }));
      persistSettings(get());
    },
    updateDirac: (patch) => {
      set((s) => ({ dirac: { ...s.dirac, ...patch } }));
      persistSettings(get());
    },
    updateKernel: (patch) => {
      set((s) => ({ kernel: { ...s.kernel, ...patch } }));
      persistSettings(get());
    },
    updateGeneral: (patch) => {
      set((s) => ({ general: { ...s.general, ...patch } }));
      persistSettings(get());
    },
    resetAll: () => {
      set({
        editor: DEFAULT_EDITOR,
        dirac: DEFAULT_DIRAC,
        kernel: DEFAULT_KERNEL,
        general: DEFAULT_GENERAL,
      });
      localStorage.removeItem('nuclei-settings');
    },
  };
});
