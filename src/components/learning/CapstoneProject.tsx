import { useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Lightbulb, Play } from 'lucide-react';
import { useCapstoneStore } from '../../stores/capstoneStore';
import { useEditorStore } from '../../stores/editorStore';
import { useThemeStore } from '../../stores/themeStore';

export function CapstoneProjectView() {
  const colors = useThemeStore((s) => s.colors);
  const { activeProject, activeMilestoneIndex, completedMilestones, completeMilestone, exitProject } = useCapstoneStore();
  const setCode = useEditorStore((s) => s.setCode);
  const [revealedHints, setRevealedHints] = useState(0);

  if (!activeProject) return null;

  const projectCompleted = completedMilestones[activeProject.id] ?? [];
  const currentMilestone = activeProject.milestones[activeMilestoneIndex];

  const showNextHint = () => {
    if (currentMilestone && revealedHints < currentMilestone.hints.length) {
      setRevealedHints((h) => h + 1);
    }
  };

  const loadStarter = () => {
    if (currentMilestone) {
      setCode(currentMilestone.starterCode);
    }
  };

  const handleComplete = () => {
    completeMilestone();
    setRevealedHints(0);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
        <button
          onClick={exitProject}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: 'none',
            border: 'none',
            color: colors.textMuted,
            cursor: 'pointer',
            fontSize: 11,
            fontFamily: 'Geist Sans, Inter, sans-serif',
            padding: 0,
            marginBottom: 6,
          }}
        >
          <ArrowLeft size={12} />
          Back to projects
        </button>
        <div style={{ color: colors.text, fontSize: 14, fontWeight: 600, fontFamily: 'Geist Sans, Inter, sans-serif' }}>
          {activeProject.title}
        </div>
        <div style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Geist Sans, Inter, sans-serif', lineHeight: 1.4, marginTop: 4 }}>
          {activeProject.description.length > 120 ? activeProject.description.slice(0, 120) + '...' : activeProject.description}
        </div>
      </div>

      {/* Milestone timeline */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
        {activeProject.milestones.map((milestone, i) => {
          const isCompleted = projectCompleted.includes(milestone.id);
          const isCurrent = i === activeMilestoneIndex;
          const isFuture = !isCompleted && !isCurrent;

          const circleColor = isCompleted ? colors.success : isCurrent ? colors.accent : colors.textDim;

          return (
            <div key={milestone.id} style={{ marginBottom: 12 }}>
              {/* Milestone header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                {/* Number circle */}
                <div style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: circleColor,
                  color: isCompleted || isCurrent ? '#fff' : colors.bgPanel,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: 'Geist Sans, Inter, sans-serif',
                  flexShrink: 0,
                  marginTop: 1,
                }}>
                  {isCompleted ? '\u2713' : i + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{
                    color: isFuture ? colors.textDim : colors.text,
                    fontSize: 12,
                    fontWeight: 500,
                    fontFamily: 'Geist Sans, Inter, sans-serif',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}>
                    {isCurrent ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    {milestone.title}
                  </div>

                  {/* Expanded current milestone */}
                  {isCurrent && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Geist Sans, Inter, sans-serif', lineHeight: 1.5, marginBottom: 8 }}>
                        {milestone.description}
                      </div>

                      {/* Action buttons */}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                        <button
                          onClick={loadStarter}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '4px 10px',
                            background: colors.accent,
                            color: '#fff',
                            border: 'none',
                            borderRadius: 3,
                            cursor: 'pointer',
                            fontSize: 11,
                            fontFamily: 'Geist Sans, Inter, sans-serif',
                          }}
                        >
                          <Play size={10} />
                          Load Starter Code
                        </button>
                        <button
                          onClick={handleComplete}
                          style={{
                            padding: '4px 10px',
                            background: 'transparent',
                            color: colors.success,
                            border: `1px solid ${colors.success}`,
                            borderRadius: 3,
                            cursor: 'pointer',
                            fontSize: 11,
                            fontFamily: 'Geist Sans, Inter, sans-serif',
                          }}
                        >
                          Mark Complete
                        </button>
                      </div>

                      {/* Hints */}
                      {milestone.hints.length > 0 && (
                        <div style={{ marginBottom: 8 }}>
                          {milestone.hints.slice(0, revealedHints).map((hint, hi) => (
                            <div
                              key={hi}
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 6,
                                padding: '4px 8px',
                                background: colors.warning + '12',
                                borderRadius: 4,
                                marginBottom: 4,
                              }}
                            >
                              <Lightbulb size={11} color={colors.warning} style={{ flexShrink: 0, marginTop: 2 }} />
                              <span style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Geist Sans, Inter, sans-serif', lineHeight: 1.4 }}>
                                {hint}
                              </span>
                            </div>
                          ))}
                          {revealedHints < milestone.hints.length && (
                            <button
                              onClick={showNextHint}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                background: 'none',
                                border: 'none',
                                color: colors.warning,
                                cursor: 'pointer',
                                fontSize: 10,
                                fontFamily: 'Geist Sans, Inter, sans-serif',
                                padding: '2px 0',
                              }}
                            >
                              <Lightbulb size={10} />
                              Show Hint ({revealedHints + 1}/{milestone.hints.length})
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Connector line between milestones */}
              {i < activeProject.milestones.length - 1 && (
                <div style={{ marginLeft: 10, width: 2, height: 8, background: colors.border }} />
              )}
            </div>
          );
        })}

        {/* Dirac guidance callout */}
        {activeProject.diracGuidancePrompt && (
          <div style={{
            marginTop: 8,
            padding: 10,
            borderRadius: 6,
            border: `1px solid ${colors.dirac}44`,
            background: colors.dirac + '0A',
          }}>
            <div style={{ color: colors.dirac, fontSize: 10, fontWeight: 600, fontFamily: 'Geist Sans, Inter, sans-serif', marginBottom: 4 }}>
              Dirac Guidance
            </div>
            <div style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Geist Sans, Inter, sans-serif', lineHeight: 1.4 }}>
              {activeProject.diracGuidancePrompt.length > 200 ? activeProject.diracGuidancePrompt.slice(0, 200) + '...' : activeProject.diracGuidancePrompt}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
