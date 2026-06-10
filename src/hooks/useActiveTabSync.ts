import { useEffect, useRef } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { useEditorStore } from '../stores/editorStore';

/**
 * Two-way sync between `projectStore` (authority for all open tabs) and
 * `editorStore` (single-file store that Monaco, the kernel, Dirac, and the
 * AI services already read from). Activating a tab copies its buffer into
 * editorStore; editing the buffer in editorStore pushes back into the
 * active tab. This lets existing features keep their current store reads
 * while multi-tab behavior lands transparently.
 */
export function useActiveTabSync() {
  const activeTabPath = useProjectStore((s) => s.activeTabPath);
  const activeTab = useProjectStore(
    (s) => s.tabs.find((t) => t.path === s.activeTabPath) ?? null,
  );
  const updateActiveTabContent = useProjectStore((s) => s.updateActiveTabContent);
  const code = useEditorStore((s) => s.code);
  const setCode = useEditorStore((s) => s.setCode);
  const setFilePath = useEditorStore((s) => s.setFilePath);
  const setIsDirty = useEditorStore((s) => s.setIsDirty);

  const lastAppliedPath = useRef<string | null>(null);

  useEffect(() => {
    if (!activeTab) {
      if (lastAppliedPath.current !== null) {
        lastAppliedPath.current = null;
      }
      return;
    }
    if (lastAppliedPath.current !== activeTab.path) {
      lastAppliedPath.current = activeTab.path;
      setCode(activeTab.content);
      setFilePath(activeTab.path);
      setIsDirty(activeTab.isDirty);
      // Keep the framework in step with the file's language. A `.qs` tab
      // must flip to Q# eagerly (the parse is routed by the framework's
      // language, so feedback can't infer it), and leaving Q# for a
      // non-.qs tab restores the last Python-family framework the user
      // held, so the kernel's regex detection + snapshot feedback take
      // over again from where they left off.
      const fw = useEditorStore.getState().framework;
      if (activeTab.path.toLowerCase().endsWith('.qs')) {
        if (fw !== 'qsharp') useEditorStore.getState().setFramework('qsharp');
      } else if (fw === 'qsharp') {
        useEditorStore.getState().setFramework(useEditorStore.getState().lastPythonFramework);
      }
    } else {
      setIsDirty(activeTab.isDirty);
    }
  }, [activeTab, setCode, setFilePath, setIsDirty]);

  useEffect(() => {
    if (!activeTabPath || !activeTab) return;
    if (code !== activeTab.content) {
      updateActiveTabContent(code);
    }
    // Excluding activeTab from deps to avoid a write/read ping-pong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, activeTabPath, updateActiveTabContent]);
}
