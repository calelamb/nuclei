import type { Track } from './types';
import { TRACK0_LESSONS } from './track0-python';
import { TRACK1_LESSONS } from './track1-fundamentals';

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
    title: 'Quantum Algorithms',
    description: 'Bernstein-Vazirani, Simon\'s, Grover\'s search, QFT, and Shor\'s algorithm.',
    difficulty: 'Intermediate \u2192 Advanced',
    lessons: [],
  },
  {
    id: 'track-3',
    title: 'Practical Quantum Programming',
    description: 'Qiskit deep dive, cross-framework coding, noise simulation, real hardware, and VQE.',
    difficulty: 'Intermediate \u2192 Advanced',
    lessons: [],
  },
];

export function getTrack(trackId: string): Track | undefined {
  return TRACKS.find((t) => t.id === trackId);
}

export function getLesson(trackId: string, lessonId: string) {
  const track = getTrack(trackId);
  return track?.lessons.find((l) => l.id === lessonId);
}
