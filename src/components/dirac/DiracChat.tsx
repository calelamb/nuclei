import { useState, useRef, useEffect } from 'react';
import Markdown from 'react-markdown';
import { useDiracStore } from '../../stores/diracStore';
import type { ToolCall } from '../../stores/diracStore';
import { useDirac } from '../../hooks/useDirac';
import { useThemeStore } from '../../stores/themeStore';

function ApiKeySetup({ onSave }: { onSave: (key: string) => void }) {
  const [key, setKey] = useState('');
  const colors = useThemeStore((s) => s.colors);

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      gap: 12,
    }}>
      <div style={{ color: colors.dirac, fontWeight: 600, fontSize: 16, fontFamily: 'Inter, sans-serif' }}>
        Dirac AI Setup
      </div>
      <div style={{ color: colors.text, fontSize: 13, fontFamily: 'Inter, sans-serif', textAlign: 'center', maxWidth: 350 }}>
        Enter your Claude API key to enable Dirac, your quantum computing tutor.
      </div>
      <div style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 400 }}>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-ant-api03-..."
          style={{
            flex: 1,
            padding: '8px 12px',
            fontSize: 13,
            fontFamily: "'Geist Mono', 'JetBrains Mono', monospace",
            background: colors.bgPanel,
            border: `1px solid ${colors.border}`,
            borderRadius: 4,
            color: colors.text,
            outline: 'none',
          }}
          onKeyDown={(e) => { if (e.key === 'Enter' && key.trim()) onSave(key.trim()); }}
        />
        <button
          onClick={() => { if (key.trim()) onSave(key.trim()); }}
          style={{
            padding: '8px 16px',
            background: colors.dirac,
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 13,
            fontFamily: 'Inter, sans-serif',
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function ThinkingBlock({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false);
  const colors = useThemeStore((s) => s.colors);

  return (
    <div style={{
      margin: '6px 0',
      border: `1px solid ${colors.border}`,
      borderRadius: 4,
      borderLeft: `3px solid ${colors.dirac}`,
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          padding: '4px 8px', background: colors.bgPanel, border: 'none',
          cursor: 'pointer', color: colors.dirac, fontSize: 11,
          fontFamily: 'Inter, sans-serif', fontStyle: 'italic',
        }}
      >
        <span>{expanded ? '▼' : '▶'}</span>
        Dirac's reasoning
      </button>
      {expanded && (
        <pre style={{
          margin: 0, padding: '6px 10px', fontSize: 11,
          fontFamily: "'Geist Mono', 'JetBrains Mono', monospace", color: colors.textMuted,
          background: colors.bg, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 300, overflow: 'auto', lineHeight: 1.5,
        }}>
          {thinking}
        </pre>
      )}
    </div>
  );
}

function ToolCallCard({ toolCall, onAction }: { toolCall: ToolCall; onAction: (id: string, accepted: boolean) => void }) {
  const [expanded, setExpanded] = useState(true);
  const colors = useThemeStore((s) => s.colors);

  const isPending = toolCall.status === 'pending';
  const isAccepted = toolCall.status === 'accepted' || toolCall.status === 'executed';
  const isRejected = toolCall.status === 'rejected';

  const statusColor = isPending ? colors.accent : isAccepted ? '#98C379' : colors.error;
  const statusText = isPending ? 'Pending' : isAccepted ? 'Applied' : 'Dismissed';

  if (toolCall.name === 'insert_code') {
    const { code, description } = toolCall.input as { code: string; position: string; description: string };
    return (
      <div style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        margin: '8px 0',
        overflow: 'hidden',
        borderLeft: `3px solid ${statusColor}`,
      }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            background: colors.bgPanel,
            cursor: 'pointer',
          }}
          onClick={() => setExpanded(!expanded)}
        >
          <span style={{ color: colors.accent, fontSize: 12, fontWeight: 600, fontFamily: 'Inter, sans-serif' }}>
            insert_code
          </span>
          <span style={{ color: colors.textMuted, fontSize: 11, flex: 1, fontFamily: 'Inter, sans-serif' }}>
            {description || 'Code insertion'}
          </span>
          <span style={{ color: statusColor, fontSize: 10, fontFamily: 'Inter, sans-serif' }}>
            {statusText}
          </span>
          <span style={{ color: colors.textMuted, fontSize: 10 }}>
            {expanded ? '▼' : '▶'}
          </span>
        </div>
        {expanded && (
          <div>
            <pre style={{
              margin: 0,
              padding: 10,
              background: colors.bg,
              color: colors.text,
              fontSize: 12,
              fontFamily: "'Geist Mono', 'JetBrains Mono', monospace",
              overflow: 'auto',
              maxHeight: 200,
            }}>
              {code}
            </pre>
            {isPending && (
              <div style={{ display: 'flex', gap: 8, padding: '6px 10px', background: colors.bgPanel }}>
                <button
                  onClick={() => onAction(toolCall.id, true)}
                  style={{
                    padding: '4px 12px',
                    background: '#98C379',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 3,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontFamily: 'Inter, sans-serif',
                  }}
                >
                  Apply
                </button>
                <button
                  onClick={() => onAction(toolCall.id, false)}
                  style={{
                    padding: '4px 12px',
                    background: colors.border,
                    color: colors.text,
                    border: 'none',
                    borderRadius: 3,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontFamily: 'Inter, sans-serif',
                  }}
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (toolCall.name === 'run_simulation') {
    return (
      <div style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        margin: '8px 0',
        padding: '6px 10px',
        borderLeft: `3px solid ${statusColor}`,
        background: colors.bgPanel,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{ color: colors.accent, fontSize: 12, fontWeight: 600, fontFamily: 'Inter, sans-serif' }}>
          run_simulation
        </span>
        <span style={{ color: colors.textMuted, fontSize: 11, flex: 1, fontFamily: 'Inter, sans-serif' }}>
          {toolCall.input.shots ? `${toolCall.input.shots} shots` : 'Default shots'}
        </span>
        {isPending && (
          <button
            onClick={() => onAction(toolCall.id, true)}
            style={{
              padding: '3px 10px',
              background: colors.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 3,
              cursor: 'pointer',
              fontSize: 11,
              fontFamily: 'Inter, sans-serif',
            }}
          >
            Run
          </button>
        )}
        <span style={{ color: statusColor, fontSize: 10, fontFamily: 'Inter, sans-serif' }}>
          {statusText}
        </span>
      </div>
    );
  }

  // Generic tool call display
  return (
    <div style={{
      border: `1px solid ${colors.border}`,
      borderRadius: 6,
      margin: '8px 0',
      padding: '6px 10px',
      borderLeft: `3px solid ${statusColor}`,
      background: colors.bgPanel,
    }}>
      <span style={{ color: colors.accent, fontSize: 12, fontWeight: 600, fontFamily: 'Inter, sans-serif' }}>
        {toolCall.name}
      </span>
      <span style={{ color: statusColor, fontSize: 10, fontFamily: 'Inter, sans-serif', marginLeft: 8 }}>
        {statusText}
      </span>
    </div>
  );
}

export function DiracChat() {
  const { messages, isLoading, apiKey } = useDiracStore();
  const { sendMessage, saveApiKey, handleToolAction } = useDirac();
  const colors = useThemeStore((s) => s.colors);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (!apiKey) {
    return <ApiKeySetup onSave={saveApiKey} />;
  }

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    sendMessage(text);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {messages.length === 0 && (
          <div style={{
            color: colors.textMuted,
            fontSize: 13,
            fontFamily: 'Inter, sans-serif',
            textAlign: 'center',
            marginTop: 20,
          }}>
            Ask Dirac anything about quantum computing.
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                maxWidth: '85%',
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: 13,
                fontFamily: 'Inter, sans-serif',
                lineHeight: 1.5,
                ...(msg.role === 'user'
                  ? {
                      background: colors.border,
                      color: colors.text,
                      borderBottomRightRadius: 2,
                    }
                  : {
                      background: colors.bgPanel,
                      color: colors.text,
                      borderLeft: `3px solid ${colors.dirac}`,
                      borderBottomLeftRadius: 2,
                    }),
              }}
            >
              {msg.role === 'assistant' ? (
                <div>
                  {msg.thinking && (
                    <ThinkingBlock thinking={msg.thinking} />
                  )}
                  {msg.content && (
                    <div className="dirac-markdown">
                      <Markdown>{msg.content || (isLoading && i === messages.length - 1 ? '...' : '')}</Markdown>
                    </div>
                  )}
                  {msg.toolCalls?.map((tc) => (
                    <ToolCallCard key={tc.id} toolCall={tc} onAction={handleToolAction} />
                  ))}
                </div>
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}
        {isLoading && messages.length > 0 && messages[messages.length - 1].role !== 'assistant' && (
          <div style={{
            color: colors.dirac,
            fontSize: 12,
            fontFamily: 'Inter, sans-serif',
            fontStyle: 'italic',
          }}>
            Dirac is thinking...
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{
        padding: '8px 12px',
        borderTop: `1px solid ${colors.border}`,
        display: 'flex',
        gap: 8,
      }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="Ask Dirac about quantum computing..."
          disabled={isLoading}
          style={{
            flex: 1,
            padding: '8px 12px',
            fontSize: 13,
            fontFamily: 'Inter, sans-serif',
            background: colors.bgPanel,
            border: `1px solid ${colors.border}`,
            borderRadius: 4,
            color: colors.text,
            outline: 'none',
          }}
        />
        <button
          onClick={handleSend}
          disabled={isLoading || !input.trim()}
          style={{
            padding: '8px 16px',
            background: isLoading || !input.trim() ? colors.border : colors.dirac,
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: isLoading || !input.trim() ? 'default' : 'pointer',
            fontSize: 13,
            fontFamily: 'Inter, sans-serif',
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
