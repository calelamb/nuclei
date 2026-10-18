import { useState, useRef, useEffect, useCallback } from 'react';
import { useDiracStore } from '../../stores/diracStore';
import type { ToolCall } from '../../stores/diracStore';
import { useDirac } from '../../hooks/useDirac';
import { useThemeStore } from '../../stores/themeStore';
import { useDiracPanelStore } from '../../stores/diracPanelStore';
import { useEditorStore } from '../../stores/editorStore';
import { useCircuitStore } from '../../stores/circuitStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useExperimentUiStore } from '../../stores/experimentUiStore';
import { EASING, DURATION, prefersReducedMotion } from '../../lib/animations';
import { useUiFeatures } from '../../hooks/useUiFeatures';
import { AgentEntryPoint } from './AgentEntryPoint';
import { DiracNoKey } from './DiracNoKey';
import { DiracMarkdown } from './DiracMarkdown';
import { DiracEmptyState } from './DiracEmptyState';
import { DiracErrorCard } from './DiracErrorCard';
import { SlashCommandMenu } from './SlashCommandMenu';
import { SLASH_COMMANDS, filterSlashCommands, isUnfinishedSlashInput, type SlashCommand } from '../../lib/diracCommands';
import { formatMessageTime } from '../../lib/formatMessageTime';
import { ChevronRight, ChevronDown, Plus, ArrowUp } from 'lucide-react';
import { Button, IconButton, TextArea, Tooltip } from '../ui';
import { shortcutLabel } from '../../config/keybindings';
import './dirac.css';

import { TYPOGRAPHY } from '../../styles/tokens';
/* ── Ambient Feed ── */
function AmbientFeed() {
  const ambientFeed = useDiracStore((s) => s.ambientFeed);
  const colors = useThemeStore((s) => s.colors);
  if (ambientFeed.length === 0) return null;
  return (
    <div
      aria-label="Dirac narration"
      style={{
        padding: '6px 12px',
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        maxHeight: 120,
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {ambientFeed.slice(-5).map((msg) => (
        <div
          key={msg.id}
          title={new Date(msg.timestamp).toLocaleTimeString()}
          style={{
            fontSize: 11,
            color: colors.textDim,
            lineHeight: 1.4,
            fontFamily: TYPOGRAPHY.fontSans,
            opacity: 0.9,
          }}
        >
          <span style={{ color: colors.accentText, marginRight: 6 }}>·</span>
          {msg.text}
        </div>
      ))}
    </div>
  );
}

/* ── Context Indicator ── */
function ContextIndicator() {
  const colors = useThemeStore((s) => s.colors);
  const code = useEditorStore((s) => s.code);
  const snapshot = useCircuitStore((s) => s.snapshot);
  const result = useSimulationStore((s) => s.result);
  const workspaceMode = useWorkspaceStore((s) => s.mode);
  const hasExperiment = useExperimentUiStore((s) => s.selectedExperimentFileName !== null);

  const items = [
    { label: 'code', active: code.trim().length > 0 },
    { label: 'circuit', active: !!snapshot && snapshot.gates.length > 0 },
    { label: 'results', active: !!result },
    // Research only: Dirac also sees the experiment (and run) open in the Experiments panel.
    ...(workspaceMode === 'research' ? [{ label: 'experiment', active: hasExperiment }] : []),
  ];

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 12px',
      fontSize: 11, fontFamily: TYPOGRAPHY.fontSans,
      color: colors.textDim,
    }}>
      <span style={{ fontSize: 11 }}>Seeing:</span>
      {items.map((item) => (
        <span
          key={item.label}
          style={{
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 11, fontWeight: 500,
            background: item.active ? `${colors.accent}18` : colors.bgPanel,
            color: item.active ? colors.accentText : colors.textDim,
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

/* ── Thinking block ── */
function ThinkingBlock({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false);
  const colors = useThemeStore((s) => s.colors);

  return (
    <div style={{
      margin: '6px 0', border: `1px solid ${colors.border}`,
      borderRadius: 4, borderLeft: `3px solid ${colors.dirac}`, overflow: 'hidden',
    }}>
      <button type="button" className="dirac-think__toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Dirac's reasoning
      </button>
      {expanded && (
        <pre style={{
          margin: 0, padding: '6px 10px', fontSize: 11,
          fontFamily: TYPOGRAPHY.fontMono, color: colors.textMuted,
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
          <span style={{ color: colors.accentText, fontSize: 12, fontWeight: 600, fontFamily: TYPOGRAPHY.fontMono }}>insert_code</span>
          <span style={{ color: colors.textMuted, fontSize: 11, flex: 1, fontFamily: TYPOGRAPHY.fontSans }}>{description || 'Code insertion'}</span>
          <span style={{ color: statusColor, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans }}>{statusText}</span>
        </div>
        <pre style={{
          margin: 0, padding: 10, background: colors.bg,
          color: colors.text, fontSize: 12,
          fontFamily: TYPOGRAPHY.fontMono,
          overflow: 'auto', maxHeight: 200,
        }}>{code}</pre>
        {isPending && (
          <div style={{ display: 'flex', gap: 8, padding: '6px 10px', background: colors.bgPanel }}>
            <Button size="sm" variant="primary" onClick={() => onAction(toolCall.id, true)}>Apply to Editor</Button>
            <Button size="sm" variant="secondary" onClick={() => onAction(toolCall.id, false)}>Dismiss</Button>
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
        <span style={{ color: colors.accentText, fontSize: 12, fontWeight: 600, fontFamily: TYPOGRAPHY.fontMono }}>run_simulation</span>
        <span style={{ color: colors.textMuted, fontSize: 11, flex: 1, fontFamily: TYPOGRAPHY.fontSans }}>{toolCall.input.shots ? `${toolCall.input.shots} shots` : 'Default shots'}</span>
        {isPending && (
          <Button size="sm" variant="primary" onClick={() => onAction(toolCall.id, true)}>Run</Button>
        )}
        <span style={{ color: statusColor, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans }}>{statusText}</span>
      </div>
    );
  }

  return (
    <div style={{
      border: `1px solid ${colors.border}`, borderRadius: 6, margin: '8px 0',
      padding: '6px 10px', borderLeft: `3px solid ${statusColor}`, background: colors.bgPanel,
    }}>
      <span style={{ color: colors.accentText, fontSize: 12, fontWeight: 600, fontFamily: TYPOGRAPHY.fontMono }}>{toolCall.name}</span>
      <span style={{ color: statusColor, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans, marginLeft: 8 }}>{statusText}</span>
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

/* ── Main Dirac Side Panel ── */
export function DiracSidePanel() {
  const { messages, isLoading } = useDiracStore();
  const apiKey = useDiracStore((s) => s.apiKey);
  const { sendMessage, handleToolAction } = useDirac();
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const { isOpen, width, focusSignal, toggle, setWidth } = useDiracPanelStore();
  const pendingPrompt = useDiracPanelStore((s) => s.pendingPrompt);
  const clearPendingPrompt = useDiracPanelStore((s) => s.clearPendingPrompt);
  const keyEntryOpen = useDiracPanelStore((s) => s.keyEntryOpen);
  const clearHistory = useDiracStore((s) => s.clearHistory);
  const hasApiKey = Boolean(apiKey && apiKey.trim() !== '');
  const { agentEntry } = useUiFeatures();

  const [input, setInput] = useState('');
  const [slashActive, setSlashActive] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isDragging = useRef(false);
  const userScrolledUp = useRef(false);
  const railRef = useRef<HTMLButtonElement>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(isOpen);

  // Folding or unfolding the panel removes the control that had focus; hand focus to the
  // counterpart (rail tab / collapse button) rather than letting it fall to <body>. Only when
  // focus really was lost, so an editor that still has it keeps it.
  useEffect(() => {
    if (wasOpen.current === isOpen) return undefined;
    wasOpen.current = isOpen;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      (isOpen ? collapseRef.current : railRef.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  useEffect(() => {
    if (scrollRef.current && !userScrolledUp.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Saving a key swaps the connect card for the chat; the focused key field is gone, so land on the composer.
  const showConnect = !hasApiKey || keyEntryOpen;
  const wasShowingConnect = useRef(showConnect);
  useEffect(() => {
    const cardJustClosed = wasShowingConnect.current && !showConnect;
    wasShowingConnect.current = showConnect;
    if (cardJustClosed && (!document.activeElement || document.activeElement === document.body)) {
      inputRef.current?.focus();
    }
  }, [showConnect]);

  useEffect(() => {
    if (focusSignal === 0) return undefined;
    // With no key the composer does not exist: the API key field is the input to focus.
    const timer = setTimeout(() => {
      const target = inputRef.current ?? document.querySelector<HTMLElement>('section[aria-label="Connect Dirac"] input');
      target?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [focusSignal]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    userScrolledUp.current = scrollHeight - scrollTop - clientHeight > 50;
  }, []);

  const [slashHint, setSlashHint] = useState<string | null>(null);
  const slashCommands = input.startsWith('/') && !input.includes(' ') ? filterSlashCommands(input) : [];
  const showSlashMenu = slashCommands.length > 0 && !slashDismissed;

  const handleInputChange = (value: string) => {
    setInput(value);
    setSlashActive(0);
    setSlashDismissed(false);
    setSlashHint(null);
  };

  const handleSlashSelect = (cmd: SlashCommand) => {
    if (cmd.command === '/clear') { clearHistory(); setInput(''); }
    else setInput(cmd.insert);
    inputRef.current?.focus();
  };

  const dispatch = useCallback((raw: string): boolean => {
    const text = raw.trim();
    if (!text || isLoading) return false;
    if (isUnfinishedSlashInput(text)) {
      setSlashHint(text === '/' ? 'Pick a command from the list, or type a question.' : `Unknown command ${text}. Try /explain, /fix or /exercise.`);
      return false;
    }
    if (text.toLowerCase() === '/clear') { clearHistory(); return true; }
    setSlashHint(null);
    userScrolledUp.current = false;
    void sendMessage(text);
    return true;
  }, [isLoading, sendMessage, clearHistory]);

  const submit = (raw: string) => {
    if (dispatch(raw)) setInput('');
  };

  const handleSend = () => submit(input);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSlashMenu) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashActive((i) => (i + 1) % slashCommands.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashActive((i) => (i - 1 + slashCommands.length) % slashCommands.length); return; }
      const exact = SLASH_COMMANDS.some((c) => c.command === input.trim().toLowerCase());
      if (e.key === 'Enter' && exact) { e.preventDefault(); handleSend(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleSlashSelect(slashCommands[Math.min(slashActive, slashCommands.length - 1)]);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setSlashDismissed(true); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    else if (e.key === 'Escape') {
      const editor = document.querySelector('.monaco-editor textarea') as HTMLElement;
      editor?.focus();
    }
  };

  // A question queued from a lesson card is sent once Dirac is connected and idle.
  useEffect(() => {
    if (!pendingPrompt || !hasApiKey || isLoading) return;
    clearPendingPrompt();
    userScrolledUp.current = false;
    void sendMessage(pendingPrompt.trim());
  }, [pendingPrompt, hasApiKey, isLoading, clearPendingPrompt, sendMessage]);

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
      <Tooltip label="Open Dirac" shortcut={shortcutLabel('toggle-dirac')} placement="above">
        <button
          ref={railRef}
          type="button"
          className="dirac-rail"
          onClick={toggle}
          aria-label="Open Dirac panel"
        >
          <span className="dirac-rail__label">DIRAC</span>
        </button>
      </Tooltip>
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
          color: colors.diracText, fontSize: 13, fontWeight: 700,
          fontFamily: TYPOGRAPHY.fontSans,
        }}>Dirac</span>
        <div style={{ flex: 1 }} />
        <Tooltip label="New conversation" placement="below">
          <Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => clearHistory()}>
            New
          </Button>
        </Tooltip>
        <IconButton ref={collapseRef} size="sm" onClick={toggle} aria-label="Collapse Dirac panel" tooltip={{ label: 'Collapse Dirac', shortcut: shortcutLabel('toggle-dirac'), placement: 'below' }}>
          <ChevronRight size={14} />
        </IconButton>
      </div>

      {hasApiKey && agentEntry && <AgentEntryPoint />}

      {showConnect ? (
        /* No (or rejected) API key: connect inline instead of showing chat */
        <div className="dirac-connect">
          <DiracNoKey replacing={hasApiKey} />
        </div>
      ) : (
        <>
      {/* Ambient narration feed — dim one-liners that Dirac emits automatically */}
      <AmbientFeed />
      {/* Messages */}
      <div ref={scrollRef} onScroll={handleScroll} style={{
        flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 12px',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {messages.length === 0 && <DiracEmptyState onPick={submit} />}

        {messages.map((msg) => (
          <div key={msg.id} style={{
            animation: prefersReducedMotion() ? 'none' : `nuclei-slide-up ${DURATION.normal}ms ${EASING.enter}`,
          }}>
            {msg.role === 'user' ? (
              <div style={{
                padding: '8px 12px', borderRadius: 8,
                background: colors.bgElevated,
                color: colors.text, fontSize: 13,
                fontFamily: TYPOGRAPHY.fontSans,
                lineHeight: 1.5,
                boxShadow: shadow.sm,
              }}>
                {msg.content}
              </div>
            ) : (
              <div style={{
                padding: '8px 0 8px 12px',
                borderLeft: msg.error ? '2px solid transparent' : `2px solid ${colors.dirac}`,
                boxShadow: msg.error ? 'none' : `inset 3px 0 8px -3px ${colors.dirac}15`,
                color: colors.text, fontSize: 13,
                fontFamily: TYPOGRAPHY.fontSans,
                lineHeight: 1.6,
              }}>
                {msg.thinking && <ThinkingBlock thinking={msg.thinking} />}
                {msg.error && <DiracErrorCard error={msg.error} />}
                {msg.content && (
                  <DiracMarkdown content={msg.content} />
                )}
                {msg.toolCalls?.map((tc) => (
                  <ToolCallCard key={tc.id} toolCall={tc} onAction={handleToolAction} />
                ))}
              </div>
            )}
            <div style={{
              fontSize: 11, color: colors.textDim,
              fontFamily: TYPOGRAPHY.fontSans,
              marginTop: 2,
              textAlign: msg.role === 'user' ? 'right' : 'left',
              paddingLeft: msg.role === 'assistant' ? 12 : 0,
            }}>
              {formatMessageTime(msg.timestamp)}
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
        {showSlashMenu && (
          <SlashCommandMenu
            id="dirac-slash-menu"
            commands={slashCommands}
            activeIndex={Math.min(slashActive, slashCommands.length - 1)}
            onSelect={handleSlashSelect}
            onHover={setSlashActive}
          />
        )}
        {slashHint && <div role="status" className="dirac-slash-hint">{slashHint}</div>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <TextArea
            ref={inputRef}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Dirac anything..."
            aria-label="Message Dirac"
            aria-controls={showSlashMenu ? 'dirac-slash-menu' : undefined}
            aria-activedescendant={showSlashMenu ? `dirac-slash-menu-${Math.min(slashActive, slashCommands.length - 1)}` : undefined}
            disabled={isLoading}
            rows={1}
            className="dirac-input"
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 120) + 'px';
            }}
          />
          {input.trim() && (
            <IconButton
              variant="secondary"
              onClick={handleSend}
              disabled={isLoading}
              className="dirac-send"
              aria-label="Send message"
            >
              <ArrowUp size={16} />
            </IconButton>
          )}
        </div>
      </div>
        </>
      )}
    </div>
  );
}
