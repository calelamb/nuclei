import { useThemeStore } from '../../stores/themeStore';
import type { QecFault, QecMinWeight, QecNondeterministic } from '../../types/qecExplain';

import { MONO, svgDataUrl } from './explainFormat';
import { Button } from '../ui';
import { Table, Thead, Tbody, Tr, Th, Td } from '../ui/Table';

export function JumpButton({
  line,
  disabled,
  onJump,
  label,
  text,
}: {
  line: number | null | undefined;
  disabled: boolean;
  onJump: (line: number) => void;
  /** Accessible name; defaults to "Jump to line N". */
  label?: string;
  /** Visible text; defaults to "line N". */
  text?: string;
}) {
  const colors = useThemeStore((s) => s.colors);
  if (line == null) return <span style={{ color: colors.textDim, fontSize: 11 }}>line unknown</span>;
  return (
    <Button
      size="sm"
      disabled={disabled}
      onClick={() => onJump(line)}
      title={disabled ? 'The editor changed since this analysis; re-run it to jump to source' : `Jump to line ${line}`}
      aria-label={label ?? `Jump to line ${line}`}
      style={{ fontFamily: MONO, height: 20, padding: '0 var(--space-2)' }}
    >
      {text ?? `line ${line}`}
    </Button>
  );
}

function article(basis: string): string {
  return basis.toUpperCase() === 'X' ? 'an' : 'a';
}

function CauseNote({
  cause,
  stale,
  onJump,
}: {
  cause: NonNullable<QecNondeterministic['cause']>;
  stale: boolean;
  onJump: (line: number) => void;
}) {
  const colors = useThemeStore((s) => s.colors);
  const isReset = cause.kind === 'preparation_basis_mismatch';
  const prep = cause.preparation_line;
  const noun = isReset ? 'preparation' : 'measurement';
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 11, color: colors.textMuted }}>
      <span>
        {isReset
          ? `Likely cause: not the reset, but ${article(cause.basis)} ${cause.basis}-basis preparation the detector does not match.`
          : `Likely cause: the ${cause.basis}-basis measurement collapses the qubit, so what the detector compares later is random.`}
      </span>
      {prep != null && (
        <JumpButton
          line={prep}
          disabled={stale}
          onJump={onJump}
          label={`Jump to ${noun} at line ${prep}`}
          text={`${noun} · line ${prep}`}
        />
      )}
    </div>
  );
}

function SensitivityList({ data }: { data: QecNondeterministic }) {
  const colors = useThemeStore((s) => s.colors);
  const omitted = data.targets_omitted ?? 0;
  const sensitivities = data.sensitivities ?? [];
  if (sensitivities.length === 0 && omitted === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 11, color: colors.textMuted }}>
      <span>Sensitive to</span>
      {sensitivities.map((s) => (
        <span key={s.target} style={{ fontFamily: MONO }}>
          <span>{s.target}</span>
          {': '}
          <code style={{ color: colors.text }}>{s.pauli}</code>
        </span>
      ))}
      {omitted > 0 && <span>{`and ${omitted} more`}</span>}
    </div>
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
      {bad && Object.keys(data.declaration_lines ?? {}).length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 11, color: colors.textMuted }}>
          <span>Declared at</span>
          {Object.entries(data.declaration_lines ?? {}).map(([target, line]) => (
            <JumpButton
              key={target}
              line={line}
              disabled={stale}
              onJump={onJump}
              label={`Jump to ${target} declaration at line ${line}`}
              text={`${target} · line ${line}`}
            />
          ))}
        </div>
      )}
      {bad && data.cause && <CauseNote cause={data.cause} stale={stale} onJump={onJump} />}
      {bad && <SensitivityList data={data} />}
      {data.diagram_svg && (
        <div style={{ background: '#ffffff', borderRadius: 'var(--radius-xs)', padding: 4, overflow: 'auto', maxHeight: 260 }}>
          <img
            alt="Stim detector slice diagram showing the offending detector and operations"
            src={svgDataUrl(data.diagram_svg)}
            style={{ maxWidth: '100%', display: 'block' }}
          />
        </div>
      )}
      {bad && data.stim_message && (
        <details style={{ fontSize: 11, color: colors.textDim }}>
          <summary style={{ cursor: 'pointer' }}>Stim's own message</summary>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: MONO, margin: '4px 0 0' }}>{data.stim_message}</pre>
        </details>
      )}
    </section>
  );
}

function FaultRow({ fault, stale, onJump }: { fault: QecFault; stale: boolean; onJump: (line: number) => void }) {
  return (
    <Tr>
      <Td numeric>{fault.index + 1}</Td>
      <Td numeric>{fault.tick ?? '—'}</Td>
      <Td>{fault.iteration != null ? `iter ${fault.iteration}` : '—'}</Td>
      <Td>{fault.qubits.length ? fault.qubits.join(', ') : '—'}</Td>
      <Td>{fault.pauli ?? '—'}</Td>
      <Td title={fault.instruction ?? undefined}>{fault.gate ?? 'not located'}</Td>
      <Td text>
        {fault.located ? <JumpButton line={fault.line} disabled={stale} onJump={onJump} /> : '—'}
      </Td>
    </Tr>
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
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: found ? colors.textMuted : colors.warning }}>
        {data.sentence}
      </p>
      {found && data.faults.length > 0 && (
        <Table label="Minimum-weight fault chain" dense>
          <Thead>
            <Tr>
              <Th numeric>#</Th>
              <Th numeric>tick</Th>
              <Th>REPEAT</Th>
              <Th>qubits</Th>
              <Th>flip</Th>
              <Th>gate</Th>
              <Th>source</Th>
            </Tr>
          </Thead>
          <Tbody>
            {data.faults.map((f) => (
              <FaultRow key={f.index} fault={f} stale={stale} onJump={onJump} />
            ))}
          </Tbody>
        </Table>
      )}
    </section>
  );
}
