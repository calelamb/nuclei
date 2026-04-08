import type { Track } from './types';
import { TRACK0_LESSONS } from './track0-python';
import { TRACK1_LESSONS } from './track1-fundamentals';
import { TRACK2_LESSONS } from './track2-gates';
import { TRACK3_LESSONS } from './track3-algorithms';
import { TRACK4_LESSONS } from './track4-information';
import { TRACK5_LESSONS } from './track5-error-correction';
import { TRACK6_LESSONS } from './track6-qml';
import { TRACK7_LESSONS } from './track7-chemistry';
import { TRACK8_LESSONS } from './track8-cryptography';
import { TRACK9_LESSONS } from './track9-finance';
import { TRACK10_LESSONS } from './track10-hardware';
import { TRACK11_LESSONS } from './track11-cudaq';
import { TRACK12_LESSONS } from './track12-ibm';
import { TRACK13_LESSONS } from './track13-cirq';
import { TRACK14_LESSONS } from './track14-real-hardware';
import { TRACK15_LESSONS } from './track15-complexity';
import { TRACK16_LESSONS } from './track16-networking';
import { TRACK17_LESSONS } from './track17-history';

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
  {
    id: 'track-5',
    title: 'Quantum Error Correction',
    description: 'From bit flips to surface codes — learn how quantum computers fight noise.',
    difficulty: 'Intermediate → Advanced',
    lessons: TRACK5_LESSONS,
  },
  {
    id: 'track-6',
    title: 'Quantum Machine Learning',
    description: 'Variational circuits, quantum kernels, and hybrid classical-quantum ML pipelines.',
    difficulty: 'Intermediate \u2192 Advanced',
    lessons: TRACK6_LESSONS,
  },
  {
    id: 'track-7',
    title: 'Quantum Chemistry & Materials',
    description: 'Molecular simulation, VQE, and how quantum computers will transform drug discovery and materials science.',
    difficulty: 'Intermediate → Advanced',
    lessons: TRACK7_LESSONS,
  },
  {
    id: 'track-8',
    title: 'Quantum Cryptography & Security',
    description:
      'QKD, post-quantum crypto, and the quantum threat to modern encryption.',
    difficulty: 'Intermediate → Advanced',
    lessons: TRACK8_LESSONS,
  },
  {
    id: 'track-9',
    title: 'Quantum Finance & Optimization',
    description:
      'Portfolio optimization, option pricing, and real-world business problems on quantum hardware.',
    difficulty: 'Intermediate → Advanced',
    lessons: TRACK9_LESSONS,
  },
  {
    id: 'track-10',
    title: 'Quantum Hardware',
    description:
      'Superconducting, trapped ion, photonic, neutral atom, and topological qubits — know your machine.',
    difficulty: 'Beginner → Advanced',
    lessons: TRACK10_LESSONS,
  },
  {
    id: 'track-11',
    title: 'NVIDIA CUDA-Q Mastery',
    description:
      'GPU-native quantum programming with NVIDIA CUDA-Q. Kernel-based circuits, GPU-accelerated simulation, hybrid workflows, multi-GPU scaling, and the cuQuantum SDK.',
    difficulty: 'Intermediate → Advanced',
    lessons: TRACK11_LESSONS,
  },
  {
    id: 'track-12',
    title: 'IBM Quantum & Qiskit Mastery',
    description:
      'Master IBM Quantum hardware access, Qiskit Runtime primitives, error mitigation, transpilation, pulse-level control, and circuit knitting.',
    difficulty: 'Beginner → Advanced',
    lessons: TRACK12_LESSONS,
  },
  {
    id: 'track-13',
    title: 'Google Cirq & Beyond',
    description:
      'Google\'s quantum framework: Cirq architecture, Moments, the Sycamore supremacy experiment, noise simulation, and error correction on the path to fault tolerance.',
    difficulty: 'Beginner → Advanced',
    lessons: TRACK13_LESSONS,
  },
  {
    id: 'track-14',
    title: 'Running on Real Hardware',
    description:
      'From simulator to real QPU — noise, job submission, queue management, statistical analysis of noisy results, and benchmarking your quantum code.',
    difficulty: 'Beginner → Intermediate',
    lessons: TRACK14_LESSONS,
  },
  {
    id: 'track-15',
    title: 'Quantum Complexity & Supremacy',
    description:
      'BQP, QMA, quantum supremacy experiments, and the NISQ era. Where quantum computing fits in the complexity landscape and what it can actually do today.',
    difficulty: 'Intermediate → Advanced',
    lessons: TRACK15_LESSONS,
  },
  {
    id: 'track-16',
    title: 'Quantum Networking',
    description:
      'Quantum repeaters, entanglement distribution, quantum internet architecture, and satellite communication. How quantum information travels across the globe.',
    difficulty: 'Intermediate',
    lessons: TRACK16_LESSONS,
  },
  {
    id: 'track-17',
    title: 'History & Careers in Quantum',
    description:
      'From Feynman\'s 1981 talk to the billion-dollar quantum race. Companies, labs, and career paths — everything you need to navigate the quantum industry.',
    difficulty: 'Beginner',
    lessons: TRACK17_LESSONS,
  },
];

export function getTrack(trackId: string): Track | undefined {
  return TRACKS.find((t) => t.id === trackId);
}

export function getLesson(trackId: string, lessonId: string) {
  const track = getTrack(trackId);
  return track?.lessons.find((l) => l.id === lessonId);
}
