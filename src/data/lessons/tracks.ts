import type { Track } from './types';
import { TRACK0_LESSONS } from './track0-python';
import { TRACK1_LESSONS } from './track1-fundamentals';
import { TRACK2_LESSONS } from './track2-gates';
import { TRACK3_LESSONS } from './track3-algorithms';
import { TRACK4_LESSONS } from './track4-information';

export const TRACKS: Track[] = [
  {
    id: 'track-0',
    title: 'Python Essentials',
    description: 'Never coded before? Start here. Learn Python basics with quantum-flavored examples.',
    difficulty: 'Absolute Beginner',
    lessons: TRACK0_LESSONS,
  },
  {
    id: 'track-1',
    title: 'Quantum Computing Fundamentals',
    description: 'From your first qubit to your first quantum algorithm. The core track — 10 lessons covering superposition, entanglement, interference, and Deutsch-Jozsa.',
    difficulty: 'Beginner \u2192 Intermediate',
    lessons: TRACK1_LESSONS,
  },
  {
    id: 'track-2',
    title: 'Quantum Gates Deep Dive',
    description: 'Universal gate sets, controlled gates, decomposition, QFT, phase kickback, parameterized circuits, optimization, and Clifford theory.',
    difficulty: 'Beginner \u2192 Advanced',
    lessons: TRACK2_LESSONS,
  },
  {
    id: 'track-3',
    title: 'Quantum Algorithms',
    description: 'Deutsch-Jozsa, Bernstein-Vazirani, Simon\'s, Grover\'s search, phase estimation, Shor\'s factoring, HHL, quantum walks, VQE, and QAOA.',
    difficulty: 'Intermediate \u2192 Advanced',
    lessons: TRACK3_LESSONS,
  },
  {
    id: 'track-4',
    title: 'Quantum Information Theory',
    description: 'Density matrices, entropy, entanglement measures, no-cloning, teleportation, superdense coding, and state tomography.',
    difficulty: 'Intermediate → Advanced',
    lessons: TRACK4_LESSONS,
  },
];

export function getTrack(trackId: string): Track | undefined {
  return TRACKS.find((t) => t.id === trackId);
}

export function getLesson(trackId: string, lessonId: string) {
  const track = getTrack(trackId);
  return track?.lessons.find((l) => l.id === lessonId);
}
