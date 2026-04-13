import { useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, RotateCcw, Sun, Moon, Eye, EyeOff, ExternalLink } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useUIModeStore, type UIMode } from '../../stores/uiModeStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useDiracStore } from '../../stores/diracStore';

/* ── Toggle Switch ──────────────────────────────────────── */

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const colors = useThemeStore((s) => s.colors);
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 32, height: 18, borderRadius: 9, padding: 2,
        border: 'none', cursor: 'pointer',
        background: value ? colors.accent : colors.borderStrong,
        display: 'flex', alignItems: 'center',
        justifyContent: value ? 'flex-end' : 'flex-start',
        transition: 'background 0.2s, justify-content 0.2s',
        flexShrink: 0,
      }}
    >
      <div style={{
        width: 14, height: 14, borderRadius: '50%',
        background: value ? '#fff' : colors.textDim,
        transition: 'background 0.2s',
      }} />
    </button>
  );
}

/* ── Shared Controls ────────────────────────────────────── */

function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  const colors = useThemeStore((s) => s.colors);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '6px 0', gap: 8,
    }}>
      <span style={{ fontSize: 12, color: colors.textMuted, fontFamily: "'Geist Sans', sans-serif", flex: 1 }}>
        {label}
      </span>
      {children}
    </div>
  );
}

function Select<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  const colors = useThemeStore((s) => s.colors);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      style={{
        background: colors.bgElevated, color: colors.text,
        border: `1px solid ${colors.border}`, borderRadius: 4,
        padding: '3px 6px', fontSize: 11, cursor: 'pointer',
        fontFamily: "'Geist Sans', sans-serif", outline: 'none',
      }}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function NumberStepper({ value, min, max, step, onChange }: {
  value: number; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  const colors = useThemeStore((s) => s.colors);
  const btnStyle: CSSProperties = {
    width: 20, height: 20, border: `1px solid ${colors.border}`,
    background: colors.bgElevated, color: colors.textMuted,
    borderRadius: 3, cursor: 'pointer', fontSize: 12,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: "'Geist Sans', sans-serif", padding: 0,
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <button style={btnStyle} onClick={() => onChange(Math.max(min, value - step))}>-</button>
      <span style={{ fontSize: 11, color: colors.text, minWidth: 28, textAlign: 'center', fontFamily: "'Geist Sans', sans-serif" }}>
        {value}
      </span>
      <button style={btnStyle} onClick={() => onChange(Math.min(max, value + step))}>+</button>
    </div>
  );
}

function Slider({ value, min, max, step, onChange, displayValue }: {
  value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; displayValue?: string;
}) {
  const colors = useThemeStore((s) => s.colors);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: 80, accentColor: colors.accent, cursor: 'pointer' }}
      />
      <span style={{ fontSize: 10, color: colors.textDim, minWidth: 32, textAlign: 'right', fontFamily: "'Geist Sans', sans-serif" }}>
        {displayValue ?? value}
      </span>
    </div>
  );
}

/* ── Collapsible Section ────────────────────────────────── */

function Section({ title, defaultOpen = false, children }: {
  title: string; defaultOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const colors = useThemeStore((s) => s.colors);
  const Icon = open ? ChevronDown : ChevronRight;

  return (
    <div style={{ borderBottom: `1px solid ${colors.border}` }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 12px', border: 'none', background: 'transparent',
          cursor: 'pointer', color: colors.textMuted,
        }}
      >
        <Icon size={12} />
        <span style={{
          fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: 0.5, fontFamily: "'Geist Sans', sans-serif",
        }}>
          {title}
        </span>
      </button>
      <div style={{
        overflow: 'hidden',
        maxHeight: open ? 600 : 0,
        transition: 'max-height 0.25s ease',
      }}>
        <div style={{ padding: '0 12px 10px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ── API Key Input ─────────────────────────────────────── */

function ApiKeyInput() {
  const colors = useThemeStore((s) => s.colors);
  const currentKey = useDiracStore((s) => s.apiKey);
  const [keyValue, setKeyValue] = useState(currentKey ?? '');
  const [visible, setVisible] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const validate = (key: string): string => {
    if (key.trim() === '') return '';
    if (!key.startsWith('sk-ant-')) return 'Key should start with "sk-ant-"';
    return '';
  };

  const handleSave = () => {
    const trimmed = keyValue.trim();
    const validationError = validate(trimmed);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    useDiracStore.getState().setApiKey(trimmed || null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleChange = (value: string) => {
    setKeyValue(value);
    setSaved(false);
    if (error) setError(validate(value.trim()));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center',
          background: colors.bgElevated,
          border: `1px solid ${error ? colors.error : colors.border}`,
          borderRadius: 4, overflow: 'hidden',
        }}>
          <input
            type={visible ? 'text' : 'password'}
            value={keyValue}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="sk-ant-..."
            style={{
              flex: 1, padding: '5px 8px', fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              background: 'transparent', border: 'none', outline: 'none',
              color: colors.text,
            }}
          />
          <button
            onClick={() => setVisible(!visible)}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: colors.textDim, padding: '2px 6px', display: 'flex',
              alignItems: 'center', flexShrink: 0,
            }}
            aria-label={visible ? 'Hide API key' : 'Show API key'}
          >
            {visible ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
        <button
          onClick={handleSave}
          style={{
            padding: '4px 10px', fontSize: 11, fontWeight: 500,
            fontFamily: "'Geist Sans', sans-serif",
            background: saved ? colors.success : colors.accent,
            color: '#fff', border: 'none', borderRadius: 4,
            cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
            transition: 'background 150ms ease',
          }}
        >
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>
      {error && (
        <span style={{ fontSize: 10, color: colors.error, fontFamily: "'Geist Sans', sans-serif" }}>
          {error}
        </span>
      )}
      <a
        href="https://console.anthropic.com/"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 10, color: colors.accent, textDecoration: 'none',
          fontFamily: "'Geist Sans', sans-serif",
        }}
      >
        Get an API key <ExternalLink size={9} />
      </a>
      <span style={{
        fontSize: 10, color: colors.textDim, lineHeight: 1.4,
        fontFamily: "'Geist Sans', sans-serif",
      }}>
        Your key is stored locally and never leaves your machine.
      </span>
    </div>
  );
}

/* ── Main Panel ─────────────────────────────────────────── */

export function SettingsPanel() {
  const colors = useThemeStore((s) => s.colors);
  const themeMode = useThemeStore((s) => s.mode);
  const setThemeMode = useThemeStore((s) => s.setMode);
  const uiMode = useUIModeStore((s) => s.mode);
  const setUIMode = useUIModeStore((s) => s.setMode);

  const editor = useSettingsStore((s) => s.editor);
  const dirac = useSettingsStore((s) => s.dirac);
  const kernel = useSettingsStore((s) => s.kernel);
  const general = useSettingsStore((s) => s.general);
  const updateEditor = useSettingsStore((s) => s.updateEditor);
  const updateDirac = useSettingsStore((s) => s.updateDirac);
  const updateKernel = useSettingsStore((s) => s.updateKernel);
  const updateGeneral = useSettingsStore((s) => s.updateGeneral);
  const resetAll = useSettingsStore((s) => s.resetAll);
  const setSimShots = useSimulationStore((s) => s.setShots);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* ── Appearance ── */}
        <Section title="Appearance" defaultOpen>
          <SettingRow label="Theme">
            <div style={{ display: 'flex', gap: 2 }}>
              {(['dark', 'light'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setThemeMode(m)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '3px 8px', border: `1px solid ${themeMode === m ? colors.accent : colors.border}`,
                    borderRadius: 4, cursor: 'pointer', fontSize: 11,
                    background: themeMode === m ? `${colors.accent}18` : 'transparent',
                    color: themeMode === m ? colors.accent : colors.textMuted,
                    fontFamily: "'Geist Sans', sans-serif",
                  }}
                >
                  {m === 'dark' ? <Moon size={11} /> : <Sun size={11} />}
                  {m[0].toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </SettingRow>
          <SettingRow label="UI Mode">
            <Select<UIMode>
              value={uiMode}
              options={[
                { value: 'beginner', label: 'Beginner' },
                { value: 'intermediate', label: 'Intermediate' },
                { value: 'advanced', label: 'Advanced' },
              ]}
              onChange={setUIMode}
            />
          </SettingRow>
        </Section>

        {/* ── Editor ── */}
        <Section title="Editor" defaultOpen>
          <SettingRow label="Font Size">
            <NumberStepper value={editor.fontSize} min={10} max={24} step={1}
              onChange={(v) => updateEditor({ fontSize: v })} />
          </SettingRow>
          <SettingRow label="Tab Size">
            <Select value={String(editor.tabSize) as '2' | '4'}
              options={[{ value: '2', label: '2' }, { value: '4', label: '4' }]}
              onChange={(v) => updateEditor({ tabSize: Number(v) })} />
          </SettingRow>
          <SettingRow label="Word Wrap">
            <Toggle value={editor.wordWrap} onChange={(v) => updateEditor({ wordWrap: v })} />
          </SettingRow>
          <SettingRow label="Minimap">
            <Toggle value={editor.minimap} onChange={(v) => updateEditor({ minimap: v })} />
          </SettingRow>
          <SettingRow label="Line Numbers">
            <Toggle value={editor.lineNumbers} onChange={(v) => updateEditor({ lineNumbers: v })} />
          </SettingRow>
          <SettingRow label="Bracket Colorization">
            <Toggle value={editor.bracketPairColorization}
              onChange={(v) => updateEditor({ bracketPairColorization: v })} />
          </SettingRow>
          <SettingRow label="Auto-Close Brackets">
            <Toggle value={editor.autoCloseBrackets}
              onChange={(v) => updateEditor({ autoCloseBrackets: v })} />
          </SettingRow>
        </Section>

        {/* ── Dirac AI ── */}
        <Section title="Dirac AI">
          <div style={{ marginBottom: 8 }}>
            <span style={{
              fontSize: 11, color: colors.textMuted,
              fontFamily: "'Geist Sans', sans-serif", display: 'block',
              marginBottom: 4,
            }}>
              API Key
            </span>
            <ApiKeyInput />
          </div>
          <SettingRow label="Ghost Completions">
            <Toggle value={dirac.ghostCompletions}
              onChange={(v) => updateDirac({ ghostCompletions: v })} />
          </SettingRow>
          <SettingRow label="Auto-Explain Errors">
            <Toggle value={dirac.autoExplainErrors}
              onChange={(v) => updateDirac({ autoExplainErrors: v })} />
          </SettingRow>
          <SettingRow label="Extended Thinking">
            <Toggle value={dirac.extendedThinking}
              onChange={(v) => updateDirac({ extendedThinking: v })} />
          </SettingRow>
          <SettingRow label="Preferred Model">
            <Select value={dirac.preferredModel}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'haiku', label: 'Haiku' },
                { value: 'sonnet', label: 'Sonnet' },
              ]}
              onChange={(v) => updateDirac({ preferredModel: v })} />
          </SettingRow>
          <SettingRow label="Context Depth">
            <Select value={dirac.contextDepth}
              options={[
                { value: 'minimal', label: 'Minimal' },
                { value: 'standard', label: 'Standard' },
                { value: 'full', label: 'Full' },
              ]}
              onChange={(v) => updateDirac({ contextDepth: v })} />
          </SettingRow>
        </Section>

        {/* ── Kernel ── */}
        <Section title="Kernel">
          <SettingRow label="Default Framework">
            <Select value={kernel.defaultFramework}
              options={[
                { value: 'qiskit', label: 'Qiskit' },
                { value: 'cirq', label: 'Cirq' },
                { value: 'cuda-q', label: 'CUDA-Q' },
              ]}
              onChange={(v) => updateKernel({ defaultFramework: v })} />
          </SettingRow>
          <SettingRow label="Default Shots">
            <NumberStepper value={kernel.defaultShots} min={100} max={100000} step={100}
              onChange={(v) => { updateKernel({ defaultShots: v }); setSimShots(v); }} />
          </SettingRow>
          <SettingRow label="Auto-Parse on Type">
            <Toggle value={kernel.autoParseOnType}
              onChange={(v) => updateKernel({ autoParseOnType: v })} />
          </SettingRow>
          <SettingRow label="Parse Debounce">
            <Slider value={kernel.parseDebounceMs} min={100} max={1000} step={50}
              onChange={(v) => updateKernel({ parseDebounceMs: v })}
              displayValue={`${kernel.parseDebounceMs}ms`} />
          </SettingRow>
        </Section>

        {/* ── General ── */}
        <Section title="General">
          <SettingRow label="Animations">
            <Toggle value={general.animationsEnabled}
              onChange={(v) => updateGeneral({ animationsEnabled: v })} />
          </SettingRow>
          <SettingRow label="Show Welcome on Start">
            <Toggle value={general.showWelcomeOnStart}
              onChange={(v) => updateGeneral({ showWelcomeOnStart: v })} />
          </SettingRow>
          <SettingRow label="Auto Save">
            <Toggle value={general.autoSave}
              onChange={(v) => updateGeneral({ autoSave: v })} />
          </SettingRow>
          <SettingRow label="Language">
            <Select value={general.language}
              options={[
                { value: 'en', label: 'English' },
                { value: 'es', label: 'Español' },
                { value: 'zh', label: '中文' },
                { value: 'ja', label: '日本語' },
              ]}
              onChange={(v) => updateGeneral({ language: v })} />
          </SettingRow>
          <SettingRow label="Anonymous Telemetry">
            <Toggle value={general.telemetryEnabled}
              onChange={(v) => updateGeneral({ telemetryEnabled: v })} />
          </SettingRow>
          <SettingRow label="Educator Mode">
            <Toggle value={general.educatorMode}
              onChange={(v) => updateGeneral({ educatorMode: v })} />
          </SettingRow>
          <SettingRow label="Experimental Surfaces">
            <Toggle value={general.experimentalFeatures}
              onChange={(v) => updateGeneral({ experimentalFeatures: v })} />
          </SettingRow>
        </Section>
      </div>

      {/* ── Reset Button ── */}
      <div style={{ padding: 12, borderTop: `1px solid ${colors.border}`, flexShrink: 0 }}>
        <button
          onClick={resetAll}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 6, padding: '6px 0', border: `1px solid ${colors.border}`,
            borderRadius: 4, background: 'transparent', color: colors.textMuted,
            fontSize: 11, cursor: 'pointer', fontFamily: "'Geist Sans', sans-serif",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = colors.error;
            e.currentTarget.style.color = colors.error;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = colors.border;
            e.currentTarget.style.color = colors.textMuted;
          }}
        >
          <RotateCcw size={12} />
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}
