import { useState } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useEditorStore } from '../../stores/editorStore';
import type { Framework } from '../../types/quantum';

const STEPS = [
  {
    title: 'Welcome to Nuclei',
    body: 'Nuclei is a quantum computing IDE built for learners. Write quantum code, see live circuit diagrams, visualize qubit states on the Bloch sphere, and get help from Dirac — your AI tutor.',
  },
  {
    title: 'Set Up Dirac AI',
    body: 'Dirac is powered by Claude. To enable Dirac, you\'ll need a Claude API key. You can set it up in the Dirac AI tab in the bottom panel. Dirac can explain circuits, write code, and give you exercises.',
    isApiKeyStep: true,
  },
  {
    title: 'Choose a Framework',
    body: 'Nuclei supports Qiskit, Cirq, and CUDA-Q. Pick the one used in your course (Qiskit is most common). You can switch anytime from the status bar.',
    isFrameworkStep: true,
  },
  {
    title: 'Your IDE Tour',
    body: `Here's your workspace:\n\n• Left panel — Code editor (write Python here)\n• Top-right — Circuit diagram (updates live as you type)\n• Bottom-right — Bloch sphere (shows qubit states after simulation)\n• Bottom tabs — Terminal, Histogram, and Dirac AI chat\n\nPress ⌘+Enter to run your circuit.`,
  },
  {
    title: 'Let\'s Build a Bell State!',
    body: 'A Bell state is the simplest entangled circuit — two qubits that are perfectly correlated. The starter code is already loaded. Press ⌘+Enter to simulate it and see the results!',
    isFinalStep: true,
  },
];

interface OnboardingProps {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [selectedFramework, setSelectedFramework] = useState<Framework>('qiskit');
  const colors = useThemeStore((s) => s.colors);
  const setFramework = useEditorStore((s) => s.setFramework);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const handleNext = () => {
    if (current.isFrameworkStep) {
      setFramework(selectedFramework);
    }
    if (isLast) {
      onComplete();
    } else {
      setStep(step + 1);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 3000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)',
      backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 12,
        padding: 32,
        maxWidth: 480,
        width: '90%',
      }}>
        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              background: i <= step ? colors.accent : colors.border,
              transition: 'background 0.3s',
            }} />
          ))}
        </div>

        <div style={{ color: colors.accent, fontSize: 22, fontWeight: 700, fontFamily: 'Inter, sans-serif', marginBottom: 8 }}>
          {current.title}
        </div>

        <div style={{
          color: colors.text,
          fontSize: 14,
          fontFamily: 'Inter, sans-serif',
          lineHeight: 1.7,
          marginBottom: 24,
          whiteSpace: 'pre-line',
        }}>
          {current.body}
        </div>

        {/* Framework selector step */}
        {current.isFrameworkStep && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {(['qiskit', 'cirq', 'cuda-q'] as Framework[]).map((fw) => (
              <button
                key={fw}
                onClick={() => setSelectedFramework(fw)}
                style={{
                  flex: 1,
                  padding: '10px 8px',
                  background: selectedFramework === fw ? colors.accent : colors.bgPanel,
                  color: selectedFramework === fw ? '#fff' : colors.text,
                  border: `1px solid ${selectedFramework === fw ? colors.accent : colors.border}`,
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 13,
                  fontFamily: 'Inter, sans-serif',
                  fontWeight: selectedFramework === fw ? 600 : 400,
                }}
              >
                {fw === 'cuda-q' ? 'CUDA-Q' : fw.charAt(0).toUpperCase() + fw.slice(1)}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {step > 0 ? (
            <button
              onClick={() => setStep(step - 1)}
              style={{
                padding: '8px 16px',
                background: 'transparent',
                color: colors.textMuted,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
                fontFamily: 'Inter, sans-serif',
              }}
            >
              Back
            </button>
          ) : (
            <button
              onClick={onComplete}
              style={{
                padding: '8px 16px',
                background: 'transparent',
                color: colors.textMuted,
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                fontFamily: 'Inter, sans-serif',
              }}
            >
              Skip
            </button>
          )}
          <button
            onClick={handleNext}
            style={{
              padding: '10px 24px',
              background: colors.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 14,
              fontFamily: 'Inter, sans-serif',
              fontWeight: 600,
            }}
          >
            {isLast ? 'Start Coding!' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
