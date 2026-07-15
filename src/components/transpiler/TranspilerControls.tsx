import { type CSSProperties } from 'react';
import { Shuffle, Loader2 } from 'lucide-react';
import { useThemeStore, type ThemeColors } from '../../stores/themeStore';
import { useEditorStore } from '../../stores/editorStore';
import { useHardwareStore } from '../../stores/hardwareStore';
import { useTranspileStore, SIMULATOR_TARGET_ID } from '../../stores/transpileStore';
import { requestTranspile } from '../../lib/transpileSender';
import { ConnectivityMap } from '../hardware/ConnectivityMap';
import { resolveTargetRequest } from './transpileMath';

const DOCS = 'https://getnuclei.dev/docs/developer-tools/transpiler-explorer/';
const OPT_LEVELS: Array<0 | 1 | 2 | 3> = [0, 1, 2, 3];

/**
 * Dev tools Phase 1 — the Transpiler Explorer's sidebar controls: pick a
 * target device + optimization level and fire the transpile. The before/after
 * visualization it produces lives in the main area (`TranspilerExplorer`);
 * both read the same `transpileStore`. Qiskit-only — the panel says so plainly
 * for other frameworks rather than sending a request that can only fail.
 */
export function TranspilerControls() {
  const colors = useThemeStore((s) => s.colors);
  const code = useEditorStore((s) => s.code);
  const framework = useEditorStore((s) => s.framework);
  const backends = useHardwareStore((s) => s.backends);

  const targetId = useTranspileStore((s) => s.targetId);
  const optimizationLevel = useTranspileStore((s) => s.optimizationLevel);
  const pending = useTranspileStore((s) => s.pending);
  const result = useTranspileStore((s) => s.result);
  const setTarget = useTranspileStore((s) => s.setTarget);
  const setOptimizationLevel = useTranspileStore((s) => s.setOptimizationLevel);
  const setPending = useTranspileStore((s) => s.setPending);
  const setError = useTranspileStore((s) => s.setError);

  const isQiskit = framework === 'qiskit';
  const selectedBackend = backends.find((b) => b.name === targetId);

  const run = () => {
    if (!isQiskit) return;
    const target = resolveTargetRequest(targetId, backends, optimizationLevel);
    setPending(true);
    if (!requestTranspile(code, target)) {
      setError("The kernel isn't connected. Start it and try again.");
    }
  };

  const shell: CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 14, padding: 12,
    fontFamily: "'Geist Sans', sans-serif", color: colors.text,
  };

  if (!isQiskit) {
    return (
      <div style={shell}>
        <div style={noteBox(colors)}>
          <strong style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
            Transpiler Explorer needs Qiskit
          </strong>
          <span style={{ fontSize: 11.5, color: colors.textMuted, lineHeight: 1.5 }}>
            The active buffer is {framework}. Qiskit is the only framework with an
            introspectable compiler, so the pass-by-pass view is Qiskit-only.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={shell}>
      <label style={fieldLabel(colors)}>
        Target
        <select
          value={targetId}
          onChange={(e) => setTarget(e.target.value)}
          style={selectStyle(colors)}
        >
          <option value={SIMULATOR_TARGET_ID}>Simulator (all-to-all)</option>
          {backends.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name} · {b.qubitCount}q
            </option>
          ))}
        </select>
      </label>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={{ fontSize: 11, color: colors.textDim }}>Optimization level</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {OPT_LEVELS.map((lvl) => {
            const active = lvl === optimizationLevel;
            return (
              <button
                key={lvl}
                type="button"
                onClick={() => setOptimizationLevel(lvl)}
                aria-pressed={active}
                style={segBtn(colors, active)}
              >
                {lvl}
              </button>
            );
          })}
        </div>
      </div>

      <button type="button" onClick={run} disabled={pending} style={runBtn(colors, pending)}>
        {pending
          ? <Loader2 size={14} style={{ animation: 'nuclei-spin 800ms linear infinite' }} />
          : <Shuffle size={14} />}
        {pending ? 'Transpiling…' : result ? 'Re-transpile' : 'Transpile'}
      </button>

      {/* The target's physical constraints — the topology and basis set that
          force the routing the main view then explains. */}
      {selectedBackend ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 11, color: colors.textDim }}>
            Target topology · {selectedBackend.qubitCount} qubits
          </span>
          <div style={{ border: `1px solid ${colors.border}`, borderRadius: 6, padding: 6 }}>
            <ConnectivityMap
              connectivity={selectedBackend.connectivity}
              qubitCount={selectedBackend.qubitCount}
            />
          </div>
          {selectedBackend.gateSet.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {selectedBackend.gateSet.map((g) => (
                <span key={g} style={chip(colors)}>{g}</span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <span style={{ fontSize: 11, color: colors.textMuted, lineHeight: 1.5 }}>
          All-to-all connectivity, no basis-gate constraint — the pure
          optimization passes with no routing. Pick a connected hardware backend
          to see device routing.{' '}
          <a href={DOCS} target="_blank" rel="noreferrer" style={{ color: colors.accent }}>
            Learn more
          </a>
        </span>
      )}
    </div>
  );
}

function fieldLabel(colors: ThemeColors): CSSProperties {
  return { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, color: colors.textDim };
}

function selectStyle(colors: ThemeColors): CSSProperties {
  return {
    background: colors.bg, color: colors.text,
    border: `1px solid ${colors.border}`, borderRadius: 5,
    padding: '6px 8px', fontSize: 12, fontFamily: "'Geist Sans', sans-serif", outline: 'none',
  };
}

function segBtn(colors: ThemeColors, active: boolean): CSSProperties {
  return {
    flex: 1, padding: '6px 0', borderRadius: 5,
    border: `1px solid ${active ? colors.accent : colors.border}`,
    background: active ? colors.accent : 'transparent',
    color: active ? colors.bg : colors.textMuted,
    fontSize: 12, fontWeight: 600, fontFamily: "'Geist Mono', monospace",
    cursor: 'pointer', transition: 'background 120ms, color 120ms, border-color 120ms',
  };
}

function runBtn(colors: ThemeColors, pending: boolean): CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
    padding: '9px 14px', borderRadius: 6, border: `1px solid ${colors.accent}`,
    background: pending ? colors.bg : colors.accent,
    color: pending ? colors.textMuted : colors.bg,
    fontSize: 13, fontWeight: 600, cursor: pending ? 'default' : 'pointer',
    opacity: pending ? 0.8 : 1, transition: 'opacity 120ms, background 120ms',
  };
}

function chip(colors: ThemeColors): CSSProperties {
  return {
    padding: '2px 7px', borderRadius: 4, border: `1px solid ${colors.border}`,
    background: colors.bg, color: colors.textMuted,
    fontSize: 10.5, fontFamily: "'Geist Mono', monospace",
  };
}

function noteBox(colors: ThemeColors): CSSProperties {
  return {
    border: `1px solid ${colors.border}`, borderRadius: 6, padding: '10px 12px',
    background: colors.bg,
  };
}
