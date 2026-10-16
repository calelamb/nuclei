import { useThemeStore } from '../../stores/themeStore';
import type { QecFault, QecMinWeight, QecNondeterministic } from '../../types/qecExplain';

import { MONO, svgDataUrl } from './explainFormat';

export function JumpButton({
  line,
  disabled,
  onJump,
}: {
  line: number | null | undefined;
  disabled: boolean;
  onJump: (line: number) => void;
}) {
  const colors = useThemeStore((s) => s.colors);
  if (line == null) return <span style={{ color: colors.textDim, fontSize: 10 }}>line unknown</span>;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onJump(line)}
      title={disabled ? 'The editor changed since this analysis; re-run it to jump to source' : `Jump to line ${line}`}
      aria-label={`Jump to line ${line}`}
      style={{
        background: 'transparent', border: `1px solid ${colors.border}`, borderRadius: 4,
        color: disabled ? colors.textDim : colors.accent, cursor: disabled ? 'default' : 'pointer',
        fontSize: 10.5, padding: '1px 6px', fontFamily: MONO,
      }}
    >
      line {line}
    </button>
  );
}

export function NondeterministicSection({
  data,
  stale,
  onJump,
}: {
  data: QecNondeterministic;
  stale: boolean;
  onJump: (line: number) => void;
}) {
  const colors = useThemeStore((s) => s.colors);
  const bad = data.status !== 'ok';
  return (
    <section aria-label="Determinism check" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted }}>Detector determinism</div>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: bad ? colors.error : colors.success }}>
        {data.sentence}
      </p>
      {bad && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 11 }}>
          <JumpButton line={data.line} disabled={stale} onJump={onJump} />
          {data.line_text && <code style={{ fontFamily: MONO, color: colors.text }}>{data.line_text}</code>}
        </div>
      )}
      {data.diagram_svg && (
        <div style={{ background: '#ffffff', borderRadius: 4, padding: 4, overflow: 'auto', maxHeight: 260 }}>
          <img
            alt="Stim detector slice diagram showing the offending detector and operations"
            src={svgDataUrl(data.diagram_svg)}
            style={{ maxWidth: '100%', display: 'block' }}
          />
        </div>
      )}
      {bad && data.stim_message && (
        <details style={{ fontSize: 10.5, color: colors.textDim }}>
          <summary style={{ cursor: 'pointer' }}>Stim's own message</summary>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: MONO, margin: '4px 0 0' }}>{data.stim_message}</pre>
        </details>
      )}
    </section>
  );
}

function FaultRow({ fault, stale, onJump }: { fault: QecFault; stale: boolean; onJump: (line: number) => void }) {
  const colors = useThemeStore((s) => s.colors);
  const cell = { padding: '3px 6px', borderBottom: `1px solid ${colors.border}`, fontFamily: MONO };
  return (
    <tr>
      <td style={cell}>{fault.index + 1}</td>
      <td style={cell}>{fault.tick ?? '—'}</td>
      <td style={cell}>{fault.qubits.length ? fault.qubits.join(', ') : '—'}</td>
      <td style={cell}>{fault.pauli ?? '—'}</td>
      <td style={cell} title={fault.instruction ?? undefined}>{fault.gate ?? 'not located'}</td>
      <td style={cell}>
        {fault.located ? <JumpButton line={fault.line} disabled={stale} onJump={onJump} /> : '—'}
      </td>
    </tr>
  );
}

export function MinWeightSection({
  data,
  stale,
  onJump,
}: {
  data: QecMinWeight;
  stale: boolean;
  onJump: (line: number) => void;
}) {
  const colors = useThemeStore((s) => s.colors);
  const found = data.status === 'ok' && data.weight != null;
  const head = { textAlign: 'left' as const, padding: '3px 6px', color: colors.textDim, fontWeight: 500 };
  return (
    <section aria-label="Minimum-weight logical error" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted }}>Minimum-weight logical error</div>
      {found && (
        <div style={{ fontSize: 12, color: colors.text }}>
          <strong>Weight {data.weight}</strong>
          <span style={{ color: colors.textDim }}>
            {' '}· upper bound on circuit-level distance · {data.num_detectors} detectors · {data.num_observables}{' '}
            observable{data.num_observables === 1 ? '' : 's'}
          </span>
        </div>
      )}
      <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: found ? colors.textMuted : colors.warning }}>
        {data.sentence}
      </p>
      {found && data.faults.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%', color: colors.text }}>
            <thead>
              <tr>
                <th style={head}>#</th>
                <th style={head}>tick</th>
                <th style={head}>qubits</th>
                <th style={head}>flip</th>
                <th style={head}>gate</th>
                <th style={head}>source</th>
              </tr>
            </thead>
            <tbody>
              {data.faults.map((f) => (
                <FaultRow key={f.index} fault={f} stale={stale} onJump={onJump} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
