import ReactMarkdown from 'react-markdown';
import { useThemeStore } from '../../stores/themeStore';

interface TextBlockProps {
  markdown: string;
}

export function TextBlock({ markdown }: TextBlockProps) {
  const colors = useThemeStore((s) => s.colors);

  return (
    <div
      className="nuclei-markdown"
      style={{
        color: colors.text,
        fontFamily: "'Geist Sans', Inter, system-ui, sans-serif",
        fontSize: 15,
        lineHeight: 1.7,
      }}
    >
      <ReactMarkdown
        components={{
          h1: ({ children }) => (
            <h1 style={{ fontSize: 28, fontWeight: 700, color: colors.text, margin: '24px 0 12px', lineHeight: 1.3 }}>{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 style={{ fontSize: 22, fontWeight: 600, color: colors.text, margin: '20px 0 10px', lineHeight: 1.3 }}>{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 style={{ fontSize: 18, fontWeight: 600, color: colors.text, margin: '16px 0 8px', lineHeight: 1.3 }}>{children}</h3>
          ),
          p: ({ children }) => (
            <p style={{ margin: '0 0 12px', color: colors.text }}>{children}</p>
          ),
          strong: ({ children }) => (
            <strong style={{ color: colors.accent, fontWeight: 600 }}>{children}</strong>
          ),
          code: ({ children, className }) => {
            const isBlock = className?.includes('language-');
            if (isBlock) {
              return (
                <code style={{
                  display: 'block',
                  background: colors.bgEditor,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  padding: '12px 16px',
                  fontFamily: "'JetBrains Mono', 'Geist Mono', monospace",
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: colors.text,
                  overflowX: 'auto',
                }}>
                  {children}
                </code>
              );
            }
            return (
              <code style={{
                background: colors.bgElevated,
                padding: '2px 6px',
                borderRadius: 4,
                fontFamily: "'JetBrains Mono', 'Geist Mono', monospace",
                fontSize: '0.9em',
                color: colors.accent,
              }}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre style={{ margin: '12px 0', background: 'transparent', padding: 0 }}>{children}</pre>
          ),
          blockquote: ({ children }) => (
            <blockquote style={{
              borderLeft: `3px solid ${colors.accent}`,
              paddingLeft: 16,
              margin: '12px 0',
              color: colors.textMuted,
              fontStyle: 'italic',
            }}>
              {children}
            </blockquote>
          ),
          ul: ({ children }) => (
            <ul style={{ margin: '8px 0', paddingLeft: 24, color: colors.text }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol style={{ margin: '8px 0', paddingLeft: 24, color: colors.text }}>{children}</ol>
          ),
          li: ({ children }) => (
            <li style={{ margin: '4px 0' }}>{children}</li>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
