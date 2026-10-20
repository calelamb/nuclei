import { ChevronDown } from 'lucide-react';
import { Button, Menu, useConfirm, type MenuEntry } from '../ui';
import { useEditorStore } from '../../stores/editorStore';
import { usePlatform } from '../../platform/PlatformProvider';
import { kernelLanguageFor } from '../../types/quantum';
import type { Framework } from '../../types/quantum';
import { useProjectStore } from '../../stores/projectStore';
import { isUntouchedStarter, loadIntoEditor, placeInEditor } from './loadIntoEditor';
import { STARTER_TEMPLATES, displayFrameworkName } from '../../data/starterTemplates';

const FRAMEWORKS: Framework[] = ['qiskit', 'cirq', 'cuda-q', 'qsharp'];

const displayName = displayFrameworkName;

export function FrameworkSelector({ compact = false }: { compact?: boolean } = {}) {
  const framework = useEditorStore((s) => s.framework);
  const setFramework = useEditorStore((s) => s.setFramework);
  const setCode = useEditorStore((s) => s.setCode);
  const code = useEditorStore((s) => s.code);
  const isDirty = useEditorStore((s) => s.isDirty);
  const filePath = useEditorStore((s) => s.filePath);
  const inProject = useProjectStore((s) => s.tabs.length > 0);
  const { confirm, confirmDialog } = useConfirm();
  const platform = usePlatform();
  const isWeb = platform.getPlatform() === 'web';

  // In the browser IDE Cirq runs natively and Qiskit through a pure-Python
  // subset; CUDA-Q/Q# need the desktop app's native kernel. Those options stay
  // visible (so students know they exist) but are disabled with a tooltip.
  const isDisabled = (f: Framework) => isWeb && f !== 'cirq' && f !== 'qiskit';
  const fullLabelFor = (f: Framework) => (isWeb && f === 'qiskit' ? 'Qiskit (browser subset)' : displayName(f));
  const labelFor = (f: Framework) => (compact ? displayName(f) : fullLabelFor(f));

  /**
   * A starter always lands in an untitled buffer, detached from any open file: in a project it gets
   * its own in-memory tab, so nothing the learner has open is lost and no confirm is needed.
   */
  const applyTemplate = async (f: Framework) => {
    await loadIntoEditor(STARTER_TEMPLATES[f], { label: `${displayName(f)} starter`, confirm, framework: f });
  };

  /**
   * Switching frameworks is a meaningful choice: the quantum libraries are
   * not source-compatible. If the buffer is an untouched starter template
   * (or empty), silently swap to the new framework's starter so the user
   * actually sees runnable code. If they have a real file open with real
   * work, just flip the framework label and leave their code alone —
   * that's how someone with mid-project code would expect to reclassify.
   *
   * The label-only flip is safe within the Python family because the
   * kernel's snapshot feedback self-corrects a wrong label on the next
   * parse. Across the python<->qsharp boundary it cannot: the buffer would
   * be parsed as the wrong language and every line would squiggle. For
   * those picks we confirm, swap in the target starter, and detach the
   * file path so we don't pretend e.g. a .py file contains Q#.
   */
  const handleFrameworkPick = async (f: Framework) => {
    if (f === framework) {
      return;
    }
    const canAutoSwap = !filePath && (!isDirty || isUntouchedStarter(code));
    if (canAutoSwap) {
      setCode(STARTER_TEMPLATES[f]);
      setFramework(f);
      return;
    }
    if (kernelLanguageFor(f) !== kernelLanguageFor(framework)) {
      // In a project the starter opens in its own tab, so there is nothing to lose and nothing to ask.
      if (!inProject) {
        const ok = await confirm({
          title: `Replace your code with the ${displayName(f)} starter?`,
          description: 'Switching languages replaces the editor buffer. Your unsaved edits will be lost.',
          confirmLabel: 'Replace',
          cancelLabel: 'Keep editing',
          tone: 'danger',
        });
        if (!ok) return;
      }
      placeInEditor(STARTER_TEMPLATES[f], f);
      return;
    }
    setFramework(f);
  };

  const DESKTOP_ONLY = 'Desktop app only — download from getnuclei.dev';
  const entries: MenuEntry[] = [
    { id: 'h-framework', heading: 'Framework' },
    ...FRAMEWORKS.map((f): MenuEntry => ({
      id: `fw-${f}`,
      label: labelFor(f),
      checked: f === framework,
      disabled: isDisabled(f),
      title: isDisabled(f) ? DESKTOP_ONLY : undefined,
      hint: isDisabled(f) ? 'Desktop' : undefined,
      onSelect: () => { void handleFrameworkPick(f); },
    })),
    { id: 'sep', separator: true },
    // Only a project has tabs to add to; without one the starter replaces the buffer, so say so.
    { id: 'h-template', heading: inProject ? 'New from template' : 'Start over from template' },
    ...FRAMEWORKS.map((f): MenuEntry => ({
      id: `tpl-${f}`,
      label: inProject ? `New ${displayName(f)} file` : `${displayName(f)} starter`,
      disabled: isDisabled(f),
      title: isDisabled(f) ? DESKTOP_ONLY : undefined,
      hint: isDisabled(f) ? 'Desktop' : undefined,
      onSelect: () => { void applyTemplate(f); },
    })),
  ];

  return (
    <>
    {confirmDialog}
    <Menu
      label="Framework"
      entries={entries}
      minWidth={200}
      trigger={({ 'aria-expanded': expanded, ...p }) => (
        <Button
          {...p}
          aria-expanded={expanded}
          className="nuclei-framework-btn"
          aria-label={compact ? `Framework: ${fullLabelFor(framework)}` : 'Framework'}
          style={{ minWidth: 0, maxWidth: '100%' }}
        >
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{labelFor(framework)}</span>
          <ChevronDown
            size={12}
            style={{
              flexShrink: 0, opacity: 0.7,
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 150ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          />
        </Button>
      )}
    />
    </>
  );
}
