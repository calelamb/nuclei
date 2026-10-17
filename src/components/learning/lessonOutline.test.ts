import { describe, it, expect } from 'vitest';
import { blockOutlineLabel } from './lessonOutline';
import type { ContentBlock } from '../../data/lessons/types';

describe('blockOutlineLabel', () => {
  it('uses the first markdown heading of a text block', () => {
    const block: ContentBlock = { type: 'text', markdown: 'Intro line\n\n## Your First Circuit\nBody' };
    expect(blockOutlineLabel(block)).toBe('Your First Circuit');
  });

  it('strips inline markdown from the heading', () => {
    const block: ContentBlock = { type: 'text', markdown: '### The **Hadamard** gate' };
    expect(blockOutlineLabel(block)).toBe('The Hadamard gate');
  });

  it('falls back to the kind when a text block has no heading', () => {
    expect(blockOutlineLabel({ type: 'text', markdown: 'Just a paragraph.' })).toBe('Read');
  });

  it('uses the title of video, concept and exercise blocks', () => {
    expect(blockOutlineLabel({ type: 'video', youtubeId: 'x', title: 'How Does a Quantum Computer Work?', creator: 'Veritasium' }))
      .toBe('How Does a Quantum Computer Work?');
    expect(blockOutlineLabel({ type: 'concept-card', title: 'Classical Bit vs Qubit', visual: 'bloch', explanation: '' }))
      .toBe('Classical Bit vs Qubit');
  });

  it('labels demos and quizzes by kind', () => {
    expect(blockOutlineLabel({ type: 'quiz', questions: [] })).toBe('Quiz');
    expect(blockOutlineLabel({ type: 'demo', code: '', framework: 'qiskit', description: 'd' })).toBe('Demo');
  });
});
