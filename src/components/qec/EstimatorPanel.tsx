import { useState, type CSSProperties } from 'react';
import { Cpu, Download, ChevronRight, HelpCircle } from 'lucide-react';
import { useThemeStore, type ThemeColors } from '../../stores/themeStore';
import { useEditorStore } from '../../stores/editorStore';
import { humanNs } from '../../lib/qecEstimateFormat';
import { useQecEstimateStore } from '../../stores/qecEstimateStore';
import { QecEmptyState } from './QecEmptyState';
import { downloadJson } from '../../services/experimentExport';
import { requestQecEstimate, type QecEstimateLanguage } from '../../lib/qecDecodeSender';
import {
  QEC_QUBIT_PRESETS,
  QEC_ESTIMATE_SCHEMES,
  type QecQubitPreset,
  type QecEstimateScheme,
} from '../../types/qec';
import type { Framework } from '../../types/quantum';

import { TYPOGRAPHY, ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { Button, Select, TextInput } from '../ui';
const DOCS = 'https://getnuclei.dev/docs/research/resource-estimation/';

// Frameworks the Azure Quantum Resource Estimator can cost. Q# is estimated
// from its entry operation; Qiskit is exported to OpenQASM 3 kernel-side. The
// others have no estimator path in the shipped qdk, so the panel says so
// rather than sending a request that can only fail.
const ESTIMABLE: Partial<Record<Framework, QecEstimateLanguage>> = {
  qsharp: 'qsharp',
  qiskit: 'qiskit',
};

const PRESET_LABELS: Record<QecQubitPreset, string> = {
  qubit_gate_ns_e3: 'Gate-based ns, 10⁻³',
  qubit_gate_ns_e4: 'Gate-based ns, 10⁻⁴',
  qubit_gate_us_e3: 'Gate-based µs, 10⁻³',
  qubit_gate_us_e4: 'Gate-based µs, 10⁻⁴',
  qubit_maj_ns_e4: 'Majorana ns, 10⁻⁴',
  qubit_maj_ns_e6: 'Majorana ns, 10⁻⁶',
};

const SCHEME_LABELS: Record<QecEstimateScheme, string> = {
  surface_code: 'Surface code',
  floquet_code: 'Floquet code',
};

/** Compact large integers: 1_234_567 → "1.23M". */
function compact(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}K`;
  if (n < 1e9) return `${(n / 1e6).toFixed(2)}M`;
  return `${(n / 1e9).toFixed(2)}B`;
}

function sci(x: number | null): string {
  if (x === null || !Number.isFinite(x)) return '—';
  return x.toExponential(2);
}

/**
 * PRD 10 Phase F — the Resource Estimator panel. Runs the Azure Quantum
 * Resource Estimator (via qdk) on the active buffer and leads with the
 * headline fault-tolerant cost: physical qubits, runtime, code distance,
 * T-factory count. The full estimator document is available under a
 * collapsible detail and exportable as JSON. Q# and Qiskit only — other
 * frameworks get an honest note, never a request that can only fail.
 */
export function EstimatorPanel() {
  const colors = useThemeStore((s) => s.colors);
  const code = useEditorStore((s) => s.code);
  const framework = useEditorStore((s) => s.framework);

  const result = useQecEstimateStore((s) => s.result);
  const pending = useQecEstimateStore((s) => s.pending);
  const error = useQecEstimateStore((s) => s.error);
  const options = useQecEstimateStore((s) => s.options);
  const setOptions = useQecEstimateStore((s) => s.setOptions);

  const [showDetail, setShowDetail] = useState(false);

  const language = ESTIMABLE[framework];
  const supported = Boolean(language);

  const run = () => {
    if (!language) return;
    requestQecEstimate(code, language, { ...options });
  };

  // Slim actions row, shown once there is something to export (the SidebarHeader already carries the "Estimator"
  // title, so this panel adds only the docs link + JSON export).
  const toolbar = !result ? null : (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
        borderBottom: `1px solid ${colors.border}`,
      }}
    >
      <div style={{ flex: 1 }} />
      {result && (
        <Button
          size="sm"
          onClick={() => downloadJson(result.full, 'resource-estimate.json')}
          title="Export the full estimator document as JSON"
          icon={<Download size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}
        >
          JSON
        </Button>
      )}
      <a href={DOCS} target="_blank" rel="noreferrer" title="Resource estimation docs" aria-label="Resource estimation docs" className="nuclei-icon-btn nuclei-icon-btn--sm">
        <HelpCircle size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
      </a>
    </div>
  );

  const shell: CSSProperties = {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: colors.bg,
    color: colors.text,
    fontFamily: TYPOGRAPHY.fontSans,
  };

  if (!supported) {
    return (
      <div style={shell}>
        {toolbar}
        <QecEmptyState
          title="Resource estimation supports Q# and Qiskit"
          body={`The active buffer is ${framework}. Switch to a Q# or Qiskit circuit to estimate the physical qubits and runtime a fault-tolerant implementation would need.`}
          docsHref={DOCS}
        />
      </div>
    );
  }

  return (
    <div style={shell}>
      {toolbar}
      <div style={{ flex: 1, minHeight: 0, padding: 12, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Assumption controls: qubit model, QEC scheme, error budget. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Field label="Qubit parameters" colors={colors}>
            <Select
              value={options.qubit_params ?? 'qubit_gate_ns_e3'}
              onChange={(e) => setOptions({ qubit_params: e.target.value as QecQubitPreset })}
            >
              {QEC_QUBIT_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {PRESET_LABELS[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="QEC scheme" colors={colors}>
            <Select
              value={options.qec_scheme ?? 'surface_code'}
              onChange={(e) => setOptions({ qec_scheme: e.target.value as QecEstimateScheme })}
            >
              {QEC_ESTIMATE_SCHEMES.map((s) => (
                <option key={s} value={s}>
                  {SCHEME_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Error budget" colors={colors}>
            <TextInput
              mono
              type="number"
              min={1e-6}
              max={0.5}
              step={0.0005}
              value={options.error_budget ?? 0.001}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v > 0 && v < 1) setOptions({ error_budget: v });
              }}
            />
          </Field>
        </div>

        <Button
          variant="primary"
          size="lg"
          onClick={run}
          loading={pending}
          icon={pending ? undefined : <Cpu size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}
        >
          {pending ? 'Estimating…' : result ? 'Re-estimate' : 'Run estimate'}
        </Button>

        {error && (
          <div style={errorBox(colors)}>{error}</div>
        )}

        {!result && !error && !pending && (
          <QecEmptyState
            align="top"
            title="No estimate yet"
            body="Use Run estimate above to see the physical qubits, wall-clock runtime, and code distance a fault-tolerant run of this circuit would require."
            docsHref={DOCS}
          />
        )}

        {result && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Stat label="Physical qubits" value={compact(result.physical_qubits)} accent colors={colors} />
              <Stat label="Runtime" value={result.formatted?.runtime ?? humanNs(result.runtime_ns)} colors={colors} />
              <Stat label="Code distance" value={result.code_distance !== null ? String(result.code_distance) : '—'} colors={colors} />
              <Stat label="T factories" value={result.num_tfactories !== null ? String(result.num_tfactories) : '—'} colors={colors} />
              <Stat label="rQOPS" value={compact(result.rqops)} colors={colors} />
              <Stat label="Logical error rate" value={sci(result.logical_error_rate)} colors={colors} />
            </div>

            <div style={{ fontSize: 11, color: colors.textDim, lineHeight: 1.5 }}>
              {compact(result.physical_qubits_algorithm)} qubits for the algorithm ·{' '}
              {compact(result.physical_qubits_tfactories)} for T factories ·{' '}
              {result.qubit_params ?? '—'} / {result.qec_scheme ?? '—'}
            </div>

            {/* Collapsible full estimator document. */}
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={showDetail}
              onClick={() => setShowDetail((v) => !v)}
              style={{ alignSelf: 'flex-start' }}
              icon={<ChevronRight size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} style={{ transform: showDetail ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }} />}
            >
              Full estimator output
            </Button>
            {showDetail && (
              <pre style={detailPre(colors)}>{JSON.stringify(result.full, null, 2)}</pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}

type Colors = ThemeColors;

function Field({ label, colors, children }: { label: string; colors: Colors; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: colors.textMuted }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Stat({
  label,
  value,
  accent,
  colors,
}: {
  label: string;
  value: string;
  accent?: boolean;
  colors: Colors;
}) {
  return (
    <div
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 'var(--radius-soft)',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        background: colors.bg,
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 500, color: colors.textMuted }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: TYPOGRAPHY.fontMono,
          fontSize: accent ? 22 : 18,
          fontWeight: 600,
          color: accent ? colors.accentText : colors.text,
          lineHeight: 1.1,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function errorBox(colors: Colors): CSSProperties {
  return {
    border: `1px solid ${colors.error}`,
    borderRadius: 'var(--radius-soft)',
    padding: '9px 11px',
    fontSize: 12,
    color: colors.error,
    background: 'transparent',
    lineHeight: 1.45,
  };
}

function detailPre(colors: Colors): CSSProperties {
  return {
    margin: 0,
    padding: 10,
    borderRadius: 'var(--radius-soft)',
    border: `1px solid ${colors.border}`,
    background: colors.bg,
    color: colors.textMuted,
    fontFamily: TYPOGRAPHY.fontMono,
    fontSize: 11,
    lineHeight: 1.5,
    maxHeight: 260,
    overflow: 'auto',
    whiteSpace: 'pre',
  };
}
