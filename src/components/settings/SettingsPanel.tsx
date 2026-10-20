import { useContext, useEffect, useRef, useState } from 'react';
import { RotateCcw, Sun, Moon, Monitor, ExternalLink } from 'lucide-react';
import { useThemeStore, type ThemePreference } from '../../stores/themeStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useUIModeStore, type UIMode } from '../../stores/uiModeStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useLearnGateStore } from '../../stores/learnGateStore';
import { useModeSwitchStore } from '../../stores/modeSwitchStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useDiracStore } from '../../stores/diracStore';
import { useFrameworksStore } from '../../stores/frameworksStore';
import { EnvironmentPanel } from './EnvironmentPanel';
import { Button, IconButton, SecretField, SegmentedControl, Select, Switch, TextInput, useConfirm } from '../ui';
import { WorkspaceSection, HelpSection } from './SettingsWorkspaceHelp';
import { Section, SettingRow, RowLabelContext } from './SettingsPrimitives';
import { LANDING_ATTR } from '../../hooks/useLandingRef';
import { onSettingsFocusRequest, takeSettingsFocusRequest } from './settingsFocus';
import { featuresFor } from '../../layout/uiModeFeatures';
import { isWebBuild } from '../../platform/buildTarget';
import { kernelEngineName } from '../../lib/kernelErrors';
import { validateApiKey } from '../../lib/apiKey';
import { API_KEY_PRIVACY_NOTE } from '../../config/apiKeyCopy';

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
  // Name the steppers from their row ("Decrease font size"), not a bare "Decrease".
  const subject = (useContext(RowLabelContext) ?? 'value').toLowerCase();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <IconButton size="sm" variant="secondary" aria-label={`Decrease ${subject}`} onClick={() => onChange(Math.max(min, value - step))}>{'\u2212'}</IconButton>
      <span style={{ fontSize: 11, color: colors.text, minWidth: 28, textAlign: 'center', fontFamily: TYPOGRAPHY.fontSans }}>
        {value}
      </span>
      <IconButton size="sm" variant="secondary" aria-label={`Increase ${subject}`} onClick={() => onChange(Math.min(max, value + step))}>+</IconButton>
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
  const label = useContext(RowLabelContext);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        type="range" min={min} max={max} step={step} value={value}
        aria-label={label}
        aria-valuetext={displayValue}
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
        <SecretField
          size="lg"
          noun="API key"
          value={keyValue}
          invalid={Boolean(error)}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="sk-ant-..."
          data-settings-autofocus=""
          aria-label="Anthropic API key"
        />
        <Button size="lg" className="nuclei-btn--dirac" onClick={handleSave}>
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
          fontSize: 11, color: colors.accentText, textDecoration: 'none',
          fontFamily: TYPOGRAPHY.fontSans,
        }}
      >
        Get an API key <ExternalLink size={12} />
      </a>
      <span style={{
        fontSize: 11, color: colors.textDim, lineHeight: 1.4,
        fontFamily: TYPOGRAPHY.fontSans,
      }}>
        {API_KEY_PRIVACY_NOTE}
      </span>
    </div>
  );
}

/* ── Main Panel ─────────────────────────────────────────── */

const FOCUS_SETTLE_MS = 400;

const KERNEL_FRAMEWORK_OPTIONS: ReadonlyArray<{ value: 'qiskit' | 'cirq' | 'cuda-q' | 'qsharp'; label: string; webSupported: boolean }> = [
  { value: 'qiskit', label: 'Qiskit', webSupported: true },
  { value: 'cirq', label: 'Cirq', webSupported: true },
  { value: 'cuda-q', label: 'CUDA-Q', webSupported: false },
  { value: 'qsharp', label: 'Q# (QDK)', webSupported: false },
];

export function SettingsPanel() {
  const { confirm, confirmDialog } = useConfirm();
  const colors = useThemeStore((s) => s.colors);
  const themePreference = useThemeStore((s) => s.preference);
  const setThemePreference = useThemeStore((s) => s.setPreference);
  const uiMode = useUIModeStore((s) => s.mode);
  const workspaceMode = useWorkspaceStore((s) => s.mode);
  const learnEnabled = useLearnGateStore((s) => s.learnEnabled);
  // Through modeSwitchStore so turning it off from Learn lands in Research with focus kept.
  const setLearnEnabled = useModeSwitchStore((s) => s.setLearnEnabled);
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
  const isWeb = isWebBuild();
  // Paid-hardware autonomy is a researcher's choice, and the browser build has no hardware to spend on.
  const showHardwareAutonomy = !isWeb && featuresFor(workspaceMode, uiMode).agentEntry;
  const frameworkOptions = KERNEL_FRAMEWORK_OPTIONS.filter((o) => !isWeb || o.webSupported);
  const setSimShots = useSimulationStore((s) => s.setShots);
  const settingsTarget = useNavigationStore((s) => s.settingsTarget);
  const clearSettingsTarget = useNavigationStore((s) => s.clearSettingsTarget);
  // Sections consume the target in their own effects first; clear it afterwards.
  useEffect(() => {
    if (settingsTarget) clearSettingsTarget();
  }, [settingsTarget, clearSettingsTarget]);

  // Opened from the keyboard: move focus onto the Settings heading, once the frame has settled
  // (a closing palette hands focus back to the editor in the same tick).
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    let settleTimer = 0;
    let stopGuard: (() => void) | null = null;
    // Like every other sidebar, Settings lands on its heading (no ring; Tab then reaches the first section). Without a
    // sidebar around it (a bare panel), the first control is the fallback.
    const scopeOf = (root: HTMLElement) => root.closest<HTMLElement>('[data-tour-sidebar]') ?? root;
    const focusTarget = (root: HTMLElement) =>
      scopeOf(root).querySelector<HTMLElement>(`[${LANDING_ATTR}]`)
      ?? root.querySelector<HTMLElement>('button:not([disabled]), input, select');
    // A view that mounts after Settings (the editor, from Challenges) grabs focus for itself. For a short settle window,
    // anything outside the panel that takes focus hands it straight back, so the next Tab does not indent code.
    const guardFocus = (root: HTMLElement) => {
      stopGuard?.();
      const onFocusIn = (e: FocusEvent) => {
        if (e.target instanceof Node && !scopeOf(root).contains(e.target)) focusTarget(root)?.focus({ focusVisible: true } as FocusOptions);
      };
      document.addEventListener('focusin', onFocusIn);
      const stop = () => {
        window.clearTimeout(settleTimer);
        document.removeEventListener('focusin', onFocusIn);
        stopGuard = null;
      };
      settleTimer = window.setTimeout(stop, FOCUS_SETTLE_MS);
      stopGuard = stop;
    };
    // The request is consumed inside the frame, not before it: a StrictMode remount (or a quick re-render) cancels
    // the first frame, and the surviving effect must still find the request.
    const focusFirst = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const root = rootRef.current;
        if (!root || !takeSettingsFocusRequest()) return; // a frame from an unmounted panel must not eat the request
        focusTarget(root)?.focus({ focusVisible: true } as FocusOptions);
        guardFocus(root);
      });
    };
    focusFirst();
    const off = onSettingsFocusRequest(focusFirst);
    return () => { off(); cancelAnimationFrame(frame); stopGuard?.(); };
  }, []);

  return (
    <div ref={rootRef} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
            <SettingRow label="Level" hint="How much of the IDE is shown">
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
          <SettingRow label="Font size">
            <NumberStepper value={editor.fontSize} min={10} max={24} step={1}
              onChange={(v) => updateEditor({ fontSize: v })} />
          </SettingRow>
          <SettingRow label="Tab size">
            <SettingSelect value={String(editor.tabSize) as '2' | '4'}
              options={[{ value: '2', label: '2' }, { value: '4', label: '4' }]}
              onChange={(v) => updateEditor({ tabSize: Number(v) })} />
          </SettingRow>
          <SettingRow label="Word wrap">
            <Toggle value={editor.wordWrap} onChange={(v) => updateEditor({ wordWrap: v })} />
          </SettingRow>
          <SettingRow label="Minimap">
            <Toggle value={editor.minimap} onChange={(v) => updateEditor({ minimap: v })} />
          </SettingRow>
          <SettingRow label="Line numbers">
            <Toggle value={editor.lineNumbers} onChange={(v) => updateEditor({ lineNumbers: v })} />
          </SettingRow>
          <SettingRow label="Bracket colorization">
            <Toggle value={editor.bracketPairColorization}
              onChange={(v) => updateEditor({ bracketPairColorization: v })} />
          </SettingRow>
          <SettingRow label="Auto-close brackets">
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
              API key
            </span>
            <ApiKeyInput />
          </div>
          <SettingRow label="Ghost completions">
            <Toggle value={dirac.ghostCompletions}
              onChange={(v) => updateDirac({ ghostCompletions: v })} />
          </SettingRow>
          <SettingRow label="Auto-explain errors">
            <Toggle value={dirac.autoExplainErrors}
              onChange={(v) => updateDirac({ autoExplainErrors: v })} />
          </SettingRow>
          <SettingRow label="Ambient narration"
            hint="Dirac comments on your circuit after you pause typing. Each comment is a paid Claude call, so it is off by default and limited to one every 10 seconds.">
            <Toggle value={dirac.ambientNarration}
              onChange={(v) => updateDirac({ ambientNarration: v })} />
          </SettingRow>
          <SettingRow label="Extended thinking"
            hint="Auto-escalate hard chat questions to deep reasoning. /think always works.">
            <Toggle value={dirac.extendedThinking}
              onChange={(v) => updateDirac({ extendedThinking: v })} />
          </SettingRow>
          <SettingRow label="Preferred model"
            hint="Chat only. Auto picks per message; actions that use tools always run Sonnet.">
            <SettingSelect value={dirac.preferredModel}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'haiku', label: 'Haiku' },
                { value: 'sonnet', label: 'Sonnet' },
              ]}
              onChange={(v) => updateDirac({ preferredModel: v })} />
          </SettingRow>
          <SettingRow label="Context depth"
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
        {showHardwareAutonomy && <Section title="Agent hardware autonomy">
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
          <SettingRow label="Autonomous hardware submission"
            hint="When off, any hardware job Dirac proposes always needs your approval first.">
            <Toggle value={agentHardware.autonomousHardwareEnabled}
              onChange={(v) => updateAgentHardware({ autonomousHardwareEnabled: v })} />
          </SettingRow>
          <SettingRow label="Max spend"
            hint="Per-run budget ceiling for autonomous hardware jobs, in USD.">
            <CurrencyInput value={agentHardware.maxSpend}
              onChange={(v) => updateAgentHardware({ maxSpend: v })} />
          </SettingRow>
        </Section>}

        {/* ── Frameworks ── */}
        {!isWeb && <FrameworksSection />}

        {/* ── Kernel ── */}
        <Section title={kernelEngineName(isWeb)}>
          <SettingRow label="Default framework" hint={isWeb ? 'The web version runs Python in your browser via Pyodide.' : undefined}>
            <SettingSelect value={kernel.defaultFramework}
              options={frameworkOptions}
              onChange={(v) => updateKernel({ defaultFramework: v })} />
          </SettingRow>
          <SettingRow label="Default shots">
            <NumberStepper value={kernel.defaultShots} min={100} max={100000} step={100}
              onChange={(v) => { updateKernel({ defaultShots: v }); setSimShots(v); }} />
          </SettingRow>
          <SettingRow label="Auto-parse on type">
            <Toggle value={kernel.autoParseOnType}
              onChange={(v) => updateKernel({ autoParseOnType: v })} />
          </SettingRow>
          <SettingRow label="Parse debounce">
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
          <SettingRow label="Learning workspace"
            hint="Lessons, challenges and the tutor, for teaching a course. Off by default.">
            <Toggle value={learnEnabled} onChange={setLearnEnabled} />
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
          onClick={async () => {
            const ok = await confirm({
              title: 'Reset all settings?',
              description: 'Every setting goes back to its default. This cannot be undone.',
              confirmLabel: 'Reset',
              cancelLabel: 'Keep settings',
              tone: 'danger',
            });
            if (ok) resetAll();
          }}
        >
          Reset to defaults
        </Button>
        {confirmDialog}
      </div>
    </div>
  );
}

/* ── Frameworks section (desktop-only) ────────────────────── */

function FrameworksSection() {
  const openModal = useFrameworksStore((s) => s.openModal);

  return (
    <Section title="Environment" defaultOpen={false}>
      <EnvironmentPanel />
      {!isWebBuild() && (
        <Button variant="ghost" size="sm" className="nuclei-framework-btn settings-link" onClick={() => openModal(false)}>
          Open the setup wizard…
        </Button>
      )}
    </Section>
  );
}
