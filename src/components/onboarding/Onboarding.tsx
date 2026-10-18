import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { QuantumPlayground } from './QuantumPlayground';
import { EASING, DURATION, prefersReducedMotion } from '../../lib/animations';

import { ArrowLeft } from 'lucide-react';
import { ICON_SIZE, TYPOGRAPHY } from '../../styles/tokens';
import { Button, ChoiceCard } from '../ui';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { isWebBuild } from '../../platform/buildTarget';
import { researchCardDescription } from './researchCardCopy';

type OnboardingPath = 'welcome' | 'beginner' | 'intermediate' | 'experienced' | 'research';

interface OnboardingProps {
  /** `path` is omitted when a returning user continues, so nothing about
   *  their stored preferences is overwritten. */
  onComplete: (path?: OnboardingPath) => void;
  isReturningUser?: boolean;
  lastOpenedFile?: string;
  daysSinceLastSession?: number;
}


interface DialogFrameProps {
  label: string;
  maxWidth: number;
  children: ReactNode;
  /** Escape handler. Omit when the screen has nothing sensible to escape to. */
  onEscape?: () => void;
}

/**
 * Shared modal shell for every onboarding screen: role=dialog + aria-modal,
 * focus trapped inside (and moved to the first card on mount), arrow keys
 * move between choice cards, Escape does whatever the screen says is sensible.
 */
function DialogFrame({ label, maxWidth, children, onEscape }: DialogFrameProps) {
  const colors = useThemeStore((s) => s.colors);
  const rootRef = useRef<HTMLDivElement>(null);
  useFocusTrap(rootRef, { restoreFocus: false });

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && onEscape) {
      e.preventDefault();
      e.stopPropagation();
      onEscape();
      return;
    }
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    const cards = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('.nuclei-choice-card') ?? []);
    const at = cards.indexOf(document.activeElement as HTMLElement);
    if (at < 0 || cards.length === 0) return;
    e.preventDefault();
    cards[(at + step + cards.length) % cards.length].focus();
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed', inset: 0, zIndex: 4000,
        background: `linear-gradient(180deg, ${colors.bg} 0%, ${colors.bgPanel} 100%)`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 32, overflowY: 'auto',
      }}
    >
      <div style={{ maxWidth, width: '100%', textAlign: 'center' }}>{children}</div>
    </div>
  );
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
      description: researchCardDescription(isWebBuild()),
      accent: colors.modeResearch,
      onSelect: onSelectResearch,
    },
  ];

  return (
    <DialogFrame label="Welcome to Nuclei" maxWidth={560}>
      <>
        <div style={{
          color: colors.accentText, fontSize: 40, fontWeight: 700,
          fontFamily: TYPOGRAPHY.fontSans,
          letterSpacing: -1,
          marginBottom: 8,
          animation: prefersReducedMotion() ? 'none' : `nuclei-fade-in ${DURATION.emphasis}ms ${EASING.enter}`,
        }}>
          NUCLEI
        </div>
        <p style={{
          color: colors.textMuted, fontSize: 16,
          fontFamily: TYPOGRAPHY.fontSans,
          marginBottom: 40, lineHeight: 1.6,
        }}>
          What are you here to do?
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {cards.map((card, i) => (
            <ChoiceCard
              key={card.id}
              accent={card.accent}
              title={card.title}
              description={card.description}
              onClick={card.onSelect}
              aria-label={card.title}
              style={{ animation: prefersReducedMotion() ? 'none' : `nuclei-slide-up ${DURATION.slow}ms ${EASING.enter} ${i * 80}ms both` }}
            />
          ))}
        </div>
      </>
    </DialogFrame>
  );
}

function WelcomeScreen({ onSelect, onBack }: { onSelect: (path: OnboardingPath) => void; onBack: () => void }) {
  const colors = useThemeStore((s) => s.colors);

  const paths: Array<{ id: OnboardingPath; title: string; description: string; accent: string }> = [
    // One stripe colour for all three levels: they are told apart by their copy, not by hue.
    { id: 'beginner', title: "I'm brand new", description: 'Never done quantum computing? Start with an interactive playground — no code required.', accent: colors.accent },
    { id: 'intermediate', title: 'I know some quantum', description: 'Familiar with qubits and gates? Pick a track and start learning, with the full IDE one click away.', accent: colors.accent },
    { id: 'experienced', title: "I'm experienced", description: 'Ready to code? Go straight to the editor with all features enabled.', accent: colors.accent },
  ];

  return (
    <DialogFrame label="Choose your experience level" maxWidth={520} onEscape={onBack}>
      <>
        {/* Logo */}
        <div style={{
          color: colors.accentText, fontSize: 40, fontWeight: 700,
          fontFamily: TYPOGRAPHY.fontSans,
          letterSpacing: -1,
          marginBottom: 8,
          animation: prefersReducedMotion() ? 'none' : `nuclei-fade-in ${DURATION.emphasis}ms ${EASING.enter}`,
        }}>
          NUCLEI
        </div>
        <p style={{
          color: colors.textMuted, fontSize: 16,
          fontFamily: TYPOGRAPHY.fontSans,
          marginBottom: 40, lineHeight: 1.6,
        }}>
          Ready to explore quantum computing?
        </p>

        {/* Path selection */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {paths.map((path, i) => (
            <ChoiceCard
              key={path.id}
              accent={path.accent}
              title={path.title}
              description={path.description}
              onClick={() => onSelect(path.id)}
              aria-label={path.title}
              style={{ animation: prefersReducedMotion() ? 'none' : `nuclei-slide-up ${DURATION.slow}ms ${EASING.enter} ${i * 80}ms both` }}
            />
          ))}
        </div>

        {/* After the cards in the DOM so focus still opens on the first level; placed top left by CSS. */}
        <Button
          variant="ghost"
          icon={<ArrowLeft size={ICON_SIZE.sm} aria-hidden="true" />}
          onClick={onBack}
          style={{ position: 'absolute', top: 24, left: 24 }}
        >
          Back
        </Button>
      </>
    </DialogFrame>
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
    <DialogFrame label="Welcome back" maxWidth={420} onEscape={onContinue}>
      <>
        <div style={{
          color: colors.accentText, fontSize: 32, fontWeight: 700,
          fontFamily: TYPOGRAPHY.fontSans,
          letterSpacing: -1,
          marginBottom: 12,
        }}>
          NUCLEI
        </div>
        <p style={{
          color: colors.text, fontSize: 16, fontWeight: 500,
          fontFamily: TYPOGRAPHY.fontSans,
          marginBottom: 8,
        }}>
          {greeting}
        </p>
        {lastFile && (
          <p style={{
            color: colors.textMuted, fontSize: 13,
            fontFamily: TYPOGRAPHY.fontSans,
            marginBottom: 24,
          }}>
            Pick up where you left off?
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
          <Button variant="primary" size="lg" onClick={onContinue}>
            {lastFile ? 'Continue where I left off' : 'Open IDE'}
          </Button>
          <Button variant="secondary" size="lg" onClick={onStartFresh}>
            Start fresh
          </Button>
        </div>
      </>
    </DialogFrame>
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
        onContinue={() => onComplete(undefined)}
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

  return <WelcomeScreen onSelect={handleSelect} onBack={() => setScreen('mode-select')} />;
}
