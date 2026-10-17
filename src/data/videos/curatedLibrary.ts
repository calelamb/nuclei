export interface CuratedVideo {
  id: string;
  youtubeId: string;
  title: string;
  creator: '3blue1brown' | 'ibm-technology' | 'nvidia' | 'qiskit' | 'other';
  duration: string;
  difficulty: 'prerequisite' | 'beginner' | 'intermediate' | 'advanced';
  topics: string[];
  description: string;
}

export const CURATED_VIDEOS: CuratedVideo[] = [
  // 3Blue1Brown - Linear algebra & math foundations
  { id: 'v-3b1b-linalg-1', youtubeId: 'fNk_zzaMoSs', title: 'Vectors, what even are they?', creator: '3blue1brown', duration: '9:52', difficulty: 'prerequisite', topics: ['linear-algebra', 'vectors'], description: 'Foundation for understanding quantum states as vectors.' },
  { id: 'v-3b1b-linalg-2', youtubeId: 'k7RM-ot2NWY', title: 'Linear combinations, span, and basis vectors', creator: '3blue1brown', duration: '9:59', difficulty: 'prerequisite', topics: ['linear-algebra', 'basis'], description: 'How basis vectors relate to qubit states |0\u27E9 and |1\u27E9.' },
  { id: 'v-3b1b-linalg-3', youtubeId: 'kYB8IZa5AuE', title: 'Linear transformations and matrices', creator: '3blue1brown', duration: '10:58', difficulty: 'prerequisite', topics: ['linear-algebra', 'matrices', 'transformations'], description: 'Quantum gates are linear transformations \u2014 this is the intuition.' },
  { id: 'v-3b1b-linalg-4', youtubeId: 'XkY2DOUCWMU', title: 'Matrix multiplication as composition', creator: '3blue1brown', duration: '10:03', difficulty: 'prerequisite', topics: ['linear-algebra', 'matrices'], description: 'Gate sequences are matrix multiplications.' },
  { id: 'v-3b1b-complex', youtubeId: 'v0YEaeIClKY', title: 'e^(iπ) in 3.14 minutes, using dynamics', creator: '3blue1brown', duration: '4:08', difficulty: 'prerequisite', topics: ['complex-numbers', 'euler'], description: 'Complex exponentials are the heart of quantum phase.' },

  // IBM Technology - Quantum concepts explained
  { id: 'v-ibm-5levels', youtubeId: 'OWJCfOvochA', title: 'Quantum Computing Expert Explains One Concept in 5 Levels of Difficulty', creator: 'other', duration: '19:27', difficulty: 'beginner', topics: ['quantum-basics', 'superposition', 'entanglement'], description: 'WIRED challenge: a quantum computing expert explains the field from child to expert.' },
  { id: 'v-ibm-qubit', youtubeId: 'lt4OsgmUTGI', title: 'What is Quantum Computing?', creator: 'ibm-technology', duration: '7:01', difficulty: 'beginner', topics: ['qubit', 'superposition', 'bloch-sphere'], description: 'IBM Technology introduces qubits, superposition and what quantum computers are good for.' },
  { id: 'v-ibm-entangle', youtubeId: 'RmXasxLm43k', title: 'Quantum Entanglement', creator: 'ibm-technology', duration: '2:21', difficulty: 'beginner', topics: ['entanglement', 'bell-state'], description: 'IBM Research on how entanglement works and why Einstein called it "spooky action."' },
  { id: 'v-ibm-gates', youtubeId: 'aCOsqL-jIOo', title: 'The Most Important Gates in Quantum Computing Explained', creator: 'ibm-technology', duration: '10:29', difficulty: 'beginner', topics: ['gates', 'hadamard', 'cnot', 'pauli'], description: 'The building blocks of quantum circuits.' },
  { id: 'v-ibm-error', youtubeId: 'vja_KmolxAU', title: 'How Quantum Computers Become Fault Tolerant', creator: 'qiskit', duration: '6:39', difficulty: 'intermediate', topics: ['error-correction', 'fault-tolerance'], description: 'Why quantum computers need error correction and how fault tolerance gets there.' },

  // NVIDIA - CUDA-Q and hybrid computing
  { id: 'v-nvidia-cudaq', youtubeId: 'eFWVYQUDfpM', title: 'Getting Started with CUDA Quantum', creator: 'other', duration: '18:40', difficulty: 'intermediate', topics: ['cuda-q', 'hybrid-computing', 'gpu'], description: 'A hands-on introduction to NVIDIA CUDA-Q for hybrid quantum-classical programs (PennyLane talk).' },
  { id: 'v-nvidia-hybrid', youtubeId: 'qjQF4FJk4dk', title: 'Supercharging Google\'s Quantum Processor Design with NVIDIA CUDA-Q', creator: 'nvidia', duration: '1:26', difficulty: 'intermediate', topics: ['hybrid-computing', 'gpu-acceleration', 'simulation'], description: 'How GPUs accelerate quantum device and circuit simulation.' },
  { id: 'v-nvidia-qaoa', youtubeId: 'P3s7TIMIvZ0', title: 'Solving MaxCut with QAOA: Quantum Tutorial for 100+ Qubits', creator: 'qiskit', duration: '32:30', difficulty: 'advanced', topics: ['qaoa', 'maxcut', 'optimization'], description: 'QAOA for combinatorial optimization \u2014 directly relevant to MaxCut challenges.' },

  // Qiskit - Official tutorials
  { id: 'v-qiskit-hello', youtubeId: 'RrUTwq5jKM4', title: 'Hello World with Qiskit', creator: 'qiskit', duration: '12:47', difficulty: 'beginner', topics: ['qiskit', 'getting-started', 'circuit'], description: 'Your first quantum circuit in Qiskit.' },
  { id: 'v-qiskit-bell', youtubeId: 'rGRUFzPeJI4', title: 'Entanglement Explained Simply', creator: 'qiskit', duration: '9:24', difficulty: 'beginner', topics: ['qiskit', 'bell-state', 'entanglement'], description: 'The ideas behind Bell states and entanglement, from the Qiskit team.' },
  { id: 'v-qiskit-grover', youtubeId: '0RPFWZj7Jm0', title: "Grover's Algorithm Tutorial", creator: 'qiskit', duration: '18:30', difficulty: 'intermediate', topics: ['qiskit', 'grovers', 'search', 'oracle'], description: 'Implement Grover\'s search algorithm from scratch.' },
  { id: 'v-qiskit-teleport', youtubeId: 'jxqnzltpDdE', title: 'How Quantum Teleportation Really Works', creator: 'qiskit', duration: '14:38', difficulty: 'intermediate', topics: ['qiskit', 'teleportation', 'bell-state'], description: 'The teleportation protocol, step by step.' },
  { id: 'v-qiskit-vqe', youtubeId: 'Z-A6G0WVI9w', title: 'Variational Quantum Eigensolver (VQE)', creator: 'qiskit', duration: '22:26', difficulty: 'advanced', topics: ['qiskit', 'vqe', 'variational', 'chemistry'], description: 'Using VQE to find ground state energies of molecules.' },
];

export function getVideosByTopic(topic: string): CuratedVideo[] {
  return CURATED_VIDEOS.filter((v) => v.topics.includes(topic));
}

export function getVideosByCreator(creator: CuratedVideo['creator']): CuratedVideo[] {
  return CURATED_VIDEOS.filter((v) => v.creator === creator);
}

export function getVideosByDifficulty(difficulty: CuratedVideo['difficulty']): CuratedVideo[] {
  return CURATED_VIDEOS.filter((v) => v.difficulty === difficulty);
}
