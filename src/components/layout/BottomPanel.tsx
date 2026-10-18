import { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronDown, ChevronUp, Trash2, Copy, Clock } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useSimulationStore, type TerminalLine } from '../../stores/simulationStore';
import { useDiracStore } from '../../stores/diracStore';
import { useEditorStore } from '../../stores/editorStore';
import { useBottomPanelStore, type BottomPanelTab } from '../../stores/bottomPanelStore';
import { ProbabilityHistogram } from '../histogram/ProbabilityHistogram';
import { TYPOGRAPHY } from '../../styles/tokens';
import { Badge, Button, IconButton, Tabs, Tooltip } from '../ui';
import './bottomPanel.css';

/* ── Terminal Panel ── */

const ERROR_PATTERN = /\b(error|traceback|exception)\b/i;
const WARNING_PATTERN = /\bwarning\b/i;

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function lineColor(
  line: TerminalLine,
  colors: ReturnType<typeof useThemeStore.getState>['colors'],
): string {
  if (line.type === 'separator') return colors.textDim;
  if (line.type === 'stderr') return colors.error;
  if (line.type === 'info') return colors.textMuted;
  // stdout — but still flag tracebacks/warnings that bubbled through the
  // stdout channel (some libs print errors to stdout instead of stderr).
  if (ERROR_PATTERN.test(line.text)) return colors.error;
  if (WARNING_PATTERN.test(line.text)) return colors.warning;
  return colors.text;
}

function ToolbarButton({
  onClick,
  title,
  active,
  children,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={title} placement="below">
      <button
        type="button"
        onClick={onClick}
        aria-label={title}
        aria-pressed={active}
        data-active={active ? 'true' : undefined}
        className="nuclei-toolbtn"
      >
        {children}
      </button>
    </Tooltip>
  );
}

function TerminalToolbar({
  lineCount,
  onClear,
  onCopy,
  copied,
}: {
  lineCount: number;
  onClear: () => void;
  onCopy: () => void;
  copied: boolean;
}) {
  const colors = useThemeStore((s) => s.colors);
  const autoScroll = useBottomPanelStore((s) => s.autoScroll);
  const showTimestamps = useBottomPanelStore((s) => s.showTimestamps);
  const filter = useBottomPanelStore((s) => s.filter);
  const toggleAutoScroll = useBottomPanelStore((s) => s.toggleAutoScroll);
  const toggleShowTimestamps = useBottomPanelStore((s) => s.toggleShowTimestamps);
  const setFilter = useBottomPanelStore((s) => s.setFilter);

  return (
    <div
      style={{
        height: 24,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 8px',
        borderBottom: `1px solid ${colors.border}`,
        background: colors.bg,
        flexShrink: 0,
      }}
      role="toolbar"
      aria-label="Terminal toolbar"
    >
      <ToolbarButton onClick={onClear} title="Clear terminal">
        <Trash2 size={12} />
      </ToolbarButton>
      <ToolbarButton onClick={onCopy} title={copied ? 'Copied!' : 'Copy all output'}>
        <Copy size={12} />
        {copied && <span style={{ fontSize: 11 }}>copied</span>}
      </ToolbarButton>
      <ToolbarButton
        onClick={toggleShowTimestamps}
        title="Toggle timestamps"
        active={showTimestamps}
      >
        <Clock size={12} />
      </ToolbarButton>
      <ToolbarButton
        onClick={toggleAutoScroll}
        title="Auto-scroll to bottom"
        active={autoScroll}
      >
        Auto-scroll
      </ToolbarButton>

      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter"
        aria-label="Filter terminal lines"
        style={{
          marginLeft: 4,
          width: 120,
          height: 18,
          padding: '0 6px',
          background: colors.bgElevated,
          border: `1px solid ${colors.border}`,
          borderRadius: 3,
          color: colors.text,
          fontSize: 11,
          fontFamily: TYPOGRAPHY.fontSans,
        }}
      />

      <div style={{ flex: 1 }} />

      <span
        style={{
          color: colors.textDim,
          fontSize: 11,
          fontFamily: TYPOGRAPHY.fontMono,
        }}
      >
        {lineCount} {lineCount === 1 ? 'line' : 'lines'}
      </span>
    </div>
  );
}

function TerminalPanel() {
  const terminalOutput = useSimulationStore((s) => s.terminalOutput);
  const clearOutput = useSimulationStore((s) => s.clearOutput);
  const colors = useThemeStore((s) => s.colors);
  const rewritten = useDiracStore((s) => s.rewrittenError);
  const clearRewrittenError = useDiracStore((s) => s.clearRewrittenError);
  const setCode = useEditorStore((s) => s.setCode);
  const autoScroll = useBottomPanelStore((s) => s.autoScroll);
  const showTimestamps = useBottomPanelStore((s) => s.showTimestamps);
  const filter = useBottomPanelStore((s) => s.filter);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const filterLower = filter.trim().toLowerCase();
  const visibleLines = filterLower
    ? terminalOutput.filter(
        (l) => l.type === 'separator' || l.text.toLowerCase().includes(filterLower),
      )
    : terminalOutput;

  useEffect(() => {
    if (!autoScroll) return;
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [visibleLines, rewritten, autoScroll]);

  const handleCopy = useCallback(async () => {
    const text = terminalOutput
      .filter((l) => l.type !== 'separator')
      .map((l) => l.text)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Non-critical — clipboard may be unavailable in the web build or
      // restricted iframes. Silently fail.
    }
  }, [terminalOutput]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }}>
      <TerminalToolbar
        lineCount={terminalOutput.length}
        onClear={clearOutput}
        onCopy={handleCopy}
        copied={copied}
      />
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          fontFamily: TYPOGRAPHY.fontMono,
          fontSize: 12,
          color: colors.text,
          padding: '8px 12px',
          userSelect: 'text',
        }}
      >
        {rewritten && (
          <div
            role="alert"
            style={{
              marginBottom: 10,
              padding: '10px 12px',
              border: `1px solid ${colors.dirac}40`,
              borderRadius: 10,
              background: `${colors.dirac}12`,
              fontFamily: TYPOGRAPHY.fontSans,
              fontSize: 12,
              lineHeight: 1.5,
              color: colors.text,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, color: colors.diracText, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11 }}>
              Dirac
            </div>
            <div style={{ marginBottom: rewritten.fix ? 10 : 0 }}>{rewritten.explanation}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {rewritten.fix && (
                <Button size="sm" className="nuclei-btn--dirac" onClick={() => { setCode(rewritten.fix!); clearRewrittenError(); }}>Apply fix</Button>
              )}
              <Button size="sm" variant="ghost" onClick={clearRewrittenError}>Dismiss</Button>
            </div>
          </div>
        )}
        {visibleLines.length === 0 && !rewritten ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: colors.textDim }}>
            <span style={{ color: colors.accentText, opacity: 0.3, fontFamily: TYPOGRAPHY.fontMono }}>{'>'}_</span>
            <span style={{ fontSize: 11 }}>
              {filterLower ? 'No lines match the filter.' : 'Terminal output will appear here'}
            </span>
          </div>
        ) : visibleLines.map((line, i) => {
          const isStderr = line.type === 'stderr';
          const isSeparator = line.type === 'separator';
          const fontStyle = isStderr ? 'italic' : 'normal';
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 8,
                color: lineColor(line, colors),
                fontStyle,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {showTimestamps && !isSeparator && (
                <span
                  style={{
                    color: colors.textDim,
                    opacity: 0.7,
                    flexShrink: 0,
                    userSelect: 'none',
                  }}
                >
                  [{formatTimestamp(line.timestamp)}]
                </span>
              )}
              <span style={{ flex: 1 }}>{line.text || '\u00a0'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Bottom Panel ──
 * In the new progressive-reveal layout the histogram no longer lives here;
 * it's rendered as a compact chip beneath the Bloch sphere. The bottom
 * panel shows Terminal by default, and the full histogram only when the
 * user has opted into the `full` layout preset.
 */
export function BottomPanel({
  showFullHistogram,
}: {
  showFullHistogram: boolean;
}) {
  const collapsed = useBottomPanelStore((s) => s.collapsed);
  const activeTab = useBottomPanelStore((s) => s.activeTab);
  const toggleCollapsed = useBottomPanelStore((s) => s.toggleCollapsed);
  const setCollapsed = useBottomPanelStore((s) => s.setCollapsed);
  const setActiveTab = useBottomPanelStore((s) => s.setActiveTab);
  const unreadLines = useBottomPanelStore((s) => s.unreadLines);
  const result = useSimulationStore((s) => s.result);
  const colors = useThemeStore((s) => s.colors);

  // Auto-focus histogram tab on a new result, but only if the full histogram
  // is actually available (otherwise the tab would be a dead link). Lives
  // here rather than in the store so we can condition on showFullHistogram,
  // which is a layout-preset-derived prop owned by the parent.
  useEffect(() => {
    if (result && showFullHistogram) queueMicrotask(() => setActiveTab('histogram'));
  }, [result, showFullHistogram, setActiveTab]);

  // When the full histogram tab disappears (layout preset changed), snap
  // back to terminal so we never render an invisible tab.
  useEffect(() => {
    if (!showFullHistogram && activeTab === 'histogram') {
      queueMicrotask(() => setActiveTab('terminal'));
    }
  }, [showFullHistogram, activeTab, setActiveTab]);

  const tabs: Array<BottomPanelTab> = showFullHistogram
    ? ['terminal', 'histogram']
    : ['terminal'];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Panel header */}
      <div style={{ height: 28, display: 'flex', alignItems: 'center', borderBottom: collapsed ? 'none' : `1px solid ${colors.border}`, backgroundColor: colors.bg, flexShrink: 0 }}>
        <Tabs
          aria-label="Bottom panel"
          className="bottom-panel-tabs"
          value={activeTab}
          onChange={(tab) => { if (collapsed) setCollapsed(false); setActiveTab(tab); }}
          options={tabs.map((tab) => ({
            value: tab,
            label: tab === 'terminal'
              ? <>Terminal{unreadLines > 0 && <Badge tone="accent" aria-label={`${unreadLines} unread lines`}>{unreadLines > 99 ? '99+' : unreadLines}</Badge>}</>
              : 'Histogram',
          }))}
        />
        <div style={{ flex: 1 }} />
        <IconButton size="sm" onClick={toggleCollapsed} aria-label={collapsed ? 'Expand panel' : 'Collapse panel'} tooltip={{ placement: 'above' }} style={{ marginRight: 6 }}>
          {collapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </IconButton>
      </div>
      {!collapsed && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {activeTab === 'terminal' || !showFullHistogram
            ? <TerminalPanel />
            : <ProbabilityHistogram />}
        </div>
      )}
    </div>
  );
}
