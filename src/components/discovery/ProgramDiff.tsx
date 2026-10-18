import { Suspense, lazy } from 'react';
import { LabCode, LabSkeleton } from '../lab';
import { registerNucleiThemes } from '../editor/monacoThemes';
import { diffStats, lineDiff, renderDiffText } from '../../services/discovery/lineDiff';
import { useThemeStore } from '../../stores/themeStore';

const MonacoDiff = lazy(async () => {
  const mod = await import('@monaco-editor/react');
  return { default: mod.DiffEditor };
});

/** Read-only Monaco diff (inline); a plain-text diff shows while the editor loads. */
export function ProgramDiff({ original, modified, label, height = 260 }: { original: string; modified: string; label: string; height?: number }) {
  const mode = useThemeStore((s) => s.mode);
  const lines = lineDiff(original, modified);
  const { added, removed } = diffStats(lines);
  const identical = added === 0 && removed === 0;
  return (
    <figure style={{ margin: 0 }} aria-label={label}>
      <figcaption className="lab-muted" style={{ marginBottom: 'var(--space-1)', fontSize: 11.5 }}>
        <span className="lab-mono">+{added} −{removed}</span> lines{identical ? ' (identical)' : ''}
      </figcaption>
      {identical ? (
        <LabCode label={label} maxHeight={height}>{modified}</LabCode>
      ) : (
        <div style={{ height, border: '1px solid var(--lab-hairline)', borderRadius: 'var(--radius-soft)', overflow: 'hidden' }}>
          <Suspense fallback={<LabCode label={`${label} (loading editor)`} maxHeight={height}>{renderDiffText(lines)}</LabCode>}>
            <MonacoDiff
              original={original}
              modified={modified}
              language="python"
              theme={mode === 'dark' ? 'nuclei-dark' : 'nuclei-light'}
              beforeMount={registerNucleiThemes}
              loading={<LabSkeleton height={height} />}
              options={{
                readOnly: true,
                originalEditable: false,
                renderSideBySide: false,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                fontSize: 12,
                renderOverviewRuler: false,
              }}
            />
          </Suspense>
        </div>
      )}
    </figure>
  );
}
