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
  ghostCompletions: boolean;      // inline ghost suggestions (off by default for beginners)
  autoExplainErrors: boolean;     // auto-rewrite Python tracebacks into concept-level explanations
  narration: boolean;             // ambient one-liner narration after parse / run
  extendedThinking: boolean;      // auto-escalate reasoning-keyword chats to thinking; /think always works
  preferredModel: 'auto' | 'haiku' | 'sonnet'; // chat model; tool turns always run Sonnet
  contextDepth: 'minimal' | 'standard' | 'full'; // how much IDE context chat injects (see diracRouting.ts)
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
  experimentalFeatures: boolean;
}

/* ── Agent Hardware Autonomy Settings ───────────────────
 * Governs whether Dirac's agent runtime may submit jobs to real, paid
 * quantum hardware on its own. THIS MUST DEFAULT TO OFF — see
 * DEFAULT_AGENT_HARDWARE below and services/agent/policyFromSettings.ts,
 * which maps this group onto the runtime's AutonomyPolicy. */
export interface AgentHardwareSettings {
  autonomousHardwareEnabled: boolean; // master switch; OFF by default
  allowQpu: boolean;
  maxSpend: number;                   // per-run USD budget ceiling
  maxShots: number;
  providerAllowlist: string[];        // empty = no restriction
}

/* ── Combined ────────────────────────────────────────── */
export interface SettingsState {
  editor: EditorSettings;
  dirac: DiracSettings;
  kernel: KernelSettings;
  general: GeneralSettings;
  agentHardware: AgentHardwareSettings;

  updateEditor: (patch: Partial<EditorSettings>) => void;
  updateDirac: (patch: Partial<DiracSettings>) => void;
  updateKernel: (patch: Partial<KernelSettings>) => void;
  updateGeneral: (patch: Partial<GeneralSettings>) => void;
  updateAgentHardware: (patch: Partial<AgentHardwareSettings>) => void;
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
  ghostCompletions: false, // beginner default per AI-native design
  autoExplainErrors: true,
  narration: true,
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
  experimentalFeatures: false,
};

/** SAFE default: autonomous real-hardware submission is OFF. Do not change
 * this default — see policyFromSettings.ts and services/agent/policy.ts. */
const DEFAULT_AGENT_HARDWARE: AgentHardwareSettings = {
  autonomousHardwareEnabled: false,
  allowQpu: false,
  maxSpend: 0,
  maxShots: 4096,
  providerAllowlist: [],
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

function persistSettings(state: Pick<SettingsState, 'editor' | 'dirac' | 'kernel' | 'general' | 'agentHardware'>) {
  try {
    localStorage.setItem('nuclei-settings', JSON.stringify({
      editor: state.editor,
      dirac: state.dirac,
      kernel: state.kernel,
      general: state.general,
      agentHardware: state.agentHardware,
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
    // Always overlay onto the SAFE default so a corrupted/partial persisted
    // blob can never silently turn autonomous hardware submission on.
    agentHardware: { ...DEFAULT_AGENT_HARDWARE, ...(persisted.agentHardware ?? {}) },

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
    updateAgentHardware: (patch) => {
      set((s) => ({ agentHardware: { ...s.agentHardware, ...patch } }));
      persistSettings(get());
    },
    resetAll: () => {
      set({
        editor: DEFAULT_EDITOR,
        dirac: DEFAULT_DIRAC,
        kernel: DEFAULT_KERNEL,
        general: DEFAULT_GENERAL,
        agentHardware: DEFAULT_AGENT_HARDWARE,
      });
      localStorage.removeItem('nuclei-settings');
    },
  };
});
