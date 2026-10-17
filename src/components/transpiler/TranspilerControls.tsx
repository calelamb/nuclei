import { type CSSProperties } from 'react';
import { Shuffle } from 'lucide-react';
import { Button, Select, SegmentedControl } from '../ui';
import { useThemeStore, type ThemeColors } from '../../stores/themeStore';
import { useEditorStore } from '../../stores/editorStore';
import { useHardwareStore } from '../../stores/hardwareStore';
import { useTranspileStore, SIMULATOR_TARGET_ID } from '../../stores/transpileStore';
import { requestTranspile } from '../../lib/transpileSender';
import { ConnectivityMap } from '../hardware/ConnectivityMap';
import { resolveTargetRequest } from './transpileMath';

import { TYPOGRAPHY } from '../../styles/tokens';
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
    fontFamily: TYPOGRAPHY.fontSans, color: colors.text,
  };

  if (!isQiskit) {
    return (
      <div style={shell}>
        <div style={noteBox(colors)}>
          <strong style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
            Transpiler Explorer needs Qiskit
          </strong>
          <span style={{ fontSize: 12, color: colors.textMuted, lineHeight: 1.5 }}>
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
        <Select value={targetId} onChange={(e) => setTarget(e.target.value)} aria-label="Transpile target" style={{ display: 'flex' }}>
          <option value={SIMULATOR_TARGET_ID}>Simulator (all-to-all)</option>
          {backends.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name} · {b.qubitCount}q
            </option>
          ))}
        </Select>
      </label>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={{ fontSize: 11, color: colors.textDim }}>Optimization level</span>
        <SegmentedControl
          block
          aria-label="Optimization level"
          value={String(optimizationLevel)}
          options={OPT_LEVELS.map((lvl) => ({ value: String(lvl), label: String(lvl) }))}
          onChange={(v) => setOptimizationLevel(Number(v) as 0 | 1 | 2 | 3)}
        />
      </div>

      <Button variant="primary" onClick={run} loading={pending} icon={pending ? undefined : <Shuffle size={14} />}>
        {pending ? 'Transpiling…' : result ? 'Re-transpile' : 'Transpile'}
      </Button>

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
          <a href={DOCS} target="_blank" rel="noreferrer" style={{ color: colors.accentText }}>
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

function chip(colors: ThemeColors): CSSProperties {
  return {
    padding: '2px 7px', borderRadius: 4, border: `1px solid ${colors.border}`,
    background: colors.bg, color: colors.textMuted,
    fontSize: 11, fontFamily: TYPOGRAPHY.fontMono,
  };
}

function noteBox(colors: ThemeColors): CSSProperties {
  return {
    border: `1px solid ${colors.border}`, borderRadius: 6, padding: '10px 12px',
    background: colors.bg,
  };
}
