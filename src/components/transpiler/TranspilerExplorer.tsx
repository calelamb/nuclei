import { type CSSProperties } from 'react';
import { Shuffle, Loader2, HelpCircle } from 'lucide-react';
import { useThemeStore, type ThemeColors } from '../../stores/themeStore';
import { useEditorStore } from '../../stores/editorStore';
import { useTranspileStore } from '../../stores/transpileStore';
import { RunCircuitDiagram } from '../experiments/RunCircuitDiagram';
import type { TranspileMetricDelta, TranspilePass, TranspileResult } from '../../types/quantum';
import {
  formatSigned,
  deltaTone,
  totalAddedGates,
  isEntanglingPass,
  formatAddedGates,
} from './transpileMath';

const DOCS = 'https://getnuclei.dev/docs/developer-tools/transpiler-explorer/';

/**
 * Dev tools Phase 1 — the Transpiler Explorer main view ("godbolt for
 * quantum"): the circuit in the editor, transpiled for a target, shown
 * before vs. after with pass-by-pass attribution of the gates and SWAPs the
 * compiler added. Controls (target, opt level, Transpile) live in the sidebar
 * (`TranspilerControls`); this reads the shared `transpileStore`.
 */
export function TranspilerExplorer() {
  const colors = useThemeStore((s) => s.colors);
  const framework = useEditorStore((s) => s.framework);
  const result = useTranspileStore((s) => s.result);
  const pending = useTranspileStore((s) => s.pending);
  const error = useTranspileStore((s) => s.error);

  const isQiskit = framework === 'qiskit';

  return (
    <div style={shell(colors)}>
      <div style={toolbar(colors)}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600 }}>
          <Shuffle size={14} /> Transpiler Explorer
        </span>
        <div style={{ flex: 1 }} />
        <a href={DOCS} target="_blank" rel="noreferrer" title="Transpiler Explorer docs" style={iconBtn(colors)}>
          <HelpCircle size={13} />
        </a>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>
        {!isQiskit ? (
          <Centered colors={colors}
            title="Transpiler Explorer needs Qiskit"
            body={`The active buffer is ${framework}. Qiskit is the only framework with an introspectable compiler, so the pass-by-pass view is Qiskit-only.`}
          />
        ) : pending ? (
          <Centered colors={colors}
            icon={<Loader2 size={20} style={{ animation: 'nuclei-spin 800ms linear infinite' }} />}
            title="Transpiling…"
            body="Running the preset pass manager and capturing each pass."
          />
        ) : error ? (
          <div style={errorBox(colors)}>{error}</div>
        ) : !result ? (
          <Centered colors={colors}
            title="Choose a target and Transpile"
            body="Pick a target device and optimization level in the sidebar, then Transpile to see what the compiler does to this circuit — before vs. after, pass by pass."
          />
        ) : (
          <ResultView result={result} />
        )}
      </div>
    </div>
  );
}

function ResultView({ result }: { result: TranspileResult }) {
  const colors = useThemeStore((s) => s.colors);
  const { before, after, metrics, passes, target } = result;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Before / after diagrams, side by side, each with its metric strip. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Side colors={colors} caption="Before — logical">
          <RunCircuitDiagram snapshot={before} />
          <MetricStrip colors={colors} metrics={metrics} which="before" />
        </Side>
        <Side colors={colors} caption={
          target.basis_gates
            ? `After — ${target.coupling_size > 0 ? 'routed · ' : ''}${target.basis_gates.length} basis gates`
            : 'After — optimized'
        }>
          <RunCircuitDiagram snapshot={after} />
          <MetricStrip colors={colors} metrics={metrics} which="after" />
        </Side>
      </div>

      {/* Pass list — the compiler passes that changed the circuit, with the
          entangling/routing passes emphasised (the "why did it grow" answer). */}
      <div>
        <div style={sectionHead(colors)}>
          Compiler passes
          <span style={{ color: colors.textDim, fontWeight: 400 }}> · {passes.length} changed the circuit</span>
        </div>
        {passes.length === 0 ? (
          <div style={{ fontSize: 12, color: colors.textMuted, padding: '8px 0' }}>
            No pass changed the gate makeup — the circuit already met the target's constraints.
          </div>
        ) : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {passes.map((pass, i) => (
              <PassRow key={`${pass.name}-${i}`} pass={pass} index={i + 1} />
            ))}
          </ol>
        )}
      </div>

      {target.basis_gates && (
        <div style={{ fontSize: 11, color: colors.textDim }}>
          Basis:{' '}
          {target.basis_gates.map((g) => (
            <span key={g} style={chip(colors)}>{g}</span>
          ))}
          {target.coupling_size > 0 && (
            <span style={{ marginLeft: 8 }}>· coupling edges: {target.coupling_size}</span>
          )}
        </div>
      )}
    </div>
  );
}

function PassRow({ pass, index }: { pass: TranspilePass; index: number }) {
  const colors = useThemeStore((s) => s.colors);
  const entangling = isEntanglingPass(pass);
  const net = totalAddedGates(pass);

  return (
    <li style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '6px 10px', borderRadius: 5,
      border: `1px solid ${entangling ? colors.accent : colors.border}`,
      background: entangling ? `${colors.accent}12` : 'transparent',
    }}>
      <span style={{ width: 20, textAlign: 'right', fontSize: 11, color: colors.textDim, fontFamily: "'Geist Mono', monospace" }}>
        {index}
      </span>
      <span style={{ flex: 1, fontSize: 12.5, color: colors.text, fontWeight: entangling ? 600 : 400 }}>
        {pass.name}
        {entangling && (
          <span style={{ marginLeft: 8, fontSize: 10.5, color: colors.accent, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            routing
          </span>
        )}
      </span>
      <span style={{ fontSize: 11.5, fontFamily: "'Geist Mono', monospace", color: colors.textMuted }}>
        {formatAddedGates(pass)}
      </span>
      <span style={{
        width: 40, textAlign: 'right', fontSize: 11.5, fontFamily: "'Geist Mono', monospace",
        color: net > 0 ? colors.accent : net < 0 ? colors.textDim : colors.textMuted,
      }}>
        {formatSigned(net)}
      </span>
    </li>
  );
}

function MetricStrip({
  colors, metrics, which,
}: {
  colors: ThemeColors;
  metrics: TranspileResult['metrics'];
  which: 'before' | 'after';
}) {
  const cells: Array<{ label: string; delta: TranspileMetricDelta }> = [
    { label: 'depth', delta: metrics.depth },
    { label: '2q', delta: metrics.two_qubit },
    { label: 'gates', delta: metrics.gate_count },
  ];
  return (
    <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
      {cells.map(({ label, delta }) => {
        const value = which === 'before' ? delta.before : delta.after;
        const showDelta = which === 'after' && delta.after !== delta.before;
        const tone = deltaTone(delta.before, delta.after);
        return (
          <span key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 4, fontSize: 12 }}>
            <span style={{ fontFamily: "'Geist Mono', monospace", fontWeight: 600, color: colors.text }}>{value}</span>
            <span style={{ fontSize: 10.5, color: colors.textDim, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</span>
            {showDelta && (
              <span style={{
                fontSize: 10.5, fontFamily: "'Geist Mono', monospace",
                color: tone === 'increase' ? colors.accent : colors.textDim,
              }}>
                {formatSigned(delta.after - delta.before)}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function Side({ colors, caption, children }: { colors: ThemeColors; caption: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ fontSize: 11, color: colors.textDim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {caption}
      </div>
      <div style={{ border: `1px solid ${colors.border}`, borderRadius: 6, padding: 8, background: colors.bg }}>
        {children}
      </div>
    </div>
  );
}

function Centered({ colors, icon, title, body }: {
  colors: ThemeColors; icon?: React.ReactNode; title: string; body: string;
}) {
  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', textAlign: 'center', gap: 8, padding: 24,
      color: colors.textMuted,
    }}>
      {icon && <div style={{ color: colors.accent }}>{icon}</div>}
      <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>{title}</div>
      <div style={{ fontSize: 12.5, maxWidth: 420, lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}

function shell(colors: ThemeColors): CSSProperties {
  return {
    height: '100%', display: 'flex', flexDirection: 'column',
    background: colors.bg, color: colors.text, fontFamily: "'Geist Sans', sans-serif",
  };
}

function toolbar(colors: ThemeColors): CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
    borderBottom: `1px solid ${colors.border}`, flexShrink: 0,
  };
}

function iconBtn(colors: ThemeColors): CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px',
    borderRadius: 5, border: `1px solid ${colors.border}`,
    background: 'transparent', color: colors.textMuted, fontSize: 11, cursor: 'pointer',
  };
}

function errorBox(colors: ThemeColors): CSSProperties {
  return {
    border: `1px solid ${colors.error}`, borderRadius: 6, padding: '10px 12px',
    fontSize: 12.5, color: colors.error, lineHeight: 1.45,
  };
}

function sectionHead(colors: ThemeColors): CSSProperties {
  return {
    fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 8,
    textTransform: 'uppercase', letterSpacing: '0.04em',
  };
}

function chip(colors: ThemeColors): CSSProperties {
  return {
    display: 'inline-block', margin: '0 3px', padding: '1px 6px', borderRadius: 4,
    border: `1px solid ${colors.border}`, background: colors.bg, color: colors.textMuted,
    fontSize: 10.5, fontFamily: "'Geist Mono', monospace",
  };
}
