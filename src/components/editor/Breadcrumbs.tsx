import { useEditorStore } from '../../stores/editorStore';
import { useThemeStore } from '../../stores/themeStore';
import { useExperimentUiStore } from '../../stores/experimentUiStore';
import { useExperimentStore } from '../../services/experimentStore';
import { ChevronRight, MoreHorizontal } from 'lucide-react';

const MAX_VISIBLE_SEGMENTS = 3;

/** Shared breadcrumb bar chrome — the file trail and the experiment→run trail
 * both render inside this identical bar (PRD 11 Phase C: extend Breadcrumbs,
 * don't fork it). */
function BreadcrumbBar({ children, title }: { children: React.ReactNode; title?: string }) {
  const colors = useThemeStore((s) => s.colors);
  return (
    <div
      title={title}
      style={{
        height: 22,
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: 2,
        backgroundColor: colors.bgEditor,
        borderBottom: `1px solid ${colors.border}`,
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );
}

export function Breadcrumbs() {
  const filePath = useEditorStore((s) => s.filePath);
  const colors = useThemeStore((s) => s.colors);

  const allSegments = filePath
    ? filePath.split(/[\\/]/).filter(Boolean)
    : ['untitled.py'];

  // Avoid leaking absolute path prefixes like /Users/<name>/... — show at
  // most the last N segments with a leading ellipsis marker when truncated.
  // This matches the convention used in status-bar paths across modern
  // editors and keeps breadcrumbs legible on small screens.
  const truncated = allSegments.length > MAX_VISIBLE_SEGMENTS;
  const visible = truncated
    ? allSegments.slice(-MAX_VISIBLE_SEGMENTS)
    : allSegments;

  return (
    <div style={{
      height: 22,
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      gap: 2,
      backgroundColor: colors.bgEditor,
      borderBottom: `1px solid ${colors.border}`,
      flexShrink: 0,
      overflow: 'hidden',
    }}>
      {truncated && (
        <span
          title={filePath ?? undefined}
          style={{ display: 'flex', alignItems: 'center', gap: 2, color: colors.textDim }}
        >
          <MoreHorizontal size={11} />
          <ChevronRight size={10} />
        </span>
      )}
      {visible.map((seg, i) => {
        const isLast = i === visible.length - 1;
        return (
          <span key={`${seg}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {i > 0 && <ChevronRight size={10} style={{ color: colors.textDim }} />}
            <span
              style={{
                fontSize: 11,
                fontFamily: "'Geist Sans', system-ui, sans-serif",
                color: isLast ? colors.textMuted : colors.textDim,
                whiteSpace: 'nowrap',
              }}
            >
              {seg}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/**
 * Experiment → run drill-down trail (PRD 11 Phase C). Rendered at the top of
 * the Research experiments area: `theta-sweep ▸ 20260712-141530-a3f9`. The
 * experiment segment is clickable to go back to the runs table; the trailing
 * segment (a specific run, or "Compare") is the current location. Renders
 * nothing when no experiment is selected.
 */
export function ExperimentBreadcrumbs() {
  const colors = useThemeStore((s) => s.colors);
  const experimentFileName = useExperimentUiStore((s) => s.selectedExperimentFileName);
  const runDir = useExperimentUiStore((s) => s.selectedRunDir);
  const compareOpen = useExperimentUiStore((s) => s.compareOpen);
  const compareCount = useExperimentUiStore((s) => s.compareSelection.length);
  const selectRun = useExperimentUiStore((s) => s.selectRun);
  const closeCompare = useExperimentUiStore((s) => s.closeCompare);
  const experiments = useExperimentStore((s) => s.experiments);

  if (!experimentFileName) return null;

  const experiment = experiments.find((e) => e.fileName === experimentFileName);
  const experimentName = experiment?.spec.name ?? experimentFileName;

  // A trailing segment exists when the user has drilled into a run or the
  // compare view; then the experiment segment becomes a clickable "back".
  const trailing = compareOpen ? `Compare (${compareCount})` : runDir;
  const backToRuns = () => { selectRun(null); closeCompare(); };

  const segmentStyle = (isLast: boolean, clickable: boolean): React.CSSProperties => ({
    fontSize: 11,
    fontFamily: "'Geist Sans', system-ui, sans-serif",
    color: isLast ? colors.textMuted : colors.accent,
    whiteSpace: 'nowrap',
    background: 'transparent',
    border: 'none',
    padding: 0,
    cursor: clickable ? 'pointer' : 'default',
  });

  return (
    <BreadcrumbBar title={experimentName}>
      {trailing ? (
        <button onClick={backToRuns} style={segmentStyle(false, true)}>
          {experimentName}
        </button>
      ) : (
        <span style={segmentStyle(true, false)}>{experimentName}</span>
      )}
      {trailing && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <ChevronRight size={10} style={{ color: colors.textDim }} />
          <span style={{ ...segmentStyle(true, false), fontFamily: "'Fira Code', monospace" }}>
            {trailing}
          </span>
        </span>
      )}
    </BreadcrumbBar>
  );
}
