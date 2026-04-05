import { useState } from 'react';
import { useLearningStore } from '../../stores/learningStore';
import type { LearningPath, LearningModule } from '../../stores/learningStore';
import { useEditorStore } from '../../stores/editorStore';
import { useThemeStore } from '../../stores/themeStore';
import { useCapstoneStore } from '../../stores/capstoneStore';
import { LEARNING_PATHS } from '../../data/learningPaths';
import { CAPSTONE_PROJECTS } from '../../data/capstoneProjects';
import { ConceptMap } from './ConceptMap';
import { Glossary } from './Glossary';
import { CapstoneCard } from './CapstoneCard';
import { CapstoneProjectView } from './CapstoneProject';

type TabKey = 'paths' | 'concepts' | 'capstones' | 'glossary';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'paths', label: 'Paths' },
  { key: 'concepts', label: 'Concepts' },
  { key: 'capstones', label: 'Capstones' },
  { key: 'glossary', label: 'Glossary' },
];

function PathSelector({ onSelect }: { onSelect: (path: LearningPath) => void }) {
  const colors = useThemeStore((s) => s.colors);
  const pathProgress = useLearningStore((s) => s.pathProgress);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ color: colors.accent, fontWeight: 700, fontSize: 16, fontFamily: 'Geist Sans, Inter, sans-serif', marginBottom: 12 }}>
        Learning Paths
      </div>
      <div style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Geist Sans, Inter, sans-serif', marginBottom: 16 }}>
        Choose a structured path to learn quantum computing step by step.
      </div>
      {LEARNING_PATHS.map((path) => {
        const progress = pathProgress[path.id];
        const completedCount = progress
          ? Object.values(progress.modules).filter((m) => m.completed).length
          : 0;
        const totalCount = path.modules.length;

        return (
          <button
            key={path.id}
            onClick={() => onSelect(path)}
            style={{
              display: 'block',
              width: '100%',
              padding: 12,
              marginBottom: 8,
              background: colors.bgPanel,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div style={{ color: colors.text, fontSize: 14, fontWeight: 600, fontFamily: 'Geist Sans, Inter, sans-serif' }}>
              {path.title}
            </div>
            <div style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Geist Sans, Inter, sans-serif', marginTop: 4 }}>
              {path.description}
            </div>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, height: 3, borderRadius: 2, background: colors.border }}>
                <div style={{ width: `${(completedCount / totalCount) * 100}%`, height: '100%', borderRadius: 2, background: colors.accent, transition: 'width 0.3s' }} />
              </div>
              <span style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Geist Sans, Inter, sans-serif' }}>
                {completedCount}/{totalCount}
              </span>
            </div>
            {progress && (
              <div style={{ color: colors.accentLight, fontSize: 11, fontFamily: 'Geist Sans, Inter, sans-serif', marginTop: 4 }}>
                Continue from module {progress.currentModuleIndex + 1}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ModuleCard({ module, index, isActive, isCompleted, onClick }: {
  module: LearningModule; index: number; isActive: boolean; isCompleted: boolean; onClick: () => void;
}) {
  const colors = useThemeStore((s) => s.colors);
  const diffColors = { beginner: '#98C379', intermediate: '#D19A66', advanced: '#E06C75' };

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        width: '100%',
        padding: '8px 12px',
        background: isActive ? colors.border : 'transparent',
        border: 'none',
        borderLeft: isActive ? `3px solid ${colors.accent}` : '3px solid transparent',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span style={{
        width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: isCompleted ? colors.accent : colors.border,
        color: isCompleted ? '#fff' : colors.textMuted,
        fontSize: 10, fontWeight: 600, fontFamily: 'Geist Sans, Inter, sans-serif',
      }}>
        {isCompleted ? '\u2713' : index + 1}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ color: isActive ? colors.accent : colors.text, fontSize: 12, fontWeight: 500, fontFamily: 'Geist Sans, Inter, sans-serif' }}>
          {module.title}
        </div>
        <span style={{
          fontSize: 9, fontFamily: 'Geist Sans, Inter, sans-serif',
          color: diffColors[module.difficulty],
        }}>
          {module.difficulty}
        </span>
      </div>
    </button>
  );
}

function ActiveModuleView() {
  const { activePath, activeModuleIndex, setActiveModule, markDemoViewed, markModuleComplete, exitPath } = useLearningStore();
  const setCode = useEditorStore((s) => s.setCode);
  const colors = useThemeStore((s) => s.colors);
  const pathProgress = useLearningStore((s) => s.pathProgress);
  const [showQuiz, setShowQuiz] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});

  if (!activePath) return null;
  const module = activePath.modules[activeModuleIndex];
  if (!module) return null;

  const progress = pathProgress[activePath.id]?.modules[module.id];
  const isCompleted = progress?.completed ?? false;

  const loadDemo = () => {
    setCode(module.demoCode);
    markDemoViewed(activePath.id, module.id);
  };

  const handleQuizSubmit = () => {
    const correct = module.quizQuestions.filter((q) => quizAnswers[q.id] === q.correctIndex).length;
    const total = module.quizQuestions.length;
    if (correct === total) {
      markModuleComplete(activePath.id, module.id);
    }
    setShowQuiz(false);
  };

  const canAdvance = activeModuleIndex < activePath.modules.length - 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Module list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ padding: '8px 12px', borderBottom: `1px solid ${colors.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: colors.accent, fontWeight: 600, fontSize: 13, fontFamily: 'Geist Sans, Inter, sans-serif' }}>
              {activePath.title}
            </span>
            <button onClick={exitPath} style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', fontSize: 12 }}>x</button>
          </div>
        </div>

        {activePath.modules.map((mod, i) => {
          const modProgress = pathProgress[activePath.id]?.modules[mod.id];
          return (
            <ModuleCard
              key={mod.id}
              module={mod}
              index={i}
              isActive={i === activeModuleIndex}
              isCompleted={modProgress?.completed ?? false}
              onClick={() => setActiveModule(i)}
            />
          );
        })}
      </div>

      {/* Active module actions */}
      <div style={{ padding: 12, borderTop: `1px solid ${colors.border}` }}>
        <div style={{ color: colors.text, fontSize: 12, fontWeight: 500, fontFamily: 'Geist Sans, Inter, sans-serif', marginBottom: 8 }}>
          {module.title}
        </div>
        <div style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Geist Sans, Inter, sans-serif', marginBottom: 10, lineHeight: 1.5 }}>
          {module.description}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={loadDemo} style={{ padding: '4px 10px', background: colors.accent, color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 11, fontFamily: 'Geist Sans, Inter, sans-serif' }}>
            Load Demo
          </button>
          {module.quizQuestions.length > 0 && (
            <button onClick={() => setShowQuiz(true)} style={{ padding: '4px 10px', background: colors.dirac, color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 11, fontFamily: 'Geist Sans, Inter, sans-serif' }}>
              Quiz
            </button>
          )}
          {isCompleted && canAdvance && (
            <button onClick={() => setActiveModule(activeModuleIndex + 1)} style={{ padding: '4px 10px', background: colors.bgPanel, color: colors.accent, border: `1px solid ${colors.accent}`, borderRadius: 3, cursor: 'pointer', fontSize: 11, fontFamily: 'Geist Sans, Inter, sans-serif' }}>
              Next Module →
            </button>
          )}
          {!isCompleted && (
            <button onClick={() => markModuleComplete(activePath.id, module.id)} style={{ padding: '4px 10px', background: colors.bgPanel, color: colors.textMuted, border: `1px solid ${colors.border}`, borderRadius: 3, cursor: 'pointer', fontSize: 11, fontFamily: 'Geist Sans, Inter, sans-serif' }}>
              Mark Complete
            </button>
          )}
        </div>
      </div>

      {/* Quiz overlay */}
      {showQuiz && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowQuiz(false)}>
          <div style={{ background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 20, maxWidth: 420, width: '90%', maxHeight: '80vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ color: colors.accent, fontSize: 16, fontWeight: 600, fontFamily: 'Geist Sans, Inter, sans-serif', marginBottom: 16 }}>
              Quiz: {module.title}
            </div>
            {module.quizQuestions.map((q, qi) => (
              <div key={q.id} style={{ marginBottom: 16 }}>
                <div style={{ color: colors.text, fontSize: 13, fontFamily: 'Geist Sans, Inter, sans-serif', marginBottom: 8 }}>
                  {qi + 1}. {q.question}
                </div>
                {q.options.map((opt, oi) => (
                  <label key={oi} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name={q.id}
                      checked={quizAnswers[q.id] === oi}
                      onChange={() => setQuizAnswers((a) => ({ ...a, [q.id]: oi }))}
                    />
                    <span style={{ color: colors.text, fontSize: 12, fontFamily: 'Geist Sans, Inter, sans-serif' }}>{opt}</span>
                  </label>
                ))}
              </div>
            ))}
            <button onClick={handleQuizSubmit} style={{ padding: '8px 20px', background: colors.accent, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontFamily: 'Geist Sans, Inter, sans-serif' }}>
              Submit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CapstonesTab() {
  const { activeProject, completedMilestones, startProject } = useCapstoneStore();

  if (activeProject) {
    return <CapstoneProjectView />;
  }

  return (
    <div style={{ padding: 12, overflowY: 'auto', flex: 1 }}>
      {CAPSTONE_PROJECTS.map((project) => {
        const completed = completedMilestones[project.id] ?? [];
        return (
          <CapstoneCard
            key={project.id}
            project={project}
            completedCount={completed.length}
            onStart={() => startProject(project)}
          />
        );
      })}
    </div>
  );
}

export function LearningPathSidebar() {
  const { activePath, sidebarOpen, toggleSidebar, startPath } = useLearningStore();
  const colors = useThemeStore((s) => s.colors);
  const [activeTab, setActiveTab] = useState<TabKey>('paths');

  if (!sidebarOpen) {
    return (
      <button
        onClick={toggleSidebar}
        title="Learning Paths"
        style={{
          position: 'fixed', left: 0, top: '50%', transform: 'translateY(-50%)',
          zIndex: 100,
          background: colors.bgPanel,
          border: `1px solid ${colors.border}`,
          borderLeft: 'none',
          borderRadius: '0 6px 6px 0',
          padding: '8px 4px',
          cursor: 'pointer',
          color: colors.accent,
          fontSize: 14,
          writingMode: 'vertical-rl',
          fontFamily: 'Geist Sans, Inter, sans-serif',
          fontWeight: 600,
        }}
      >
        Learn
      </button>
    );
  }

  return (
    <div style={{
      width: 260,
      height: '100%',
      borderRight: `1px solid ${colors.border}`,
      background: colors.bg,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
    }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        borderBottom: `1px solid ${colors.border}`,
        flexShrink: 0,
      }}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                flex: 1,
                padding: '6px 0',
                background: 'transparent',
                border: 'none',
                borderBottom: isActive ? `2px solid ${colors.accent}` : '2px solid transparent',
                color: isActive ? colors.accent : colors.textDim,
                fontSize: 10,
                fontWeight: 600,
                fontFamily: 'Geist Sans, Inter, sans-serif',
                textTransform: 'uppercase',
                letterSpacing: '0.3px',
                cursor: 'pointer',
                transition: 'color 0.15s, border-color 0.15s',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'paths' && (
          activePath ? <ActiveModuleView /> : <PathSelector onSelect={startPath} />
        )}
        {activeTab === 'concepts' && <ConceptMap />}
        {activeTab === 'capstones' && <CapstonesTab />}
        {activeTab === 'glossary' && <Glossary />}
      </div>
    </div>
  );
}
