import { useState, useCallback } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useEditorStore } from '../../stores/editorStore';
import type { Framework } from '../../types/quantum';

// The Quantum Playground — interactive beginner experience
// UI/UX Pro Max: no emoji icons, SVG only, 150-300ms transitions, 4.5:1 contrast

interface PlaygroundState {
  step: number;
  qubitState: 'zero' | 'one' | 'superposition' | 'measured';
  measurements: number[];
  secondQubit: boolean;
  entangled: boolean;
}

const STEPS = [
  {
    title: 'Meet the Qubit',
    dirac: "This is a qubit — the basic unit of quantum information. Unlike a regular bit that's either 0 or 1, a qubit can exist in both states at once. Right now it's in the |0⟩ state — think of it as pointing straight up.",
    action: null,
  },
  {
    title: 'Superposition',
    dirac: "Let's put this qubit into superposition. The Hadamard gate (H) takes a qubit from a definite state and puts it halfway between |0⟩ and |1⟩. Watch what happens.",
    action: 'apply_h',
  },
  {
    title: 'Measurement',
    dirac: "Now let's measure it. In quantum mechanics, measurement forces the qubit to 'choose' — it collapses to either |0⟩ or |1⟩. Each has a 50% chance. Click to measure!",
    action: 'measure',
  },
  {
    title: 'Try It Again',
    dirac: "Interesting, right? Let's measure a bunch more times to see the pattern. Each measurement is random, but over many tries, you'll see roughly half 0s and half 1s.",
    action: 'measure_many',
  },
  {
    title: 'Entanglement',
    dirac: "Now for the really mind-bending part. Let's add a second qubit and entangle them using a CNOT gate. When qubits are entangled, measuring one instantly tells you about the other — even across the universe.",
    action: 'entangle',
  },
  {
    title: "You're Ready",
    dirac: "You just built a quantum circuit! You understand qubits, superposition, measurement, and entanglement — the four pillars of quantum computing. Let's see what this looks like in code.",
    action: 'bridge',
  },
];

function QubitViz({ state, size = 120 }: { state: PlaygroundState['qubitState']; size?: number }) {
  const colors = useThemeStore((s) => s.colors);
  const r = size / 2 - 4;

  // State vector position on a simplified 2D Bloch circle
  const angle = state === 'zero' ? -90 : state === 'one' ? 90 : state === 'superposition' ? 0 : (Math.random() > 0.5 ? -90 : 90);
  const rad = (angle * Math.PI) / 180;
  const arrowX = Math.cos(rad) * r * 0.8;
  const arrowY = Math.sin(rad) * r * 0.8;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Circle */}
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={colors.border} strokeWidth={1.5}
        opacity={0.4}
      />
      {/* Axis labels */}
      <text x={size / 2} y={12} textAnchor="middle" fill={colors.textMuted} fontSize={10} fontFamily="'IBM Plex Sans', Inter, sans-serif">|0⟩</text>
      <text x={size / 2} y={size - 4} textAnchor="middle" fill={colors.textMuted} fontSize={10} fontFamily="'IBM Plex Sans', Inter, sans-serif">|1⟩</text>
      {/* State arrow */}
      <line
        x1={size / 2} y1={size / 2}
        x2={size / 2 + arrowX} y2={size / 2 + arrowY}
        stroke={state === 'superposition' ? '#00B4D8' : state === 'measured' ? '#98C379' : colors.accent}
        strokeWidth={2.5}
        strokeLinecap="round"
        style={{ transition: 'all 300ms cubic-bezier(0.4, 0, 0.2, 1)' }}
      />
      {/* Glow at tip */}
      <circle
        cx={size / 2 + arrowX} cy={size / 2 + arrowY}
        r={4}
        fill={state === 'superposition' ? '#00B4D8' : '#98C379'}
        opacity={0.8}
        style={{ transition: 'all 300ms cubic-bezier(0.4, 0, 0.2, 1)' }}
      />
    </svg>
  );
}

function MiniHistogram({ measurements }: { measurements: number[] }) {
  const colors = useThemeStore((s) => s.colors);
  const total = measurements.length;
  if (total === 0) return null;

  const zeros = measurements.filter((m) => m === 0).length;
  const ones = total - zeros;
  const maxH = 60;
  const h0 = total > 0 ? (zeros / total) * maxH : 0;
  const h1 = total > 0 ? (ones / total) * maxH : 0;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: maxH + 30 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <div style={{
          width: 36, height: h0, background: colors.accent,
          borderRadius: '4px 4px 0 0',
          transition: 'height 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        }} />
        <span style={{ color: colors.text, fontSize: 11, fontFamily: "'IBM Plex Sans', sans-serif" }}>|0⟩</span>
        <span style={{ color: colors.textMuted, fontSize: 10 }}>{zeros}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <div style={{
          width: 36, height: h1, background: '#7B2D8E',
          borderRadius: '4px 4px 0 0',
          transition: 'height 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        }} />
        <span style={{ color: colors.text, fontSize: 11, fontFamily: "'IBM Plex Sans', sans-serif" }}>|1⟩</span>
        <span style={{ color: colors.textMuted, fontSize: 10 }}>{ones}</span>
      </div>
    </div>
  );
}

interface PlaygroundProps {
  onComplete: () => void;
  onBridgeToIDE: () => void;
}

export function QuantumPlayground({ onComplete, onBridgeToIDE }: PlaygroundProps) {
  const colors = useThemeStore((s) => s.colors);
  const [pg, setPg] = useState<PlaygroundState>({
    step: 0,
    qubitState: 'zero',
    measurements: [],
    secondQubit: false,
    entangled: false,
  });

  const currentStep = STEPS[pg.step];

  const handleAction = useCallback(() => {
    const action = currentStep?.action;
    if (action === 'apply_h') {
      setPg((s) => ({ ...s, qubitState: 'superposition', step: s.step + 1 }));
    } else if (action === 'measure') {
      const result = Math.random() > 0.5 ? 1 : 0;
      setPg((s) => ({
        ...s,
        qubitState: 'measured',
        measurements: [...s.measurements, result],
        step: s.step + 1,
      }));
    } else if (action === 'measure_many') {
      // Add 10 measurements
      const newMeasurements = Array.from({ length: 10 }, () => Math.random() > 0.5 ? 1 : 0);
      setPg((s) => ({
        ...s,
        measurements: [...s.measurements, ...newMeasurements],
        step: s.step + 1,
      }));
    } else if (action === 'entangle') {
      setPg((s) => ({ ...s, secondQubit: true, entangled: true, step: s.step + 1 }));
    } else if (action === 'bridge') {
      onBridgeToIDE();
    } else {
      setPg((s) => ({ ...s, step: s.step + 1 }));
    }
  }, [currentStep, onBridgeToIDE]);

  const isLastStep = pg.step >= STEPS.length - 1;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 4000,
      background: `linear-gradient(135deg, ${colors.bg} 0%, #080E18 100%)`,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 32,
    }}>
      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 32, position: 'absolute', top: 32 }}>
        {STEPS.map((_, i) => (
          <div key={i} style={{
            width: i <= pg.step ? 32 : 20, height: 3, borderRadius: 2,
            background: i <= pg.step ? colors.accent : colors.border,
            transition: 'all 300ms cubic-bezier(0.4, 0, 0.2, 1)',
          }} />
        ))}
      </div>

      {/* Skip button */}
      <button
        onClick={onComplete}
        style={{
          position: 'absolute', top: 32, right: 32,
          background: 'none', border: 'none',
          color: colors.textMuted, cursor: 'pointer',
          fontSize: 13, fontFamily: "'IBM Plex Sans', sans-serif",
        }}
        aria-label="Skip onboarding"
      >
        Skip
      </button>

      {/* Main content */}
      <div style={{ maxWidth: 560, width: '100%', textAlign: 'center' }}>
        <h1 style={{
          color: colors.accent, fontSize: 28, fontWeight: 700,
          fontFamily: "'IBM Plex Sans', Inter, sans-serif",
          marginBottom: 16,
        }}>
          {currentStep?.title}
        </h1>

        {/* Qubit visualization */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 32, margin: '24px 0',
        }}>
          <QubitViz state={pg.qubitState} />
          {pg.secondQubit && <QubitViz state={pg.entangled ? pg.qubitState : 'zero'} />}
          {pg.measurements.length > 0 && <MiniHistogram measurements={pg.measurements} />}
        </div>

        {/* Dirac speech */}
        <div style={{
          background: colors.bgPanel,
          borderLeft: `3px solid #7B2D8E`,
          borderRadius: '0 8px 8px 0',
          padding: '16px 20px',
          textAlign: 'left',
          marginBottom: 24,
        }}>
          <span style={{ color: '#7B2D8E', fontSize: 12, fontWeight: 600, fontFamily: "'IBM Plex Sans', sans-serif", display: 'block', marginBottom: 6 }}>
            Dirac
          </span>
          <p style={{
            color: colors.text, fontSize: 15,
            fontFamily: "'IBM Plex Sans', Inter, sans-serif",
            lineHeight: 1.7, margin: 0,
          }}>
            {currentStep?.dirac}
          </p>
        </div>

        {/* Action button */}
        <button
          onClick={handleAction}
          style={{
            padding: '12px 32px',
            background: isLastStep ? `linear-gradient(135deg, #00B4D8, #7B2D8E)` : colors.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 16,
            fontWeight: 600,
            fontFamily: "'IBM Plex Sans', Inter, sans-serif",
            transition: 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 200ms',
          }}
          onMouseDown={(e) => { (e.target as HTMLElement).style.transform = 'scale(0.97)'; }}
          onMouseUp={(e) => { (e.target as HTMLElement).style.transform = 'scale(1)'; }}
          onMouseLeave={(e) => { (e.target as HTMLElement).style.transform = 'scale(1)'; }}
          aria-label={isLastStep ? 'Open the IDE' : 'Continue'}
        >
          {isLastStep ? 'Open the IDE →' : currentStep?.action ? 'Try it' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
