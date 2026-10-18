import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useCircuitExport } from '../../hooks/useCircuitExport';
import { TYPOGRAPHY } from '../../styles/tokens';
import { useDisplaySnapshot } from '../../layout/useDisplaySnapshot';
import { useEditorStore } from '../../stores/editorStore';
import { Button, Menu, Tooltip, type MenuEntry } from '../ui';

export const COPIED_NOTICE_MS = 1500;
const ERROR_NOTICE_MS = 5000;
const CLIPBOARD_BLOCKED = "Couldn't copy: clipboard blocked";

/**
 * The circuit's Export menu. Copy actions confirm with a brief "Copied" and report a
 * blocked clipboard instead of failing silently; image exports say so when the diagram
 * is not on screen.
 */
export function ExportMenu() {
  const [notice, setNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const colors = useThemeStore((s) => s.colors);
  const { snapshot, stale } = useDisplaySnapshot();
  const errorLine = useEditorStore((s) => s.errors[0]?.line ?? null);
  const { exportQasmFile, exportSvg, exportPng, copyCodeToClipboard, copyQasmToClipboard, copyShareUrl, exportJsonSnapshot } = useCircuitExport();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const flash = useCallback((message: string | null, ms: number, isFailure = false) => {
    if (timer.current) clearTimeout(timer.current);
    setNotice(message);
    setFailed(isFailure && message !== null);
    timer.current = message ? setTimeout(() => setNotice(null), ms) : null;
  }, []);

  if (!snapshot || snapshot.gates.length === 0) return null;

  // Stale: the code does not parse right now. Keep the trigger in place (so the header never
  // changes height mid-edit) but say why it is unavailable.
  if (stale) {
    return (
      <Tooltip label={errorLine !== null ? `Fix line ${errorLine} to export` : 'Fix the code error to export'} placement="below">
        <span style={{ display: 'inline-flex' }}>
          <Button size="sm" icon={<ChevronDown size={12} />} className="nuclei-export-btn" disabled>Export</Button>
        </span>
      </Tooltip>
    );
  }

  const copy = async (action: () => Promise<unknown>, done: string) => {
    try {
      await action();
      flash(done, COPIED_NOTICE_MS);
    } catch {
      flash(CLIPBOARD_BLOCKED, ERROR_NOTICE_MS, true);
    }
  };

  const exportImage = async (pending: Promise<boolean>) => {
    try {
      flash((await pending) ? null : 'The diagram is not on screen, so there is nothing to export.', ERROR_NOTICE_MS, true);
    } catch (err) {
      flash(`Export failed: ${err instanceof Error ? err.message : 'unknown error'}`, ERROR_NOTICE_MS, true);
    }
  };

  const entries: MenuEntry[] = [
    { id: 'copy-code', label: 'Copy code', onSelect: () => { void copy(copyCodeToClipboard, 'Code copied'); } },
    { id: 'copy-qasm', label: 'Copy QASM', onSelect: () => { void copy(copyQasmToClipboard, 'QASM copied'); } },
    { id: 'copy-url', label: 'Copy share URL', onSelect: () => { void copy(copyShareUrl, 'Share URL copied'); } },
    { id: 'sep', separator: true },
    { id: 'qasm-file', label: 'Export QASM file', onSelect: exportQasmFile },
    { id: 'svg', label: 'Export SVG', onSelect: () => { void exportImage(exportSvg()); } },
    { id: 'png', label: 'Export PNG (2x)', onSelect: () => { void exportImage(exportPng(2)); } },
    { id: 'json', label: 'Export JSON', onSelect: exportJsonSnapshot },
  ];

  return (
    <div style={{ position: 'relative' }}>
      <Menu
        label="Export circuit"
        placement="bottom-end"
        entries={entries}
        onOpenChange={(open) => { if (open) flash(null, 0); }}
        trigger={(p) => (
          <Button {...p} size="sm" icon={notice && !failed ? <Check size={12} aria-hidden="true" /> : <ChevronDown size={12} />} className="nuclei-export-btn">
            {notice && !failed ? 'Copied' : 'Export'}
          </Button>
        )}
      />
      <div
        role="status"
        className={failed ? undefined : 'nuclei-sr-only'}
        style={failed ? {
          position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 10, width: 'max-content', maxWidth: 240,
          padding: '6px 10px', background: colors.bgPanel, border: `1px solid ${colors.border}`, borderRadius: 'var(--radius-xs)',
          color: colors.textMuted, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans, lineHeight: 1.4,
        } : undefined}
      >
        {notice}
      </div>
    </div>
  );
}
