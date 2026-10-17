import { useCallback, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { useThemeStore } from '../../stores/themeStore';
import { registerNucleiThemes } from '../editor/monacoThemes';
import { TYPOGRAPHY } from '../../styles/tokens';
import { isMacPlatform } from '../../config/keybindings';
import { tabFocusHint } from '../../lib/tabFocusHint';
import { lessonTabFocus } from './lessonTabFocus';
import { countLines, lessonEditorHeight, LESSON_EDITOR_MAX_HEIGHT } from './lessonEditorLayout';

interface Props {
  value: string;
  onChange: (value: string) => void;
}

/**
 * The small editor inside lesson demos and exercises. It sizes itself to the
 * code (up to a cap, then scrolls with a visible scrollbar), leaves a gutter
 * between line numbers and code, and follows the app theme live.
 *
 * Tab moves focus out of the editor by default so keyboard users are never
 * trapped on a lesson page (WCAG 2.1.2); Ctrl+M switches Tab to indent while
 * editing. The current mode is shown as a hint whenever the editor has focus.
 */
export function LessonCodeEditor({ value, onChange }: Props) {
  const mode = useThemeStore((s) => s.mode);
  const [height, setHeight] = useState(() => lessonEditorHeight(countLines(value)));
  const [tabMovesFocus, setTabMovesFocus] = useState(() => lessonTabFocus.get());
  const [focused, setFocused] = useState(false);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    // The flag is shared by every editor, so this editor takes it while it has
    // focus (Tab leaves; the learner can opt in to indenting) and puts back
    // whatever was there when focus moves on.
    let previous: boolean | null = null;
    editor.onDidFocusEditorText(() => {
      previous = lessonTabFocus.get();
      lessonTabFocus.set(true);
      setFocused(true);
    });
    editor.onDidBlurEditorText(() => {
      if (previous !== null) lessonTabFocus.set(previous);
      previous = null;
      setFocused(false);
    });
    const subscription = lessonTabFocus.subscribe(setTabMovesFocus);
    editor.onDidDispose(() => subscription.dispose());
    // Monaco's own toggle is Ctrl+Shift+M on macOS; Ctrl+M is what the hint says.
    if (isMacPlatform()) {
      editor.addAction({
        id: 'nuclei.lesson.toggleTabFocus',
        label: 'Toggle Tab Key Moves Focus (Ctrl+M)',
        keybindings: [monaco.KeyMod.WinCtrl | monaco.KeyCode.KeyM],
        run: (ed) => { ed.trigger('nuclei', 'editor.action.toggleTabFocusMode', null); },
      });
    }
    const sync = () => setHeight(Math.min(LESSON_EDITOR_MAX_HEIGHT, Math.max(lessonEditorHeight(1), editor.getContentHeight())));
    sync();
    editor.onDidContentSizeChange(sync);
  }, []);

  return (
    <div className="lesson-editor" style={{ height }}>
      <Editor
        height="100%"
        language="python"
        value={value}
        onChange={(v) => onChange(v ?? '')}
        onMount={handleMount}
        beforeMount={registerNucleiThemes}
        theme={mode === 'dark' ? 'nuclei-dark' : 'nuclei-light'}
        options={{
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 13,
          lineNumbers: 'on',
          glyphMargin: false,
          folding: false,
          lineDecorationsWidth: 10,
          lineNumbersMinChars: 2,
          renderLineHighlight: 'none',
          overviewRulerLanes: 0,
          scrollbar: { vertical: 'auto', horizontal: 'hidden', alwaysConsumeMouseWheel: false },
          wordWrap: 'on',
          padding: { top: 8, bottom: 8 },
          fontFamily: TYPOGRAPHY.fontMono,
        }}
      />
      {focused && <div className="lesson-editor__hint" role="note">{tabFocusHint(tabMovesFocus)}</div>}
    </div>
  );
}
