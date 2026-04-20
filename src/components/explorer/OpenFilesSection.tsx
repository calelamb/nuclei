import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  X,
  FileCode,
  Atom,
  Braces,
  FileText,
  File as FileIconLucide,
  type LucideIcon,
} from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useThemeStore } from '../../stores/themeStore';

const EXTENSION_ICONS: Record<string, LucideIcon> = {
  py: FileCode,
  qasm: Atom,
  json: Braces,
  md: FileText,
  txt: FileText,
};

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

function iconFor(name: string, color: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const Icon = EXTENSION_ICONS[ext] ?? FileIconLucide;
  return <Icon size={13} style={{ color, marginRight: 6, flexShrink: 0 }} />;
}

/**
 * Always-visible list of currently-open editor tabs. Sits at the top of
 * the sidebar when the files view is active, independent of whether a
 * project folder is open — so a user who has only File > Open'd a single
 * file (no project root) can still see and switch between open editors
 * from the left rail instead of relying on the top tab bar.
 */
export function OpenFilesSection() {
  const tabs = useProjectStore((s) => s.tabs);
  const activeTabPath = useProjectStore((s) => s.activeTabPath);
  const setActiveTab = useProjectStore((s) => s.setActiveTab);
  const closeTab = useProjectStore((s) => s.closeTab);
  const colors = useThemeStore((s) => s.colors);
  const [collapsed, setCollapsed] = useState(false);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);

  if (tabs.length === 0) return null;

  return (
    <div
      style={{
        flexShrink: 0,
        borderBottom: `1px solid ${colors.border}`,
        background: colors.bg,
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          width: '100%',
          padding: '6px 10px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          color: colors.textMuted,
          fontFamily: "'Geist Sans', sans-serif",
        }}
      >
        {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
        <span>Open Files</span>
        <span style={{ color: colors.textDim, fontWeight: 500 }}>({tabs.length})</span>
      </button>
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 4 }}>
          {tabs.map((tab) => {
            const isActive = tab.path === activeTabPath;
            const isHovered = hoveredPath === tab.path;
            const name = basename(tab.path);
            const background = isActive
              ? colors.bgElevated
              : isHovered
                ? colors.bgElevated
                : 'transparent';
            return (
              <div
                key={tab.path}
                role="button"
                tabIndex={0}
                onClick={() => setActiveTab(tab.path)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveTab(tab.path);
                  }
                }}
                onMouseEnter={() => setHoveredPath(tab.path)}
                onMouseLeave={() => setHoveredPath(null)}
                title={tab.path}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '3px 8px 3px 22px',
                  cursor: 'pointer',
                  background,
                  color: isActive ? colors.text : colors.textMuted,
                  fontSize: 12,
                  fontFamily: "'Geist Sans', sans-serif",
                  outline: 'none',
                }}
              >
                {iconFor(name, isActive ? colors.accent : colors.textDim)}
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {name}
                </span>
                {tab.isDirty && !isHovered && (
                  <span
                    title="Unsaved changes"
                    aria-label="Unsaved changes"
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 999,
                      background: colors.accent,
                      flexShrink: 0,
                      marginRight: 4,
                    }}
                  />
                )}
                <button
                  type="button"
                  title="Close"
                  aria-label={`Close ${name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.path);
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: colors.textDim,
                    cursor: 'pointer',
                    padding: 2,
                    display: 'flex',
                    borderRadius: 3,
                    // Keep the close affordance consistent with the
                    // top tab bar: visible on hover, out of the way otherwise.
                    // Dirty-indicator dot takes the same spot when not hovering,
                    // so layout never jumps.
                    opacity: isHovered ? 1 : 0,
                    pointerEvents: isHovered ? 'auto' : 'none',
                  }}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
