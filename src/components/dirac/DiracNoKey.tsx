import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useDiracStore } from '../../stores/diracStore';
import { useDiracPanelStore } from '../../stores/diracPanelStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { validateApiKey } from '../../lib/apiKey';
import { API_KEY_PRIVACY_NOTE } from '../../config/apiKeyCopy';
import { Button, IconButton, TextInput } from '../ui';
import { DiracAtomIcon } from './DiracAtomIcon';
import './dirac.css';

interface Props {
  /** True when a key exists but the user (or a rejected request) asked to replace it. */
  replacing?: boolean;
}

/**
 * Connect Dirac without leaving the page: the key is entered and saved right
 * here, so a lesson or project in view is never closed to reach Settings.
 */
export function DiracNoKey({ replacing = false }: Props) {
  const mode = useWorkspaceStore((s) => s.mode);
  const pendingPrompt = useDiracPanelStore((s) => s.pendingPrompt);
  const focusSignal = useDiracPanelStore((s) => s.focusSignal);
  const closeKeyEntry = useDiracPanelStore((s) => s.closeKeyEntry);
  const openSettings = useNavigationStore((s) => s.openSettings);
  const [value, setValue] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (replacing || pendingPrompt) inputRef.current?.focus();
  }, [replacing, pendingPrompt]);

  // "Add API key" from the editor's AI surfaces asks the panel to focus; here that means the key field.
  useEffect(() => {
    if (focusSignal > 0) inputRef.current?.focus();
  }, [focusSignal]);

  const save = () => {
    const trimmed = value.trim();
    if (trimmed === '') { setError('Paste your Anthropic API key first.'); return; }
    const problem = validateApiKey(trimmed);
    if (problem) { setError(problem); return; }
    setError('');
    useDiracStore.getState().setApiKey(trimmed);
    closeKeyEntry();
  };

  const title = replacing
    ? 'Update your Anthropic key'
    : mode === 'research' ? 'Connect Dirac, your research collaborator' : 'Connect Dirac, your quantum tutor';
  const lede = mode === 'research'
    ? 'Dirac reads your circuit, sweeps and results, and helps you analyse and plan experiments.'
    : 'Dirac explains your circuit, fixes errors, and answers questions about the lesson you are on.';

  return (
    <section className="dirac-onboard" aria-label="Connect Dirac">
      <DiracAtomIcon />
      <h3 className="dirac-onboard__title">{title}</h3>
      <p className="dirac-onboard__lede">{lede}</p>
      {pendingPrompt && !replacing && (
        <p className="dirac-onboard__pending">
          Connect Dirac to get an answer to: &ldquo;{pendingPrompt}&rdquo;
        </p>
      )}
      <form
        className="dirac-onboard__form"
        onSubmit={(e) => { e.preventDefault(); save(); }}
      >
        <TextInput
          ref={inputRef}
          mono
          size="lg"
          type={visible ? 'text' : 'password'}
          value={value}
          invalid={Boolean(error)}
          onChange={(e) => { setValue(e.target.value); if (error) setError(''); }}
          placeholder="sk-ant-..."
          aria-label="Anthropic API key"
          autoComplete="off"
          spellCheck={false}
        />
        <IconButton
          aria-label={visible ? 'Hide API key' : 'Show API key'}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </IconButton>
        <Button type="submit" size="lg" className="dirac-btn-dirac">Save</Button>
      </form>
      {error && <p className="dirac-onboard__error" role="alert">{error}</p>}
      <p className="dirac-onboard__fine">{API_KEY_PRIVACY_NOTE}</p>
      <div className="dirac-onboard__links">
        <a className="dirac-link" href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer">
          Get an API key
        </a>
        <button type="button" className="dirac-link" onClick={() => openSettings('dirac')}>
          More Dirac settings
        </button>
        {replacing && (
          <button type="button" className="dirac-link" onClick={closeKeyEntry}>Cancel</button>
        )}
      </div>
    </section>
  );
}
