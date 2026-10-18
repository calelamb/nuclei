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
import { IconButton } from '../ui';
import { useProjectStore } from '../../stores/projectStore';
import { useThemeStore } from '../../stores/themeStore';
import { requestCloseTab } from '../../lib/tabClose';
import './OpenFilesSection.css';

const EXPANDED_KEY = 'nuclei.openFiles.expanded';

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

function readExpanded(): boolean {
  try {
    return window.localStorage.getItem(EXPANDED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeExpanded(expanded: boolean): void {
  try {
    window.localStorage.setItem(EXPANDED_KEY, expanded ? '1' : '0');
  } catch {
    // Private mode or blocked storage: the section simply forgets its state next launch.
  }
}

/**
 * Currently-open editor tabs, above the file tree. Collapsed by default and a
 * constant height whether or not tabs are open, so opening a file never moves
 * the tree under the pointer; expanded, it is a fixed-height scroller.
 */
export function OpenFilesSection() {
  const tabs = useProjectStore((s) => s.tabs);
  const activeTabPath = useProjectStore((s) => s.activeTabPath);
  const setActiveTab = useProjectStore((s) => s.setActiveTab);
  const colors = useThemeStore((s) => s.colors);
  const [expanded, setExpanded] = useState(readExpanded);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    writeExpanded(next);
  };

  return (
    <div className="open-files">
      <button type="button" className="open-files__header" onClick={toggle} aria-expanded={expanded}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>Open files</span>
        {tabs.length > 0 && <span className="open-files__count">({tabs.length})</span>}
      </button>
      {expanded && (
        <div className="open-files__list">
          {tabs.length === 0 && <div className="open-files__empty">No open files</div>}
          {tabs.map((tab) => {
            const isActive = tab.path === activeTabPath;
            const name = basename(tab.path);
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
                className="nuclei-row nuclei-row--reveal open-files__row"
                data-active={isActive}
              >
                {iconFor(name, isActive ? colors.accent : colors.textDim)}
                <span className="open-files__name">{name}</span>
                {tab.isDirty && (
                  <span className="nuclei-row__dirty open-files__dirty" title="Unsaved changes" aria-label="Unsaved changes" />
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
