import { useThemeStore } from '../../stores/themeStore';
import { prefersReducedMotion } from '../../lib/animations';

/** Animated atom mark for Dirac's empty and onboarding states. */
export function DiracAtomIcon() {
  const colors = useThemeStore((s) => s.colors);
  const reduced = prefersReducedMotion();
  return (
    <div aria-hidden="true" style={{ width: 48, height: 48, position: 'relative', margin: '0 auto 12px', flexShrink: 0 }}>
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        width: 8, height: 8, borderRadius: '50%',
        background: colors.accentLight, transform: 'translate(-50%, -50%)',
        boxShadow: `0 0 12px ${colors.accent}60`,
      }} />
      {[0, 60, 120].map((deg, i) => (
        <div key={deg} style={{
          position: 'absolute', inset: 0,
          border: `1px solid ${colors.accent}30`,
          borderRadius: '50%',
          transform: `rotate(${deg}deg) scaleY(0.4)`,
        }}>
          <div style={{
            position: 'absolute', top: -3, left: '50%',
            width: 5, height: 5, borderRadius: '50%',
            background: colors.accentLight,
            transform: 'translateX(-50%)',
            boxShadow: `0 0 6px ${colors.accent}80`,
            animation: reduced ? 'none' : `nuclei-orbit 3s linear ${i}s infinite`,
          }} />
        </div>
      ))}
    </div>
  );
}
