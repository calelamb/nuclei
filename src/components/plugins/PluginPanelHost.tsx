import { useEffect, useRef, useState } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { PluginErrorCard } from './PluginErrorCard';
import type { PluginExtensions } from '../../plugins/pluginManager';

type PluginPanel = PluginExtensions['panels'][number];

/**
 * Renders one plugin-contributed panel by imperatively mounting into a ref'd
 * div. Each panel's `render(container)` is wrapped in its own try/catch so a
 * throwing plugin shows an inline error card instead of blanking the view; the
 * cleanup it optionally returns runs on unmount (and `replaceChildren` clears
 * any DOM the plugin left behind).
 */
export function PluginPanelHost({ panel }: { panel: PluginPanel }) {
  const colors = useThemeStore((s) => s.colors);
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const font = "'Geist Sans', sans-serif";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the prior panel's error when the panel identity changes
    setError(null);
    let cleanup: (() => void) | void;
    try {
      cleanup = panel.render(el);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    return () => {
      try {
        if (typeof cleanup === 'function') cleanup();
      } catch {
        // A broken panel teardown must never break the host.
      }
      el.replaceChildren();
    };
    // Re-mount when the panel identity changes (e.g. a reload swaps the closure).
  }, [panel]);

  return (
    <div
      style={{
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          background: colors.bg,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: colors.textMuted,
            fontFamily: font,
          }}
        >
          {panel.title}
        </span>
        <span
          style={{
            fontSize: 9,
            color: colors.textDim,
            fontFamily: "'Geist Mono', monospace",
          }}
        >
          {panel.pluginName}
        </span>
      </div>
      {error ? (
        <PluginErrorCard title={`${panel.title} failed to render`} message={error} />
      ) : (
        <div ref={ref} style={{ padding: 0 }} />
      )}
    </div>
  );
}
