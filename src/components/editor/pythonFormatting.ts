import type { Monaco } from '@monaco-editor/react';
import { requestFormat } from '../../lib/lintSender';

// Register-once guard (mirrors ghostCompletions): the provider is global to the
// monaco instance, so a remounting editor must not stack duplicate providers.
const registered = new WeakSet<object>();

/**
 * Dev tools Phase 4 — a Python document-formatting provider that round-trips
 * the buffer through the kernel's `format` message (ruff). Wires up ⇧⌥F and the
 * "Format Document" command. Returns no edit when the kernel is absent or the
 * format failed (e.g. a syntax error), so formatting is never destructive.
 */
export function registerPythonFormatting(monaco: Monaco): void {
  if (registered.has(monaco)) return;
  registered.add(monaco);

  monaco.languages.registerDocumentFormattingEditProvider('python', {
    async provideDocumentFormattingEdits(model) {
      const original = model.getValue();
      const formatted = await requestFormat(original);
      if (formatted === null || formatted === original) return [];
      return [{ range: model.getFullModelRange(), text: formatted }];
    },
  });
}
