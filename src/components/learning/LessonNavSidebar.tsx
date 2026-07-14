import { useMemo } from 'react';
import {
  CheckCircle2,
  Circle,
  Dot,
  PanelLeftClose,
  PanelLeft,
  BookOpen,
  Play,
  Code,
  HelpCircle,
  MessageSquare,
  Layers,
  type LucideIcon,
} from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useLearnStore } from '../../stores/learnStore';
import { getTrack } from '../../data/lessons/tracks';
import type { ContentBlock } from '../../data/lessons/types';

const BLOCK_META: Record<string, { icon: LucideIcon; label: string }> = {
  text: { icon: BookOpen, label: 'Read' },
  video: { icon: Play, label: 'Watch' },
  demo: { icon: Code, label: 'Demo' },
  exercise: { icon: HelpCircle, label: 'Exercise' },
  quiz: { icon: MessageSquare, label: 'Quiz' },
  'concept-card': { icon: Layers, label: 'Concept' },
  'interactive-bloch': { icon: Layers, label: 'Bloch sphere' },
};

function scrollToBlock(index: number) {
  document.getElementById(`block-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * The in-lesson navigation column (PRD-less polish): answers "where am I?"
 * inside a track. Shows the track ("epic") header with overall progress, the
 * full lesson list with completed/current/upcoming state (click to jump), and
 * the current lesson's block outline with a scroll-spy active highlight. Reads
 * `currentBlockIndex` (set by LessonView's IntersectionObserver) so the
 * outline tracks the reader. Collapsible to a thin rail.
 */
export function LessonNavSidebar({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const colors = useThemeStore((s) => s.colors);
  const currentTrackId = useLearnStore((s) => s.currentTrackId);
  const currentLessonId = useLearnStore((s) => s.currentLessonId);
  const currentBlockIndex = useLearnStore((s) => s.currentBlockIndex);
  const completedLessons = useLearnStore((s) => s.completedLessons);
  const setCurrentLesson = useLearnStore((s) => s.setCurrentLesson);

  const track = currentTrackId ? getTrack(currentTrackId) : undefined;
  const lessons = useMemo(() => track?.lessons ?? [], [track]);
  const currentLesson = lessons.find((l) => l.id === currentLessonId);
  const completedInTrack = lessons.filter((l) => completedLessons.includes(l.id)).length;

  if (!track) return null;

  if (collapsed) {
    return (
      <div
        style={{
          width: 40, flexShrink: 0, borderRight: `1px solid ${colors.border}`,
          background: colors.bgPanel, display: 'flex', flexDirection: 'column',
          alignItems: 'center', paddingTop: 8,
        }}
      >
        <button
          onClick={onToggleCollapsed}
          title="Show lesson navigation"
          aria-label="Show lesson navigation"
          style={iconBtn(colors)}
        >
          <PanelLeft size={16} />
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        width: 260, flexShrink: 0, borderRight: `1px solid ${colors.border}`,
        background: colors.bgPanel, display: 'flex', flexDirection: 'column',
        overflow: 'hidden', fontFamily: "'Geist Sans', sans-serif",
      }}
    >
      {/* Track (epic) header */}
      <div style={{ padding: '12px 12px 10px', borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.accent }}>
              Track
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginTop: 2, lineHeight: 1.25 }}>
              {track.title}
            </div>
          </div>
          <button onClick={onToggleCollapsed} title="Hide lesson navigation" aria-label="Hide lesson navigation" style={iconBtn(colors)}>
            <PanelLeftClose size={15} />
          </button>
        </div>
        {/* Track progress */}
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 4, borderRadius: 2, background: colors.border, overflow: 'hidden' }}>
            <div style={{ width: `${lessons.length ? (completedInTrack / lessons.length) * 100 : 0}%`, height: '100%', background: colors.accent, transition: 'width 300ms ease' }} />
          </div>
          <span style={{ fontSize: 10.5, color: colors.textDim, fontVariantNumeric: 'tabular-nums' }}>
            {completedInTrack}/{lessons.length}
          </span>
        </div>
      </div>

      {/* Lesson list + current-lesson outline */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 0' }}>
        {lessons.map((lesson, i) => {
          const isCurrent = lesson.id === currentLessonId;
          const isDone = completedLessons.includes(lesson.id);
          return (
            <div key={lesson.id}>
              <button
                onClick={() => setCurrentLesson(track.id, lesson.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                  padding: '7px 12px', background: isCurrent ? `${colors.accent}14` : 'transparent',
                  border: 'none', borderLeft: `2px solid ${isCurrent ? colors.accent : 'transparent'}`,
                  cursor: 'pointer', color: isCurrent ? colors.text : colors.textMuted,
                  fontWeight: isCurrent ? 600 : 400,
                }}
                onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = colors.bgElevated; }}
                onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = 'transparent'; }}
              >
                {isDone ? (
                  <CheckCircle2 size={15} style={{ color: colors.success, flexShrink: 0 }} />
                ) : isCurrent ? (
                  <Dot size={15} style={{ color: colors.accent, flexShrink: 0 }} />
                ) : (
                  <Circle size={13} style={{ color: colors.textDim, flexShrink: 0 }} />
                )}
                <span style={{ flex: 1, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {i + 1}. {lesson.title}
                </span>
              </button>

              {/* Outline of the current lesson's blocks (scroll-spy) */}
              {isCurrent && currentLesson && currentLesson.contentBlocks.length > 1 && (
                <div style={{ padding: '2px 0 6px' }}>
                  {currentLesson.contentBlocks.map((block: ContentBlock, bi) => {
                    const meta = BLOCK_META[block.type] ?? { icon: BookOpen, label: block.type };
                    const Icon = meta.icon;
                    const active = bi === currentBlockIndex;
                    return (
                      <button
                        key={bi}
                        onClick={() => scrollToBlock(bi)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 7, width: '100%', textAlign: 'left',
                          padding: '4px 12px 4px 34px', background: 'transparent', border: 'none',
                          cursor: 'pointer', color: active ? colors.accent : colors.textDim,
                          fontWeight: active ? 600 : 400,
                        }}
                        onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = colors.textMuted; }}
                        onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = colors.textDim; }}
                      >
                        <Icon size={11} style={{ flexShrink: 0 }} />
                        <span style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {meta.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function iconBtn(colors: { textMuted: string }): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 4,
    background: 'transparent', border: 'none', color: colors.textMuted, cursor: 'pointer',
  };
}
