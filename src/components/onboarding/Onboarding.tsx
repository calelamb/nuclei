import { useState } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { QuantumPlayground } from './QuantumPlayground';
import { EASING, DURATION, getDuration, prefersReducedMotion } from '../../lib/animations';

type OnboardingPath = 'welcome' | 'beginner' | 'intermediate' | 'experienced' | 'research';

interface OnboardingProps {
  onComplete: (path: OnboardingPath) => void;
  isReturningUser?: boolean;
  lastOpenedFile?: string;
  daysSinceLastSession?: number;
}

/**
 * PRD 09 A2 — the workspace-mode entry gate. Shown before the existing
 * Learn onboarding for first-time (non-returning) users; no buried
 * settings toggle. Choosing "Learn" continues into the WelcomeScreen below
 * exactly as before (byte-identical Learn experience). Choosing "Research"
 * sets Research mode and completes onboarding directly into the workspace.
 */
function ModeSelectScreen({ onSelectLearn, onSelectResearch }: {
  onSelectLearn: () => void;
  onSelectResearch: () => void;
}) {
  const colors = useThemeStore((s) => s.colors);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const cards: Array<{ id: string; title: string; description: string; accent: string; onSelect: () => void }> = [
    {
      id: 'learn',
      title: 'Learn quantum computing',
      description: 'Guided lessons, challenges, and Dirac as your tutor. Best if you\'re new to quantum computing or taking a course.',
      accent: colors.accent,
      onSelect: onSelectLearn,
    },
    {
      id: 'research',
      title: 'Research workspace',
      description: 'A multi-file workspace for experiments, parameter sweeps, and reproducible runs, with Dirac as a terse collaborator.',
      accent: colors.dirac,
      onSelect: onSelectResearch,
    },
  ];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 4000,
      background: `linear-gradient(180deg, ${colors.bg} 0%, #080E18 100%)`,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 32,
    }}>
      <div style={{ maxWidth: 560, width: '100%', textAlign: 'center' }}>
        <div style={{
          color: colors.accent, fontSize: 40, fontWeight: 800,
          fontFamily: "'Geist Sans', Inter, sans-serif",
          letterSpacing: -1,
          marginBottom: 8,
          animation: prefersReducedMotion() ? 'none' : `nuclei-fade-in ${DURATION.emphasis}ms ${EASING.enter}`,
        }}>
          NUCLEI
        </div>
        <p style={{
          color: colors.textMuted, fontSize: 16,
          fontFamily: "'Geist Sans', Inter, sans-serif",
          marginBottom: 40, lineHeight: 1.6,
        }}>
          What are you here to do?
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {cards.map((card, i) => (
            <button
              key={card.id}
              onClick={card.onSelect}
              onMouseEnter={() => setHoveredId(card.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                padding: '18px 20px',
                background: hoveredId === card.id ? colors.bgElevated : colors.bgPanel,
                border: `1px solid ${hoveredId === card.id ? card.accent : colors.border}`,
                borderLeft: `3px solid ${card.accent}`,
                borderRadius: '0 8px 8px 0',
                cursor: 'pointer',
                textAlign: 'left',
                transition: `border-color ${getDuration(DURATION.normal)}ms, background ${getDuration(DURATION.normal)}ms`,
                animation: prefersReducedMotion() ? 'none' : `nuclei-slide-up ${DURATION.slow}ms ${EASING.enter} ${i * 80}ms both`,
              }}
              aria-label={card.title}
            >
              <span style={{
                color: colors.text, fontSize: 17, fontWeight: 600,
                fontFamily: "'Geist Sans', Inter, sans-serif",
              }}>
                {card.title}
              </span>
              <span style={{
                color: colors.textMuted, fontSize: 13,
                fontFamily: "'Geist Sans', Inter, sans-serif",
                marginTop: 4, lineHeight: 1.5,
              }}>
                {card.description}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function WelcomeScreen({ onSelect }: { onSelect: (path: OnboardingPath) => void }) {
  const colors = useThemeStore((s) => s.colors);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const paths: Array<{ id: OnboardingPath; title: string; description: string; accent: string }> = [
    { id: 'beginner', title: "I'm brand new", description: 'Never done quantum computing? Start with an interactive playground — no code required.', accent: colors.accent },
    { id: 'intermediate', title: 'I know some quantum', description: 'Familiar with qubits and gates? Jump into the IDE with a quick intro to Dirac, your AI tutor.', accent: colors.dirac },
    { id: 'experienced', title: "I'm experienced", description: 'Ready to code? Go straight to the editor with all features enabled.', accent: colors.success },
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
          fontFamily: "'Geist Sans', Inter, sans-serif",
          letterSpacing: -1,
          marginBottom: 8,
          animation: prefersReducedMotion() ? 'none' : `nuclei-fade-in ${DURATION.emphasis}ms ${EASING.enter}`,
        }}>
          NUCLEI
        </div>
        <p style={{
          color: colors.textMuted, fontSize: 16,
          fontFamily: "'Geist Sans', Inter, sans-serif",
          marginBottom: 40, lineHeight: 1.6,
        }}>
          Ready to explore quantum computing?
        </p>

        {/* Path selection */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {paths.map((path, i) => (
            <button
              key={path.id}
              onClick={() => onSelect(path.id)}
              onMouseEnter={() => setHoveredId(path.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                padding: '16px 20px',
                background: hoveredId === path.id ? colors.bgElevated : colors.bgPanel,
                border: `1px solid ${hoveredId === path.id ? path.accent : colors.border}`,
                borderLeft: `3px solid ${path.accent}`,
                borderRadius: '0 8px 8px 0',
                cursor: 'pointer',
                textAlign: 'left',
                transition: `border-color ${getDuration(DURATION.normal)}ms, background ${getDuration(DURATION.normal)}ms`,
                animation: prefersReducedMotion() ? 'none' : `nuclei-slide-up ${DURATION.slow}ms ${EASING.enter} ${i * 80}ms both`,
              }}
              aria-label={path.title}
            >
              <span style={{
                color: colors.text, fontSize: 16, fontWeight: 600,
                fontFamily: "'Geist Sans', Inter, sans-serif",
              }}>
                {path.title}
              </span>
              <span style={{
                color: colors.textMuted, fontSize: 13,
                fontFamily: "'Geist Sans', Inter, sans-serif",
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

function ReturningUserScreen({ onContinue, onStartFresh, lastFile, daysSince }: {
  onContinue: () => void;
  onStartFresh: () => void;
  lastFile?: string;
  daysSince?: number;
}) {
  const colors = useThemeStore((s) => s.colors);

  const greeting = daysSince && daysSince > 7
    ? "It's been a while! Let's get you back up to speed."
    : 'Welcome back!';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 4000,
      background: `linear-gradient(180deg, ${colors.bg} 0%, #080E18 100%)`,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 32,
    }}>
      <div style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
        <div style={{
          color: colors.accent, fontSize: 32, fontWeight: 800,
          fontFamily: "'Geist Sans', Inter, sans-serif",
          letterSpacing: -1,
          marginBottom: 12,
        }}>
          NUCLEI
        </div>
        <p style={{
          color: colors.text, fontSize: 18, fontWeight: 500,
          fontFamily: "'Geist Sans', Inter, sans-serif",
          marginBottom: 8,
        }}>
          {greeting}
        </p>
        {lastFile && (
          <p style={{
            color: colors.textMuted, fontSize: 13,
            fontFamily: "'Geist Sans', Inter, sans-serif",
            marginBottom: 24,
          }}>
            Pick up where you left off?
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
          <button
            onClick={onContinue}
            style={{
              padding: '12px 24px',
              background: colors.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 15,
              fontWeight: 600,
              fontFamily: "'Geist Sans', Inter, sans-serif",
            }}
          >
            {lastFile ? 'Continue where I left off' : 'Open IDE'}
          </button>
          <button
            onClick={onStartFresh}
            style={{
              padding: '10px 24px',
              background: 'transparent',
              color: colors.textMuted,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 13,
              fontFamily: "'Geist Sans', sans-serif",
            }}
          >
            Start fresh
          </button>
        </div>
      </div>
    </div>
  );
}

export function Onboarding({ onComplete, isReturningUser, lastOpenedFile, daysSinceLastSession }: OnboardingProps) {
  const [screen, setScreen] = useState<'mode-select' | 'welcome' | 'playground' | 'returning'>(() =>
    isReturningUser ? 'returning' : 'mode-select'
  );

  const handleSelect = (path: OnboardingPath) => {
    if (path === 'beginner') {
      setScreen('playground');
    } else {
      onComplete(path);
    }
  };

  if (screen === 'returning') {
    return (
      <ReturningUserScreen
        onContinue={() => onComplete('experienced')}
        onStartFresh={() => setScreen('mode-select')}
        lastFile={lastOpenedFile}
        daysSince={daysSinceLastSession}
      />
    );
  }

  if (screen === 'mode-select') {
    return (
      <ModeSelectScreen
        onSelectLearn={() => setScreen('welcome')}
        onSelectResearch={() => onComplete('research')}
      />
    );
  }

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
