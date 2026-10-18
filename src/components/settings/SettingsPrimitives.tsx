import './settings.css';
import { createContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useNavigationStore, type SettingsSectionId } from '../../stores/navigationStore';
import { TYPOGRAPHY } from '../../styles/tokens';

/** The enclosing SettingRow's label, used as the accessible name of its control. */
// eslint-disable-next-line react-refresh/only-export-components
export const RowLabelContext = createContext<string | undefined>(undefined);


export function SettingRow({ label, hint, stacked = false, children }: { label: string; hint?: string; /** Put the control under the label (for wide controls in the 240px sidebar). */ stacked?: boolean; children: ReactNode }) {
  const colors = useThemeStore((s) => s.colors);
  return (
    <div style={{
      display: 'flex', alignItems: stacked ? 'flex-start' : 'center', justifyContent: 'space-between',
      flexDirection: stacked ? 'column' : 'row',
      padding: '6px 0', gap: stacked ? 6 : 8,
    }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 12, color: colors.textMuted, fontFamily: TYPOGRAPHY.fontSans }}>
          {label}
        </span>
        {hint && (
          <span style={{ fontSize: 11, color: colors.textDim, fontFamily: TYPOGRAPHY.fontSans, lineHeight: 1.4 }}>
            {hint}
          </span>
        )}
      </div>
      <RowLabelContext.Provider value={label}>{children}</RowLabelContext.Provider>
    </div>
  );
}

export function Section({ id, title, defaultOpen = false, children }: {
  id?: SettingsSectionId; title: string; defaultOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const colors = useThemeStore((s) => s.colors);
  const target = useNavigationStore((s) => s.settingsTarget);
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyId = useId();
  const Icon = open ? ChevronDown : ChevronRight;

  // Opened from elsewhere (e.g. Dirac's "Open Settings"): expand, scroll into
  // view and, for the Dirac section, put the cursor in the API key field.
  useEffect(() => {
    if (!id || target?.section !== id) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to an external navigation request
    setOpen(true);
    // No cancel-on-cleanup: SettingsPanel clears the target right after this
    // effect, which re-runs it and would cancel the frame before it fires. The
    // optional chains make the callback a no-op if the section unmounted.
    requestAnimationFrame(() => {
      rootRef.current?.scrollIntoView({ block: 'nearest' });
      rootRef.current?.querySelector<HTMLElement>('[data-settings-autofocus]')?.focus();
    });
  }, [id, target?.nonce, target?.section]);

  return (
    <div ref={rootRef} style={{ borderBottom: `1px solid ${colors.border}` }}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="nuclei-quiet settings-section__header"
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 12px', border: 'none', background: 'transparent',
          cursor: 'pointer',
        }}
      >
        <Icon size={12} />
        <span style={{
          fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: '0.04em', fontFamily: TYPOGRAPHY.fontSans,
        }}>
          {title}
        </span>
      </button>
      {/* grid-rows animates to the content's real height (no clipping at a magic max-height). */}
      <div
        id={bodyId}
        inert={!open}
        style={{
          display: 'grid',
          gridTemplateRows: open ? '1fr' : '0fr',
          transition: 'grid-template-rows var(--duration-normal) var(--ease-standard)',
        }}
      >
        <div style={{ overflow: 'hidden', minHeight: 0 }}>
          <div style={{ padding: '0 12px 10px' }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

