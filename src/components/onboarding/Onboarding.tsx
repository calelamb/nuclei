import { useState } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { QuantumPlayground } from './QuantumPlayground';

// UI/UX Pro Max: no emoji icons, 4.5:1 contrast, 150-300ms transitions, cursor-pointer on clickables

type OnboardingPath = 'welcome' | 'beginner' | 'intermediate' | 'experienced';

interface OnboardingProps {
  onComplete: (path: OnboardingPath) => void;
}

function WelcomeScreen({ onSelect }: { onSelect: (path: OnboardingPath) => void }) {
  const colors = useThemeStore((s) => s.colors);

  const paths: Array<{ id: OnboardingPath; title: string; description: string; accent: string }> = [
    { id: 'beginner', title: "I'm brand new", description: 'Never done quantum computing? Start with an interactive playground — no code required.', accent: '#00B4D8' },
    { id: 'intermediate', title: 'I know some quantum', description: 'Familiar with qubits and gates? Jump into the IDE with a quick intro to Dirac, your AI tutor.', accent: '#7B2D8E' },
    { id: 'experienced', title: "I'm experienced", description: 'Ready to code? Go straight to the editor with all features enabled.', accent: '#98C379' },
  ];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 4000,
      background: `linear-gradient(180deg, ${colors.bg} 0%, #080E18 100%)`,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 32,
    }}>
      <div style={{ maxWidth: 520, width: '100%', textAlign: 'center' }}>
        {/* Logo */}
        <div style={{
          color: colors.accent, fontSize: 40, fontWeight: 800,
          fontFamily: "'IBM Plex Sans', Inter, sans-serif",
          letterSpacing: -1,
          marginBottom: 8,
        }}>
          NUCLEI
        </div>
        <p style={{
          color: colors.textMuted, fontSize: 16,
          fontFamily: "'IBM Plex Sans', Inter, sans-serif",
          marginBottom: 40, lineHeight: 1.6,
        }}>
          Ready to explore quantum computing?
        </p>

        {/* Path selection */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {paths.map((path) => (
            <button
              key={path.id}
              onClick={() => onSelect(path.id)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                padding: '16px 20px',
                background: colors.bgPanel,
                border: `1px solid ${colors.border}`,
                borderLeft: `3px solid ${path.accent}`,
                borderRadius: '0 8px 8px 0',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'border-color 200ms, background 200ms',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = colors.border;
                (e.currentTarget as HTMLElement).style.borderColor = path.accent;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = colors.bgPanel;
                (e.currentTarget as HTMLElement).style.borderColor = colors.border;
              }}
              aria-label={path.title}
            >
              <span style={{
                color: colors.text, fontSize: 16, fontWeight: 600,
                fontFamily: "'IBM Plex Sans', Inter, sans-serif",
              }}>
                {path.title}
              </span>
              <span style={{
                color: colors.textMuted, fontSize: 13,
                fontFamily: "'IBM Plex Sans', Inter, sans-serif",
                marginTop: 4, lineHeight: 1.5,
              }}>
                {path.description}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [screen, setScreen] = useState<'welcome' | 'playground'>('welcome');

  const handleSelect = (path: OnboardingPath) => {
    if (path === 'beginner') {
      setScreen('playground');
    } else {
      onComplete(path);
    }
  };

  if (screen === 'playground') {
    return (
      <QuantumPlayground
        onComplete={() => onComplete('beginner')}
        onBridgeToIDE={() => onComplete('beginner')}
      />
    );
  }

  return <WelcomeScreen onSelect={handleSelect} />;
}
