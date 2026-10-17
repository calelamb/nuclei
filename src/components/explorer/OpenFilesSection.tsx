import { IconButton } from '../ui';
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
import { requestCloseTab } from '../../lib/tabClose';

import { TYPOGRAPHY } from '../../styles/tokens';
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
  return <Icon size={14} style={{ color, marginRight: 6, flexShrink: 0 }} />;
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
  const colors = useThemeStore((s) => s.colors);
  const [collapsed, setCollapsed] = useState(false);

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
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          color: colors.textMuted,
          fontFamily: TYPOGRAPHY.fontSans,
        }}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <span>Open Files</span>
        <span style={{ color: colors.textDim, fontWeight: 500 }}>({tabs.length})</span>
      </button>
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 4 }}>
          {tabs.map((tab) => {
            const isActive = tab.path === activeTabPath;
            const name = basename(tab.path);
            // Active file gets the accent tint + left bar (matching the tabs and
            // the file tree), so it never reads the same as a plain hover.
            const background = isActive ? `${colors.accent}14` : 'transparent';
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
                title={tab.path}
                className="nuclei-row nuclei-row--reveal"
                data-active={isActive}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '3px 8px 3px 22px',
                  cursor: 'pointer',
                  background,
                  boxShadow: isActive ? `inset 2px 0 0 ${colors.accent}` : 'none',
                  color: isActive ? colors.text : colors.textMuted,
                  fontWeight: isActive ? 500 : 400,
                  fontSize: 12,
                  fontFamily: TYPOGRAPHY.fontSans,
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
                {tab.isDirty && (
                  <span
                    className="nuclei-row__dirty"
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
                <IconButton
                  size="sm"
                  className="nuclei-row__close"
                  tooltip={{ label: 'Close' }}
                  aria-label={`Close ${name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    requestCloseTab(tab.path);
                  }}
                >
                  <X size={12} />
                </IconButton>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
