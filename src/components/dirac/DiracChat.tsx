import { useState, useRef, useEffect } from 'react';
import Markdown from 'react-markdown';
import { useDiracStore } from '../../stores/diracStore';
import { useDirac } from '../../hooks/useDirac';

function ApiKeySetup({ onSave }: { onSave: (key: string) => void }) {
  const [key, setKey] = useState('');

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
      <div style={{ color: '#7B2D8E', fontWeight: 600, fontSize: 16, fontFamily: 'Inter, sans-serif' }}>
        Dirac AI Setup
      </div>
      <div style={{ color: '#E0E0E0', fontSize: 13, fontFamily: 'Inter, sans-serif', textAlign: 'center', maxWidth: 350 }}>
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
            fontFamily: "'Fira Code', monospace",
            background: '#0A1220',
            border: '1px solid #1A2A42',
            borderRadius: 4,
            color: '#E0E0E0',
            outline: 'none',
          }}
          onKeyDown={(e) => { if (e.key === 'Enter' && key.trim()) onSave(key.trim()); }}
        />
        <button
          onClick={() => { if (key.trim()) onSave(key.trim()); }}
          style={{
            padding: '8px 16px',
            background: '#7B2D8E',
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

export function DiracChat() {
  const { messages, isLoading, apiKey } = useDiracStore();
  const { sendMessage, saveApiKey } = useDirac();
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
            color: '#3D5A80',
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
                      background: '#1A2A42',
                      color: '#E0E0E0',
                      borderBottomRightRadius: 2,
                    }
                  : {
                      background: '#0A1220',
                      color: '#E0E0E0',
                      borderLeft: '3px solid #7B2D8E',
                      borderBottomLeftRadius: 2,
                    }),
              }}
            >
              {msg.role === 'assistant' ? (
                <div className="dirac-markdown">
                  <Markdown>{msg.content || (isLoading && i === messages.length - 1 ? '...' : '')}</Markdown>
                </div>
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}
        {isLoading && messages.length > 0 && messages[messages.length - 1].role !== 'assistant' && (
          <div style={{
            color: '#7B2D8E',
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
        borderTop: '1px solid #1A2A42',
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
            background: '#0A1220',
            border: '1px solid #1A2A42',
            borderRadius: 4,
            color: '#E0E0E0',
            outline: 'none',
          }}
        />
        <button
          onClick={handleSend}
          disabled={isLoading || !input.trim()}
          style={{
            padding: '8px 16px',
            background: isLoading || !input.trim() ? '#1A2A42' : '#7B2D8E',
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
