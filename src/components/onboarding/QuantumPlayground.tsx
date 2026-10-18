import { useState, useCallback, useEffect, useRef } from 'react';
import { advance, initialState, tally, arrowAngle, type Outcome, type PairResult, type QubitKind } from './playgroundModel';
import { useThemeStore } from '../../stores/themeStore';
import { useEditorStore } from '../../stores/editorStore';
import { EASING, DURATION, getDuration, prefersReducedMotion } from '../../lib/animations';

import { TYPOGRAPHY } from '../../styles/tokens';
import { Button } from '../ui';
import { useFocusTrap } from '../../hooks/useFocusTrap';
const BELL_STATE_CODE = `from qiskit import QuantumCircuit

# Bell State — the circuit you just built!
qc = QuantumCircuit(2, 2)
qc.h(0)          # Hadamard: put qubit 0 in superposition
qc.cx(0, 1)      # CNOT: entangle qubit 0 and qubit 1
qc.measure([0, 1], [0, 1])
`;

const STEPS = [
  {
    title: 'Meet the Qubit',
    dirac: "This is a qubit — the basic unit of quantum information. Unlike a regular bit that's either 0 or 1, a qubit can exist in both states at once. Right now it's in the |0⟩ state — think of it as pointing straight up.",
    action: null,
    buttonLabel: 'Continue',
  },
  {
    title: 'Superposition',
    dirac: "Let's put this qubit into superposition. The Hadamard gate (H) takes a qubit from a definite state and puts it halfway between |0⟩ and |1⟩. Watch what happens.",
    action: 'apply_h' as const,
    buttonLabel: 'Apply H Gate',
  },
  {
    title: 'Measurement',
    dirac: "Now let's measure it. In quantum mechanics, measurement forces the qubit to 'choose' — it collapses to either |0⟩ or |1⟩. Each has a 50% chance.",
    action: 'measure' as const,
    buttonLabel: 'Measure',
  },
  {
    title: 'See the Pattern',
    dirac: "Interesting, right? Let's measure a bunch more times to see the pattern. Each measurement is random, but over many tries, you'll see roughly half 0s and half 1s.",
    action: 'measure_many' as const,
    buttonLabel: 'Measure 10 Times',
  },
  {
    title: 'Entanglement',
    dirac: "Now for the mind-bending part. Let's add a second qubit and entangle them using a CNOT gate. When qubits are entangled, measuring one instantly tells you about the other.",
    action: 'entangle' as const,
    buttonLabel: 'Entangle qubits',
  },
  {
    title: "You're Ready",
    dirac: "You just built a quantum circuit! You understand qubits, superposition, measurement, and entanglement — the four pillars of quantum computing. Lesson 1 turns it into real code.",
    action: 'bridge' as const,
    buttonLabel: 'Start lesson 1',
  },
];

const LABEL_BAND = 18;
/** The 3:1 control border, so the sphere outline reads in both themes (the card borders do not). */
const OUTLINE = 'var(--color-border-control)';

function QubitViz({ kind, outcome, label, size = 120 }: { kind: QubitKind; outcome: Outcome | null; label?: string; size?: number }) {
  const colors = useThemeStore((s) => s.colors);
  const r = size / 2 - 4;
  // Pole labels live in bands above and below the circle so the arrow tip never covers them.
  const cx = size / 2;
  const cy = size / 2 + LABEL_BAND;
  const height = size + LABEL_BAND * 2;
  const rad = (arrowAngle(kind, outcome) * Math.PI) / 180;
  const arrowX = Math.cos(rad) * r * 0.8;
  const arrowY = Math.sin(rad) * r * 0.8;
  const arrowColor = colors.accent;
  const description = kind === 'measured' ? `measured ${outcome === 1 ? '|1⟩' : '|0⟩'}` : kind;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={size} height={height} viewBox={`0 0 ${size} ${height}`} role="img" aria-label={`Qubit ${description}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={1.5} style={{ stroke: OUTLINE }} />
        <text x={cx} y={LABEL_BAND - 5} textAnchor="middle" fill={colors.textMuted} fontSize={11} fontFamily={TYPOGRAPHY.fontSans}>|0⟩</text>
        <text x={cx} y={height - 5} textAnchor="middle" fill={colors.textMuted} fontSize={11} fontFamily={TYPOGRAPHY.fontSans}>|1⟩</text>
        <line
          x1={cx} y1={cy}
          x2={cx + arrowX} y2={cy + arrowY}
          stroke={arrowColor}
          strokeWidth={2.5}
          strokeLinecap="round"
          style={{ transition: `all ${getDuration(DURATION.slow)}ms ${EASING.enter}` }}
        />
        <circle
          cx={cx + arrowX} cy={cy + arrowY}
          r={4}
          fill={arrowColor}
          opacity={0.8}
          style={{ transition: `all ${getDuration(DURATION.slow)}ms ${EASING.enter}` }}
        />
      </svg>
      {label && (
        <span style={{ color: colors.textMuted, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans }}>{label}</span>
      )}
    </div>
  );
}

const BAR_MAX_PX = 60;

function Bar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const colors = useThemeStore((s) => s.colors);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div
        data-bar-baseline=""
        style={{ display: 'flex', alignItems: 'flex-end', height: BAR_MAX_PX, borderBottom: `1px solid ${OUTLINE}` }}
      >
        <div style={{
          width: 36, height: total > 0 ? (count / total) * BAR_MAX_PX : 0, background: color,
          borderRadius: '4px 4px 0 0',
          transition: `height ${getDuration(DURATION.normal)}ms ${EASING.enter}`,
        }} />
      </div>
      <span style={{ color: colors.text, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans }}>{label}</span>
      <span style={{ color: colors.textMuted, fontSize: 11 }}>{count}</span>
    </div>
  );
}

function MiniHistogram({ shots }: { shots: readonly Outcome[] }) {
  const colors = useThemeStore((s) => s.colors);
  const { zeros, ones, total } = tally(shots);
  if (total === 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: BAR_MAX_PX + 30 }} role="img" aria-label={`Measurement results: |0⟩ ${zeros} times, |1⟩ ${ones} times out of ${total}`}>
      <Bar label="|0⟩" count={zeros} total={total} color={colors.accent} />
      <Bar label="|1⟩" count={ones} total={total} color={colors.basisZ} />
    </div>
  );
}

/** Joint outcomes of the entangled pair: only |00⟩ and |11⟩ ever appear. */
function PairHistogram({ pair }: { pair: PairResult }) {
  const colors = useThemeStore((s) => s.colors);
  const total = pair.counts['00'] + pair.counts['11'];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: BAR_MAX_PX + 30 }} role="img" aria-label={`Joint results: |00⟩ ${pair.counts['00']} times, |11⟩ ${pair.counts['11']} times out of ${total}; |01⟩ and |10⟩ never appear`}>
      <Bar label="|00⟩" count={pair.counts['00']} total={total} color={colors.accent} />
      <Bar label="|11⟩" count={pair.counts['11']} total={total} color={colors.basisZ} />
    </div>
  );
}

interface PlaygroundProps {
  onComplete: () => void;
  onBridgeToIDE: () => void;
}

export function QuantumPlayground({ onComplete, onBridgeToIDE }: PlaygroundProps) {
  const colors = useThemeStore((s) => s.colors);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, { restoreFocus: false, autoFocus: false });
  const setCode = useEditorStore((s) => s.setCode);
  const setFramework = useEditorStore((s) => s.setFramework);
  const [pg, setPg] = useState(initialState);
  const actionRef = useRef<HTMLButtonElement>(null);

  const currentStep = STEPS[pg.step];

  const handleAction = useCallback(() => {
    const action = currentStep?.action ?? null;
    if (action === 'bridge') {
      // Load the Bell state code into the editor before transitioning
      setCode(BELL_STATE_CODE);
      // A generated starter is not the student's own work: closing the tab
      // right after the playground must not prompt about "unsaved changes".
      useEditorStore.getState().setIsDirty(false);
      setFramework('qiskit');
    }
    setPg((s) => advance(s, action, Math.random));
  }, [currentStep, setCode, setFramework]);

  // The primary action, not Skip, takes focus on every step so Enter always moves forward.
  useEffect(() => {
    actionRef.current?.focus();
  }, [pg.step]);

  // When bridging animation completes, transition to IDE
  useEffect(() => {
    if (!pg.bridging) return;
    const delay = prefersReducedMotion() ? 50 : 600;
    const timer = setTimeout(() => {
      onBridgeToIDE();
    }, delay);
    return () => clearTimeout(timer);
  }, [pg.bridging, onBridgeToIDE]);

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Quantum playground" tabIndex={-1} style={{
      position: 'fixed', inset: 0, zIndex: 4000,
      background: `linear-gradient(135deg, ${colors.bg} 0%, ${colors.bgPanel} 100%)`,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 32,
      opacity: pg.bridging ? 0 : 1,
      transform: pg.bridging ? 'scale(1.02)' : 'scale(1)',
      transition: pg.bridging ? `opacity ${getDuration(500)}ms ${EASING.exit}, transform ${getDuration(500)}ms ${EASING.exit}` : 'none',
    }}>
      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 32, position: 'absolute', top: 32 }} role="progressbar" aria-valuenow={pg.step + 1} aria-valuemin={1} aria-valuemax={STEPS.length}>
        {STEPS.map((_, i) => (
          <div key={i} style={{
            width: i <= pg.step ? 32 : 20, height: 3, borderRadius: 2,
            background: i <= pg.step ? colors.accent : colors.border,
            transition: `all ${getDuration(DURATION.slow)}ms ${EASING.enter}`,
          }} />
        ))}
      </div>

      {/* Skip button */}
      <Button
        variant="ghost"
        onClick={onComplete}
        style={{ position: 'absolute', top: 24, right: 24 }}
        aria-label="Skip onboarding"
      >
        Skip
      </Button>

      {/* Main content */}
      <div style={{ maxWidth: 560, width: '100%', textAlign: 'center' }}>
        <h1 style={{
          color: colors.accentText, fontSize: 28, fontWeight: 700,
          fontFamily: TYPOGRAPHY.fontSans,
          marginBottom: 16,
          animation: prefersReducedMotion() ? 'none' : `nuclei-fade-in ${DURATION.slow}ms ${EASING.enter}`,
        }}>
          {currentStep?.title}
        </h1>

        {/* Qubit visualization */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 32, margin: '24px 0',
        }}>
          <QubitViz kind={pg.qubit} outcome={pg.lastOutcome} label={pg.pair ? 'Qubit 0' : undefined} />
          {pg.pair && <QubitViz kind="measured" outcome={pg.pair.last} label="Qubit 1" />}
          {pg.pair ? <PairHistogram pair={pg.pair} /> : <MiniHistogram shots={pg.shots} />}
        </div>

        {/* Dirac speech */}
        <div style={{
          background: colors.bgPanel,
          borderLeft: `3px solid ${colors.dirac}`,
          borderRadius: '0 8px 8px 0',
          padding: '16px 20px',
          textAlign: 'left',
          marginBottom: 24,
          animation: prefersReducedMotion() ? 'none' : `nuclei-slide-up ${DURATION.slow}ms ${EASING.enter}`,
        }}>
          <span style={{ color: colors.diracText, fontSize: 12, fontWeight: 600, fontFamily: TYPOGRAPHY.fontSans, display: 'block', marginBottom: 6 }}>
            Dirac
          </span>
          <p style={{
            color: colors.text, fontSize: 14,
            fontFamily: TYPOGRAPHY.fontSans,
            lineHeight: 1.7, margin: 0,
          }}>
            {currentStep?.dirac}
          </p>
        </div>

        {/* Action button */}
        <Button
          ref={actionRef}
          variant="primary"
          size="lg"
          onClick={handleAction}
          style={{ padding: '0 32px' }}
        >
          {currentStep?.buttonLabel ?? 'Continue'}
        </Button>
      </div>
    </div>
  );
}
