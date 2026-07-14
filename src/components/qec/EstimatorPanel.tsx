import { useState, type CSSProperties } from 'react';
import { Cpu, Download, Loader2, ChevronRight, HelpCircle } from 'lucide-react';
import { useThemeStore, type ThemeColors } from '../../stores/themeStore';
import { useEditorStore } from '../../stores/editorStore';
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

/** Nanoseconds → the most legible unit. */
function humanNs(ns: number | null): string {
  if (ns === null || !Number.isFinite(ns)) return '—';
  if (ns < 1e3) return `${ns} ns`;
  if (ns < 1e6) return `${(ns / 1e3).toFixed(2)} µs`;
  if (ns < 1e9) return `${(ns / 1e6).toFixed(2)} ms`;
  if (ns < 6e10) return `${(ns / 1e9).toFixed(2)} s`;
  return `${(ns / 6e10).toFixed(2)} min`;
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

  // Slim actions row (the SidebarHeader already carries the "Estimator"
  // title, so this panel adds only the docs link + JSON export).
  const toolbar = (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
        borderBottom: `1px solid ${colors.border}`,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: colors.text }}>
        <Cpu size={13} /> Resource Estimator
      </span>
      <div style={{ flex: 1 }} />
      {result && (
        <button
          type="button"
          onClick={() => downloadJson(result.full, 'resource-estimate.json')}
          title="Export the full estimator document as JSON"
          style={iconBtn(colors)}
        >
          <Download size={13} /> JSON
        </button>
      )}
      <a href={DOCS} target="_blank" rel="noreferrer" title="Resource estimation docs" style={{ ...iconBtn(colors), padding: '3px 5px' }}>
        <HelpCircle size={13} />
      </a>
    </div>
  );

  const shell: CSSProperties = {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: colors.bg,
    color: colors.text,
    fontFamily: "'Geist Sans', sans-serif",
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
            <select
              value={options.qubit_params ?? 'qubit_gate_ns_e3'}
              onChange={(e) => setOptions({ qubit_params: e.target.value as QecQubitPreset })}
              style={selectStyle(colors)}
            >
              {QEC_QUBIT_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {PRESET_LABELS[p]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="QEC scheme" colors={colors}>
            <select
              value={options.qec_scheme ?? 'surface_code'}
              onChange={(e) => setOptions({ qec_scheme: e.target.value as QecEstimateScheme })}
              style={selectStyle(colors)}
            >
              {QEC_ESTIMATE_SCHEMES.map((s) => (
                <option key={s} value={s}>
                  {SCHEME_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Error budget" colors={colors}>
            <input
              type="number"
              min={1e-6}
              max={0.5}
              step={0.0005}
              value={options.error_budget ?? 0.001}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v > 0 && v < 1) setOptions({ error_budget: v });
              }}
              style={selectStyle(colors)}
            />
          </Field>
        </div>

        <button
          type="button"
          onClick={run}
          disabled={pending}
          style={runBtn(colors, pending)}
        >
          {pending ? <Loader2 size={14} style={{ animation: 'nuclei-spin 800ms linear infinite' }} /> : <Cpu size={14} />}
          {pending ? 'Estimating…' : result ? 'Re-estimate' : 'Run estimate'}
        </button>

        {error && (
          <div style={errorBox(colors)}>{error}</div>
        )}

        {!result && !error && !pending && (
          <QecEmptyState
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
            <button
              type="button"
              onClick={() => setShowDetail((v) => !v)}
              style={detailToggle(colors, showDetail)}
            >
              <ChevronRight
                size={13}
                style={{ transform: showDetail ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }}
              />
              Full estimator output
            </button>
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
      <span style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.04em', color: colors.textDim }}>
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
        borderRadius: 6,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        background: colors.bg,
      }}
    >
      <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: colors.textDim }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: "'Geist Mono', monospace",
          fontSize: accent ? 22 : 18,
          fontWeight: 600,
          color: accent ? colors.accent : colors.text,
          lineHeight: 1.1,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function selectStyle(colors: Colors): CSSProperties {
  return {
    background: colors.bg,
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: 5,
    padding: '6px 8px',
    fontSize: 12,
    fontFamily: "'Geist Sans', sans-serif",
    outline: 'none',
  };
}

function runBtn(colors: Colors, pending: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    padding: '9px 14px',
    borderRadius: 6,
    border: `1px solid ${colors.accent}`,
    background: pending ? colors.bg : colors.accent,
    color: pending ? colors.textMuted : colors.bg,
    fontSize: 13,
    fontWeight: 600,
    cursor: pending ? 'default' : 'pointer',
    opacity: pending ? 0.8 : 1,
    transition: 'opacity 120ms, background 120ms',
  };
}

function iconBtn(colors: Colors): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 7px',
    borderRadius: 5,
    border: `1px solid ${colors.border}`,
    background: 'transparent',
    color: colors.textMuted,
    fontSize: 11,
    cursor: 'pointer',
  };
}

function errorBox(colors: Colors): CSSProperties {
  return {
    border: `1px solid ${colors.error}`,
    borderRadius: 6,
    padding: '9px 11px',
    fontSize: 12,
    color: colors.error,
    background: 'transparent',
    lineHeight: 1.45,
  };
}

function detailToggle(colors: Colors, open: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '5px 0',
    background: 'transparent',
    border: 'none',
    color: open ? colors.text : colors.textMuted,
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
  };
}

function detailPre(colors: Colors): CSSProperties {
  return {
    margin: 0,
    padding: 10,
    borderRadius: 6,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
    color: colors.textMuted,
    fontFamily: "'Geist Mono', monospace",
    fontSize: 10.5,
    lineHeight: 1.5,
    maxHeight: 260,
    overflow: 'auto',
    whiteSpace: 'pre',
  };
}
