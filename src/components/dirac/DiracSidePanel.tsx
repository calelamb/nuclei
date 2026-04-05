import { useState, useRef, useEffect, useCallback } from 'react';
import Markdown from 'react-markdown';
import { useDiracStore } from '../../stores/diracStore';
import type { ToolCall } from '../../stores/diracStore';
import { useDirac } from '../../hooks/useDirac';
import { useThemeStore } from '../../stores/themeStore';
import { useDiracPanelStore } from '../../stores/diracPanelStore';
import { useEditorStore } from '../../stores/editorStore';
import { useCircuitStore } from '../../stores/circuitStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { EASING, DURATION, getDuration, prefersReducedMotion } from '../../lib/animations';
import { ChevronRight, ChevronDown, Plus, ArrowUp, X } from 'lucide-react';

const SLASH_COMMANDS = [
  { command: '/explain', description: 'Explain the current circuit', insert: '/explain ' },
  { command: '/fix', description: 'Diagnose and fix the current error', insert: '/fix ' },
  { command: '/exercise', description: 'Start a new exercise', insert: '/exercise ' },
  { command: '/think', description: 'Enable reasoning mode', insert: '/think ' },
  { command: '/clear', description: 'Clear conversation history', insert: '/clear' },
] as const;

/* ── Context Indicator ── */
function ContextIndicator() {
  const colors = useThemeStore((s) => s.colors);
  const code = useEditorStore((s) => s.code);
  const snapshot = useCircuitStore((s) => s.snapshot);
  const result = useSimulationStore((s) => s.result);

  const items = [
    { label: 'code', active: code.trim().length > 0 },
    { label: 'circuit', active: !!snapshot && snapshot.gates.length > 0 },
    { label: 'results', active: !!result },
  ];

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 12px',
      fontSize: 11, fontFamily: "'Geist Sans', sans-serif",
      color: colors.textDim,
    }}>
      <span style={{ fontSize: 10 }}>Seeing:</span>
      {items.map((item) => (
        <span
          key={item.label}
          style={{
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 10, fontWeight: 500,
            background: item.active ? `${colors.accent}18` : colors.bgPanel,
            color: item.active ? colors.accent : colors.textDim,
            border: `1px solid ${item.active ? `${colors.accent}30` : 'transparent'}`,
            transition: 'all 150ms ease',
          }}
        >
          {item.label}
        </span>
      ))}
    </div>
  );
}

/* ── Slash command autocomplete ── */
function SlashCommandMenu({ query, onSelect }: { query: string; onSelect: (cmd: string) => void }) {
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const filtered = SLASH_COMMANDS.filter((c) => c.command.startsWith(query.toLowerCase()));
  if (filtered.length === 0) return null;

  return (
    <div style={{
      position: 'absolute', bottom: '100%', left: 0, right: 0,
      background: colors.bgElevated,
      border: `1px solid ${colors.border}`,
      borderRadius: '6px 6px 0 0',
      overflow: 'hidden', zIndex: 10,
      boxShadow: shadow.md,
    }}>
      {filtered.map((cmd) => (
        <button
          key={cmd.command}
          onClick={() => onSelect(cmd.insert)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            width: '100%', padding: '6px 12px',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: colors.text, fontSize: 12,
            fontFamily: "'Geist Sans', sans-serif", textAlign: 'left',
            transition: 'background 150ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = colors.border; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={{ color: colors.accent, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{cmd.command}</span>
          <span style={{ color: colors.textMuted }}>{cmd.description}</span>
        </button>
      ))}
    </div>
  );
}

/* ── Thinking block ── */
function ThinkingBlock({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false);
  const colors = useThemeStore((s) => s.colors);

  return (
    <div style={{
      margin: '6px 0', border: `1px solid ${colors.border}`,
      borderRadius: 4, borderLeft: `3px solid ${colors.dirac}`, overflow: 'hidden',
    }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          padding: '4px 8px', background: colors.bgPanel, border: 'none',
          cursor: 'pointer', color: colors.dirac, fontSize: 11,
          fontFamily: "'Geist Sans', sans-serif", fontStyle: 'italic',
        }}
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        Dirac's reasoning
      </button>
      {expanded && (
        <pre style={{
          margin: 0, padding: '6px 10px', fontSize: 11,
          fontFamily: "'JetBrains Mono', monospace", color: colors.textMuted,
          background: colors.bg, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 300, overflow: 'auto', lineHeight: 1.5,
        }}>
          {thinking}
        </pre>
      )}
    </div>
  );
}

/* ── Tool call card ── */
function ToolCallCard({ toolCall, onAction }: { toolCall: ToolCall; onAction: (id: string, accepted: boolean) => void }) {
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const isPending = toolCall.status === 'pending';
  const isAccepted = toolCall.status === 'accepted' || toolCall.status === 'executed';
  const statusColor = isPending ? colors.accent : isAccepted ? colors.success : colors.error;
  const statusText = isPending ? 'Pending' : isAccepted ? 'Applied' : 'Dismissed';

  if (toolCall.name === 'insert_code') {
    const { code, description } = toolCall.input as { code: string; position: string; description: string };
    return (
      <div style={{
        border: `1px solid ${colors.border}`, borderRadius: 6, margin: '8px 0',
        overflow: 'hidden', borderLeft: `3px solid ${statusColor}`,
        boxShadow: shadow.sm,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px', background: colors.bgPanel,
        }}>
          <span style={{ color: colors.accent, fontSize: 12, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>insert_code</span>
          <span style={{ color: colors.textMuted, fontSize: 11, flex: 1, fontFamily: "'Geist Sans', sans-serif" }}>{description || 'Code insertion'}</span>
          <span style={{ color: statusColor, fontSize: 10, fontFamily: "'Geist Sans', sans-serif" }}>{statusText}</span>
        </div>
        <pre style={{
          margin: 0, padding: 10, background: colors.bg,
          color: colors.text, fontSize: 12,
          fontFamily: "'JetBrains Mono', monospace",
          overflow: 'auto', maxHeight: 200,
        }}>{code}</pre>
        {isPending && (
          <div style={{ display: 'flex', gap: 8, padding: '6px 10px', background: colors.bgPanel }}>
            <button onClick={() => onAction(toolCall.id, true)} style={{
              padding: '4px 12px', background: colors.success, color: '#fff',
              border: 'none', borderRadius: 4, cursor: 'pointer',
              fontSize: 12, fontFamily: "'Geist Sans', sans-serif", transition: 'all 150ms ease',
            }}>Apply to Editor</button>
            <button onClick={() => onAction(toolCall.id, false)} style={{
              padding: '4px 12px', background: colors.border, color: colors.text,
              border: 'none', borderRadius: 4, cursor: 'pointer',
              fontSize: 12, fontFamily: "'Geist Sans', sans-serif", transition: 'all 150ms ease',
            }}>Dismiss</button>
          </div>
        )}
      </div>
    );
  }

  if (toolCall.name === 'run_simulation') {
    return (
      <div style={{
        border: `1px solid ${colors.border}`, borderRadius: 6, margin: '8px 0',
        padding: '6px 10px', borderLeft: `3px solid ${statusColor}`,
        background: colors.bgPanel, display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ color: colors.accent, fontSize: 12, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>run_simulation</span>
        <span style={{ color: colors.textMuted, fontSize: 11, flex: 1, fontFamily: "'Geist Sans', sans-serif" }}>{toolCall.input.shots ? `${toolCall.input.shots} shots` : 'Default shots'}</span>
        {isPending && (
          <button onClick={() => onAction(toolCall.id, true)} style={{
            padding: '3px 10px', background: colors.accent, color: '#fff',
            border: 'none', borderRadius: 4, cursor: 'pointer',
            fontSize: 11, fontFamily: "'Geist Sans', sans-serif",
          }}>Run</button>
        )}
        <span style={{ color: statusColor, fontSize: 10, fontFamily: "'Geist Sans', sans-serif" }}>{statusText}</span>
      </div>
    );
  }

  return (
    <div style={{
      border: `1px solid ${colors.border}`, borderRadius: 6, margin: '8px 0',
      padding: '6px 10px', borderLeft: `3px solid ${statusColor}`, background: colors.bgPanel,
    }}>
      <span style={{ color: colors.accent, fontSize: 12, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{toolCall.name}</span>
      <span style={{ color: statusColor, fontSize: 10, fontFamily: "'Geist Sans', sans-serif", marginLeft: 8 }}>{statusText}</span>
    </div>
  );
}

/* ── Thinking dots ── */
function ThinkingDots() {
  const colors = useThemeStore((s) => s.colors);
  return (
    <div style={{ display: 'flex', gap: 4, padding: '8px 0' }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{
          width: 5, height: 5, borderRadius: '50%',
          backgroundColor: colors.dirac,
          animation: prefersReducedMotion() ? 'none' : `nuclei-dots 1.2s ${EASING.enter} ${i * 150}ms infinite`,
        }} />
      ))}
    </div>
  );
}

/* ── Animated atom icon for empty state ── */
function AtomIcon() {
  const colors = useThemeStore((s) => s.colors);
  const reduced = prefersReducedMotion();
  return (
    <div style={{
      width: 48, height: 48, position: 'relative',
      margin: '0 auto 12px',
    }}>
      {/* Nucleus dot */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        width: 8, height: 8, borderRadius: '50%',
        background: colors.accentLight, transform: 'translate(-50%, -50%)',
        boxShadow: `0 0 12px ${colors.accent}60`,
      }} />
      {/* Orbiting electrons */}
      {[0, 60, 120].map((deg, i) => (
        <div key={i} style={{
          position: 'absolute', inset: 0,
          border: `1px solid ${colors.accent}30`,
          borderRadius: '50%',
          transform: `rotate(${deg}deg) scaleY(0.4)`,
        }}>
          <div style={{
            position: 'absolute', top: -3, left: '50%',
            width: 5, height: 5, borderRadius: '50%',
            background: colors.accentLight,
            transform: 'translateX(-50%)',
            boxShadow: `0 0 6px ${colors.accent}80`,
            animation: reduced ? 'none' : `nuclei-orbit 3s linear ${i * 1}s infinite`,
          }} />
        </div>
      ))}
    </div>
  );
}

/* ── Main Dirac Side Panel ── */
export function DiracSidePanel() {
  const { messages, isLoading } = useDiracStore();
  const { sendMessage, handleToolAction } = useDirac();
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const { isOpen, width, focusSignal, toggle, setWidth } = useDiracPanelStore();
  const clearHistory = useDiracStore((s) => s.clearHistory);

  const [input, setInput] = useState('');
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isDragging = useRef(false);
  const userScrolledUp = useRef(false);

  useEffect(() => {
    if (scrollRef.current && !userScrolledUp.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (focusSignal > 0) setTimeout(() => inputRef.current?.focus(), 50);
  }, [focusSignal]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    userScrolledUp.current = scrollHeight - scrollTop - clientHeight > 50;
  }, []);

  const handleInputChange = (value: string) => {
    setInput(value);
    if (value.startsWith('/') && !value.includes(' ')) {
      setShowSlashMenu(true); setSlashQuery(value);
    } else {
      setShowSlashMenu(false);
    }
  };

  const handleSlashSelect = (cmd: string) => {
    if (cmd === '/clear') { clearHistory(); setInput(''); }
    else setInput(cmd);
    setShowSlashMenu(false);
    inputRef.current?.focus();
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput(''); setShowSlashMenu(false);
    userScrolledUp.current = false;
    sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    else if (e.key === 'Escape') {
      const editor = document.querySelector('.monaco-editor textarea') as HTMLElement;
      editor?.focus();
    }
  };

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      setWidth(startWidth + (startX - e.clientX));
    };
    const onUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [width, setWidth]);

  if (!isOpen) {
    return (
      <div
        onClick={toggle}
        style={{
          width: 28, height: '100%',
          backgroundColor: colors.bgPanel,
          borderLeft: `1px solid ${colors.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', flexShrink: 0, writingMode: 'vertical-rl',
          transition: 'all 150ms ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = colors.bgElevated; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = colors.bgPanel; }}
        title="Open Dirac (⌘+D)"
        role="button" aria-label="Open Dirac panel" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') toggle(); }}
      >
        <span style={{
          color: colors.dirac, fontSize: 11, fontWeight: 600,
          fontFamily: "'Geist Sans', sans-serif", letterSpacing: 1,
        }}>DIRAC</span>
      </div>
    );
  }

  return (
    <div style={{
      width, height: '100%',
      display: 'flex', flexDirection: 'column',
      backgroundColor: colors.bg,
      borderLeft: `1px solid ${colors.border}`,
      boxShadow: shadow.md,
      flexShrink: 0, position: 'relative',
    }}>
      {/* Resize handle */}
      <div style={{
        position: 'absolute', left: -3, top: 0, bottom: 0, width: 6,
        cursor: 'col-resize', zIndex: 10,
      }} onMouseDown={handleResizeStart} />

      {/* Header with gradient */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px',
        borderBottom: `1px solid ${colors.border}`,
        flexShrink: 0,
        background: `linear-gradient(180deg, ${colors.dirac}0A 0%, transparent 100%)`,
      }}>
        <span style={{
          color: colors.dirac, fontSize: 13, fontWeight: 700,
          fontFamily: "'Geist Sans', sans-serif",
        }}>Dirac</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => clearHistory()}
          title="New conversation"
          style={{
            background: 'none', border: 'none',
            color: colors.textMuted, cursor: 'pointer',
            padding: '2px 6px', borderRadius: 4,
            display: 'flex', alignItems: 'center', gap: 3,
            fontSize: 11, fontFamily: "'Geist Sans', sans-serif",
            transition: 'all 150ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = colors.text; e.currentTarget.style.background = colors.bgElevated; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = colors.textMuted; e.currentTarget.style.background = 'none'; }}
        >
          <Plus size={12} /> New
        </button>
        <button
          onClick={toggle}
          title="Collapse Dirac (⌘+D)"
          style={{
            background: 'none', border: 'none',
            color: colors.textMuted, cursor: 'pointer',
            padding: '2px 4px', display: 'flex', alignItems: 'center',
            transition: 'color 150ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = colors.text; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = colors.textMuted; }}
          aria-label="Collapse Dirac panel"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} onScroll={handleScroll} style={{
        flex: 1, overflow: 'auto', padding: '8px 12px',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {messages.length === 0 && (
          <div style={{
            color: colors.textMuted, fontSize: 13,
            fontFamily: "'Geist Sans', sans-serif",
            textAlign: 'center', marginTop: 48, lineHeight: 1.7,
          }}>
            <AtomIcon />
            <div style={{ color: colors.accentLight, fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
              Hi, I'm Dirac
            </div>
            <div style={{ fontSize: 13, color: colors.textMuted }}>Your quantum computing tutor.</div>
            <div style={{ fontSize: 12, marginTop: 16, color: colors.textDim }}>
              Try a slash command like{' '}
              <code style={{
                background: colors.bgElevated, padding: '2px 6px', borderRadius: 4,
                fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: colors.accent,
                border: `1px solid ${colors.border}`,
              }}>/explain</code>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{
            animation: prefersReducedMotion() ? 'none' : `nuclei-slide-up ${DURATION.normal}ms ${EASING.enter}`,
          }}>
            {msg.role === 'user' ? (
              <div style={{
                padding: '8px 12px', borderRadius: 8,
                background: colors.bgElevated,
                color: colors.text, fontSize: 13,
                fontFamily: "'Geist Sans', sans-serif",
                lineHeight: 1.5,
                boxShadow: shadow.sm,
              }}>
                {msg.content}
              </div>
            ) : (
              <div style={{
                padding: '8px 0 8px 12px',
                borderLeft: `2px solid ${colors.dirac}`,
                boxShadow: `inset 3px 0 8px -3px ${colors.dirac}15`,
                color: colors.text, fontSize: 13,
                fontFamily: "'Geist Sans', sans-serif",
                lineHeight: 1.6,
              }}>
                {msg.thinking && <ThinkingBlock thinking={msg.thinking} />}
                {msg.content && (
                  <div className="dirac-markdown">
                    <Markdown>{msg.content || (isLoading && i === messages.length - 1 ? '...' : '')}</Markdown>
                  </div>
                )}
                {msg.toolCalls?.map((tc) => (
                  <ToolCallCard key={tc.id} toolCall={tc} onAction={handleToolAction} />
                ))}
              </div>
            )}
            <div style={{
              fontSize: 10, color: colors.textDim,
              fontFamily: "'Geist Sans', sans-serif",
              marginTop: 2,
              textAlign: msg.role === 'user' ? 'right' : 'left',
              paddingLeft: msg.role === 'assistant' ? 12 : 0,
            }}>
              {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        ))}

        {isLoading && messages.length > 0 && messages[messages.length - 1].role !== 'assistant' && (
          <div style={{ paddingLeft: 12, borderLeft: `2px solid ${colors.dirac}` }}>
            <ThinkingDots />
          </div>
        )}
      </div>

      <ContextIndicator />

      {/* Input area */}
      <div style={{
        padding: '8px 12px',
        borderTop: `1px solid ${colors.border}`,
        flexShrink: 0, position: 'relative',
      }}>
        {showSlashMenu && <SlashCommandMenu query={slashQuery} onSelect={handleSlashSelect} />}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Dirac anything..."
            disabled={isLoading}
            rows={1}
            style={{
              flex: 1, padding: '8px 12px', fontSize: 13,
              fontFamily: "'Geist Sans', sans-serif",
              background: colors.bgPanel,
              border: `1px solid ${colors.border}`,
              borderRadius: 6, color: colors.text,
              outline: 'none', resize: 'none',
              minHeight: 36, maxHeight: 120, lineHeight: 1.4,
              transition: 'border-color 150ms ease, box-shadow 150ms ease',
            }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 120) + 'px';
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = colors.accent;
              e.currentTarget.style.boxShadow = `0 0 0 1px ${colors.accent}, 0 0 8px rgba(0,180,216,0.2)`;
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = colors.border;
              e.currentTarget.style.boxShadow = 'none';
            }}
          />
          {input.trim() && (
            <button
              onClick={handleSend}
              disabled={isLoading}
              style={{
                width: 32, height: 32,
                background: colors.dirac, color: '#fff',
                border: 'none', borderRadius: 6,
                cursor: isLoading ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, opacity: isLoading ? 0.5 : 1,
                transition: 'all 150ms ease',
              }}
              onMouseEnter={(e) => { if (!isLoading) e.currentTarget.style.boxShadow = `0 0 10px ${colors.dirac}50`; }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
              aria-label="Send message"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
