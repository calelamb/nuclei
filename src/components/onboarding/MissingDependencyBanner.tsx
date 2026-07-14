import { useEffect, useState } from 'react';
import { PackageX, Download, X, Check, Loader2 } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useMissingDependencyStore } from '../../stores/missingDependencyStore';
import type { FrameworkInfo } from '../../stores/frameworksStore';
import { isDesktop, resolveFramework, installFrameworks } from '../../services/environment';

type Phase = 'idle' | 'installing' | 'done' | 'error';

/**
 * When the kernel reports a `missing_dependency` (you ran Qiskit code but
 * Qiskit isn't installed), this floats a one-click install instead of leaving
 * you at a traceback. Resolves the missing name to its catalog entry via the
 * Rust `framework_resolve`, installs via `framework_install`, and tells you to
 * run again. Desktop-only; silent when nothing is missing.
 */
export function MissingDependencyBanner() {
  const colors = useThemeStore((s) => s.colors);
  const dependency = useMissingDependencyStore((s) => s.dependency);
  const kernelFramework = useMissingDependencyStore((s) => s.framework);
  const dismiss = useMissingDependencyStore((s) => s.dismiss);

  const [resolved, setResolved] = useState<FrameworkInfo | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Resolve the reported name to an installable catalog entry when a new
  // dependency arrives. State is only written from the async callbacks, so the
  // effect body itself triggers no synchronous re-render.
  useEffect(() => {
    if (!dependency || !isDesktop()) return;
    let active = true;
    resolveFramework(dependency)
      .then((fw) => {
        if (!active) return;
        setResolved(fw);
        setPhase('idle');
        setErrorMsg(null);
      })
      .catch(() => {
        if (active) setResolved(null);
      });
    return () => {
      active = false;
    };
  }, [dependency]);

  if (!dependency || !isDesktop()) return null;

  const name = resolved?.label ?? kernelFramework ?? dependency;

  const install = async () => {
    if (!resolved) return;
    setPhase('installing');
    setErrorMsg(null);
    try {
      const failures = await installFrameworks([resolved.id]);
      if (failures.length > 0) {
        setPhase('error');
        setErrorMsg(failures[0]);
      } else {
        setPhase('done');
      }
    } catch (e) {
      setPhase('error');
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: 52,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 4000,
        width: 440,
        maxWidth: 'calc(100vw - 32px)',
        background: colors.bgElevated,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        boxShadow: '0 18px 44px -18px rgba(0,0,0,0.65)',
        padding: '12px 14px',
        fontFamily: "'Geist Sans', sans-serif",
        animation: 'nuclei-slide-down 200ms ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
        <div
          style={{
            width: 30, height: 30, borderRadius: 7, flexShrink: 0,
            display: 'grid', placeItems: 'center',
            background: phase === 'done' ? `${colors.success}1F` : `${colors.warning}1F`,
            color: phase === 'done' ? colors.success : colors.warning,
          }}
        >
          {phase === 'done' ? <Check size={16} /> : <PackageX size={16} />}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {phase === 'done' ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
                {name} installed
              </div>
              <div style={{ fontSize: 12, color: colors.textDim, marginTop: 2, lineHeight: 1.45 }}>
                Run your code again (⌘↵) — it'll pick up the new package.
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
                {name} isn't installed
              </div>
              <div style={{ fontSize: 12, color: colors.textDim, marginTop: 2, lineHeight: 1.45 }}>
                {resolved
                  ? `Your code needs ${name}. Install it into Nuclei's Python environment — no terminal needed.`
                  : `Your code needs "${dependency}", which Nuclei doesn't manage. Install it into the environment yourself, or check the import.`}
              </div>
              {errorMsg && (
                <div style={{ fontSize: 11, color: colors.error, marginTop: 6, whiteSpace: 'pre-wrap', maxHeight: 72, overflow: 'auto' }}>
                  {errorMsg}
                </div>
              )}
            </>
          )}

          {/* actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {phase !== 'done' && resolved && (
              <button
                type="button"
                onClick={() => void install()}
                disabled={phase === 'installing'}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', borderRadius: 6, border: 'none',
                  background: colors.accent, color: '#0a0f1a',
                  fontSize: 12, fontWeight: 600, fontFamily: "'Geist Sans', sans-serif",
                  cursor: phase === 'installing' ? 'default' : 'pointer',
                  opacity: phase === 'installing' ? 0.7 : 1,
                }}
              >
                {phase === 'installing' ? (
                  <>
                    <Loader2 size={13} style={{ animation: 'nuclei-spin 800ms linear infinite' }} />
                    Installing {name}…
                  </>
                ) : (
                  <>
                    <Download size={13} />
                    {phase === 'error' ? 'Retry install' : `Install ${name}`}
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={dismiss}
              style={{
                padding: '6px 10px', borderRadius: 6,
                border: `1px solid ${colors.border}`, background: 'transparent',
                color: colors.textMuted, fontSize: 12, fontFamily: "'Geist Sans', sans-serif",
                cursor: 'pointer',
              }}
            >
              {phase === 'done' ? 'Dismiss' : 'Not now'}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          style={{ background: 'transparent', border: 'none', color: colors.textDim, cursor: 'pointer', padding: 2, flexShrink: 0 }}
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
