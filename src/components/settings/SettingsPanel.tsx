import { useContext, useEffect, useState, type CSSProperties } from 'react';
import { RotateCcw, Sun, Moon, Monitor, Eye, EyeOff, ExternalLink } from 'lucide-react';
import { useThemeStore, type ThemePreference } from '../../stores/themeStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useUIModeStore, type UIMode } from '../../stores/uiModeStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useDiracStore } from '../../stores/diracStore';
import { useFrameworksStore } from '../../stores/frameworksStore';
import { EnvironmentPanel } from './EnvironmentPanel';
import { Button, IconButton, SegmentedControl, Select, Switch, TextInput } from '../ui';
import { WorkspaceSection, HelpSection } from './SettingsWorkspaceHelp';
import { Section, SettingRow, RowLabelContext } from './SettingsPrimitives';
import { validateApiKey } from '../../lib/apiKey';

import { TYPOGRAPHY } from '../../styles/tokens';
/* ── Shared Controls ────────────────────────────────────── */

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const label = useContext(RowLabelContext);
  return <Switch checked={value} onCheckedChange={onChange} aria-label={label} />;
}

function SettingSelect<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  const label = useContext(RowLabelContext);
  return (
    <Select size="sm" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
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
    fontFamily: TYPOGRAPHY.fontSans, padding: 0,
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <button type="button" aria-label="Decrease" style={btnStyle} onClick={() => onChange(Math.max(min, value - step))}>{'\u2212'}</button>
      <span style={{ fontSize: 11, color: colors.text, minWidth: 28, textAlign: 'center', fontFamily: TYPOGRAPHY.fontSans }}>
        {value}
      </span>
      <button type="button" aria-label="Increase" style={btnStyle} onClick={() => onChange(Math.min(max, value + step))}>+</button>
    </div>
  );
}

function CurrencyInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const colors = useThemeStore((s) => s.colors);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 11, color: colors.textDim, fontFamily: TYPOGRAPHY.fontSans }}>$</span>
      <TextInput
        type="number"
        size="sm"
        min={0}
        step={1}
        value={value}
        aria-label="Maximum spend in dollars"
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        style={{ width: 64 }}
      />
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
      <span style={{ fontSize: 11, color: colors.textDim, minWidth: 32, textAlign: 'right', fontFamily: TYPOGRAPHY.fontSans }}>
        {displayValue ?? value}
      </span>
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

  const validate = validateApiKey;

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
        }} className="nuclei-field-group">
          <input
            type={visible ? 'text' : 'password'}
            value={keyValue}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="sk-ant-..."
            data-settings-autofocus=""
            aria-label="Anthropic API key"
            style={{
              flex: 1, padding: '5px 8px', fontSize: 11,
              fontFamily: TYPOGRAPHY.fontMono,
              background: 'transparent', border: 'none',
              color: colors.text,
            }}
          />
          <IconButton
            size="sm"
            onClick={() => setVisible(!visible)}
            aria-label={visible ? 'Hide API key' : 'Show API key'}
          >
            {visible ? <EyeOff size={12} /> : <Eye size={12} />}
          </IconButton>
        </div>
        <Button variant="primary" size="sm" onClick={handleSave}>
          {saved ? 'Saved' : 'Save'}
        </Button>
      </div>
      {error && (
        <span style={{ fontSize: 11, color: colors.error, fontFamily: TYPOGRAPHY.fontSans }}>
          {error}
        </span>
      )}
      <a
        href="https://console.anthropic.com/"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 11, color: colors.accent, textDecoration: 'none',
          fontFamily: TYPOGRAPHY.fontSans,
        }}
      >
        Get an API key <ExternalLink size={12} />
      </a>
      <span style={{
        fontSize: 11, color: colors.textDim, lineHeight: 1.4,
        fontFamily: TYPOGRAPHY.fontSans,
      }}>
        Your key is stored locally and never leaves your machine.
      </span>
    </div>
  );
}

/* ── Main Panel ─────────────────────────────────────────── */

export function SettingsPanel() {
  const colors = useThemeStore((s) => s.colors);
  const themePreference = useThemeStore((s) => s.preference);
  const setThemePreference = useThemeStore((s) => s.setPreference);
  const uiMode = useUIModeStore((s) => s.mode);
  const workspaceMode = useWorkspaceStore((s) => s.mode);
  const setUIMode = useUIModeStore((s) => s.setMode);

  const editor = useSettingsStore((s) => s.editor);
  const dirac = useSettingsStore((s) => s.dirac);
  const kernel = useSettingsStore((s) => s.kernel);
  const general = useSettingsStore((s) => s.general);
  const agentHardware = useSettingsStore((s) => s.agentHardware);
  const updateEditor = useSettingsStore((s) => s.updateEditor);
  const updateDirac = useSettingsStore((s) => s.updateDirac);
  const updateKernel = useSettingsStore((s) => s.updateKernel);
  const updateGeneral = useSettingsStore((s) => s.updateGeneral);
  const updateAgentHardware = useSettingsStore((s) => s.updateAgentHardware);
  const resetAll = useSettingsStore((s) => s.resetAll);
  const setSimShots = useSimulationStore((s) => s.setShots);
  const settingsTarget = useNavigationStore((s) => s.settingsTarget);
  const clearSettingsTarget = useNavigationStore((s) => s.clearSettingsTarget);
  // Sections consume the target in their own effects first; clear it afterwards.
  useEffect(() => {
    if (settingsTarget) clearSettingsTarget();
  }, [settingsTarget, clearSettingsTarget]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {/* ── Appearance ── */}
        <Section id="appearance" title="Appearance" defaultOpen>
          <SettingRow label="Theme" stacked>
            <SegmentedControl<ThemePreference>
              aria-label="Theme"
              value={themePreference}
              onChange={setThemePreference}
              options={[
                { value: 'system', label: 'System', icon: <Monitor size={12} /> },
                { value: 'dark', label: 'Dark', icon: <Moon size={12} /> },
                { value: 'light', label: 'Light', icon: <Sun size={12} /> },
              ]}
            />
          </SettingRow>
          {workspaceMode === 'learn' && (
            <SettingRow label="UI Mode">
              <SettingSelect<UIMode>
                value={uiMode}
                options={[
                  { value: 'beginner', label: 'Beginner' },
                  { value: 'intermediate', label: 'Intermediate' },
                  { value: 'advanced', label: 'Advanced' },
                ]}
                onChange={setUIMode}
              />
            </SettingRow>
          )}
        </Section>

        <WorkspaceSection />

        {/* ── Editor ── */}
        <Section id="editor" title="Editor" defaultOpen>
          <SettingRow label="Font Size">
            <NumberStepper value={editor.fontSize} min={10} max={24} step={1}
              onChange={(v) => updateEditor({ fontSize: v })} />
          </SettingRow>
          <SettingRow label="Tab Size">
            <SettingSelect value={String(editor.tabSize) as '2' | '4'}
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
        <Section id="dirac" title="Dirac AI">
          <div style={{ marginBottom: 8 }}>
            <span style={{
              fontSize: 11, color: colors.textMuted,
              fontFamily: TYPOGRAPHY.fontSans, display: 'block',
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
          <SettingRow label="Ambient Narration"
            hint="Dirac comments on your circuit after you pause typing. Each comment is a paid Claude call, so it is off by default and limited to one every 10 seconds.">
            <Toggle value={dirac.ambientNarration}
              onChange={(v) => updateDirac({ ambientNarration: v })} />
          </SettingRow>
          <SettingRow label="Extended Thinking"
            hint="Auto-escalate hard chat questions to deep reasoning. /think always works.">
            <Toggle value={dirac.extendedThinking}
              onChange={(v) => updateDirac({ extendedThinking: v })} />
          </SettingRow>
          <SettingRow label="Preferred Model"
            hint="Chat only. Auto picks per message; actions that use tools always run Sonnet.">
            <SettingSelect value={dirac.preferredModel}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'haiku', label: 'Haiku' },
                { value: 'sonnet', label: 'Sonnet' },
              ]}
              onChange={(v) => updateDirac({ preferredModel: v })} />
          </SettingRow>
          <SettingRow label="Context Depth"
            hint="IDE state sent with chat. Minimal: code, circuit, errors. Standard: + results, exercise, hardware. Full: extra detail.">
            <SettingSelect value={dirac.contextDepth}
              options={[
                { value: 'minimal', label: 'Minimal' },
                { value: 'standard', label: 'Standard' },
                { value: 'full', label: 'Full' },
              ]}
              onChange={(v) => updateDirac({ contextDepth: v })} />
          </SettingRow>
        </Section>

        {/* ── Agent Hardware Autonomy ── */}
        <Section title="Agent Hardware Autonomy">
          <div style={{
            marginBottom: 8, padding: '8px 10px', borderRadius: 4,
            background: `${colors.error}12`, border: `1px solid ${colors.error}40`,
          }}>
            <span style={{
              fontSize: 11, color: colors.textMuted, lineHeight: 1.5,
              fontFamily: TYPOGRAPHY.fontSans, display: 'block',
            }}>
              Enabling this lets Dirac submit jobs to real, paid quantum hardware on your behalf,
              within the budget below, without asking first. This is off by default — leave it off
              unless you understand the cost implications.
            </span>
          </div>
          <SettingRow label="Autonomous Hardware Submission"
            hint="When off, any hardware job Dirac proposes always needs your approval first.">
            <Toggle value={agentHardware.autonomousHardwareEnabled}
              onChange={(v) => updateAgentHardware({ autonomousHardwareEnabled: v })} />
          </SettingRow>
          <SettingRow label="Max Spend"
            hint="Per-run budget ceiling for autonomous hardware jobs, in USD.">
            <CurrencyInput value={agentHardware.maxSpend}
              onChange={(v) => updateAgentHardware({ maxSpend: v })} />
          </SettingRow>
        </Section>

        {/* ── Frameworks ── */}
        <FrameworksSection />

        {/* ── Kernel ── */}
        <Section title="Kernel">
          <SettingRow label="Default Framework">
            <SettingSelect value={kernel.defaultFramework}
              options={[
                { value: 'qiskit', label: 'Qiskit' },
                { value: 'cirq', label: 'Cirq' },
                { value: 'cuda-q', label: 'CUDA-Q' },
                { value: 'qsharp', label: 'Q# (QDK)' },
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
            <SettingSelect value={general.language}
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
          <SettingRow label="Developer views"
            hint="Adds the Search and Circuit-inspector views to the activity bar in both modes. Everything else is chosen by workspace mode.">
            <Toggle value={general.experimentalFeatures}
              onChange={(v) => updateGeneral({ experimentalFeatures: v })} />
          </SettingRow>
        </Section>

        <HelpSection />
      </div>

      {/* ── Reset Button ── */}
      <div style={{ padding: 12, borderTop: `1px solid ${colors.border}`, flexShrink: 0 }}>
        <Button
          variant="secondary"
          icon={<RotateCcw size={12} />}
          style={{ width: '100%' }}
          onClick={() => { if (window.confirm('Reset all settings to their defaults? This cannot be undone.')) resetAll(); }}
        >
          Reset to Defaults
        </Button>
      </div>
    </div>
  );
}

/* ── Frameworks section (desktop-only) ────────────────────── */

function FrameworksSection() {
  const colors = useThemeStore((s) => s.colors);
  const openModal = useFrameworksStore((s) => s.openModal);

  return (
    <Section title="Environment" defaultOpen={false}>
      <EnvironmentPanel />
      <button
        onClick={() => openModal(false)}
        style={{
          marginTop: 12,
          background: 'transparent',
          border: 'none',
          padding: 0,
          color: colors.accent,
          fontSize: 12,
          fontFamily: TYPOGRAPHY.fontSans,
          cursor: 'pointer',
        }}
      >
        Open the setup wizard…
      </button>
    </Section>
  );
}
