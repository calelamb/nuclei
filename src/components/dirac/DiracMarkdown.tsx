import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import { Check, Copy } from 'lucide-react';
import { MarkdownWithTables } from '../markdown/MarkdownWithTables';
import { IconButton } from '../ui';
import { ICON_SIZE } from '../../styles/tokens';
import { highlightCode } from './highlightCode';

export const COPIED_MS = 1500;

/** The plain text inside a `<pre><code>` pair react-markdown hands to the `pre` renderer. */
function codeText(children: ReactNode): string {
  const child = Children.toArray(children)[0];
  if (isValidElement<{ children?: ReactNode }>(child)) return String(child.props.children ?? '').replace(/\n$/, '');
  return String(child ?? '');
}

function CodeBlock({ children }: { children: ReactNode }) {
  const text = codeText(children);
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus('idle'), COPIED_MS);
  };

  return (
    <div className="dirac-code">
      <IconButton
        size="sm"
        className="dirac-code__copy"
        aria-label={status === 'copied' ? 'Copied' : 'Copy code'}
        tooltip={{ label: status === 'copied' ? 'Copied' : 'Copy code', placement: 'below' }}
        onClick={() => { void copy(); }}
      >
        {status === 'copied' ? <Check size={ICON_SIZE.sm} /> : <Copy size={ICON_SIZE.sm} />}
      </IconButton>
      <pre>
        <code>
          {highlightCode(text).map((t, i) => (t.kind === 'plain'
            ? t.text
            : <span key={i} className={`tok tok--${t.kind}`}>{t.text}</span>))}
        </code>
      </pre>
      <span role="status" className="dirac-code__status">{status === 'failed' ? "Couldn't copy: clipboard blocked" : ''}</span>
    </div>
  );
}

const COMPONENTS: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
};

/** A chat message body: tables, quotes and highlighted code with a copy button. */
export function DiracMarkdown({ content }: { content: string }) {
  return (
    <div className="dirac-markdown">
      <MarkdownWithTables markdown={content} components={COMPONENTS} />
    </div>
  );
}
