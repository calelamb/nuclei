export interface PluginRegistryEntry {
  name: string;
  version: string;
  description: string;
  author: string;
  category: 'visualization' | 'hardware' | 'learning' | 'theme' | 'integration';
  downloads: number;
  rating: number;
  capabilities: string[];
  repositoryUrl: string;
  featured: boolean;
}

export const PLUGIN_REGISTRY: PluginRegistryEntry[] = [
  {
    name: 'Quantum State Tomography Visualizer',
    version: '1.2.0',
    description:
      'Visualize quantum state tomography results with interactive density matrix heatmaps, Wigner functions, and Husimi Q representations. Supports up to 6 qubits.',
    author: 'quantum-viz-labs',
    category: 'visualization',
    downloads: 3420,
    rating: 4.7,
    capabilities: ['density-matrix-view', 'wigner-function', 'husimi-q', 'state-fidelity'],
    repositoryUrl: 'https://github.com/quantum-viz-labs/tomography-visualizer',
    featured: true,
  },
  {
    name: 'Dark Neon Theme',
    version: '2.0.1',
    description:
      'A vibrant dark theme with neon accents inspired by cyberpunk aesthetics. Features custom syntax highlighting for quantum keywords and gate annotations.',
    author: 'neon-themes',
    category: 'theme',
    downloads: 8915,
    rating: 4.8,
    capabilities: ['editor-theme', 'circuit-colors', 'syntax-highlighting', 'icon-pack'],
    repositoryUrl: 'https://github.com/neon-themes/dark-neon-nuclei',
    featured: true,
  },
  {
    name: 'Cirq Extensions Pack',
    version: '1.0.3',
    description:
      'Enhanced support for Google Cirq including advanced gate decomposition, noise model templates, and Cirq-specific code snippets for common circuit patterns.',
    author: 'cirq-community',
    category: 'integration',
    downloads: 2180,
    rating: 4.3,
    capabilities: ['gate-decomposition', 'noise-models', 'code-snippets', 'cirq-optimization'],
    repositoryUrl: 'https://github.com/cirq-community/nuclei-cirq-extensions',
    featured: false,
  },
  {
    name: 'IBM Quantum Direct Connect',
    version: '3.1.0',
    description:
      'Connect directly to IBM Quantum hardware from Nuclei. Browse available backends, submit jobs, monitor queue positions, and retrieve results without leaving the IDE.',
    author: 'ibm-quantum-tools',
    category: 'hardware',
    downloads: 5640,
    rating: 4.5,
    capabilities: ['backend-browser', 'job-submission', 'queue-monitor', 'result-retrieval', 'calibration-data'],
    repositoryUrl: 'https://github.com/ibm-quantum-tools/nuclei-ibm-connect',
    featured: true,
  },
  {
    name: 'Qiskit Transpiler Insights',
    version: '1.4.2',
    description:
      'Visualize the Qiskit transpilation process step by step. See how your high-level circuit gets decomposed into native gates, optimized, and mapped to hardware topology.',
    author: 'transpiler-team',
    category: 'visualization',
    downloads: 3890,
    rating: 4.6,
    capabilities: ['transpilation-steps', 'gate-decomposition', 'routing-visualization', 'optimization-levels'],
    repositoryUrl: 'https://github.com/transpiler-team/nuclei-transpiler-insights',
    featured: false,
  },
  {
    name: 'Circuit Complexity Analyzer',
    version: '0.9.1',
    description:
      'Analyze the complexity of your quantum circuits. Computes gate counts by type, circuit depth, T-count, CNOT count, and estimates resource requirements for fault-tolerant execution.',
    author: 'quantum-metrics',
    category: 'visualization',
    downloads: 1750,
    rating: 4.2,
    capabilities: ['gate-count', 'depth-analysis', 't-count', 'resource-estimation'],
    repositoryUrl: 'https://github.com/quantum-metrics/circuit-complexity',
    featured: false,
  },
  {
    name: 'Quantum Game Builder',
    version: '1.1.0',
    description:
      'Create interactive quantum computing games and puzzles. Includes a visual puzzle editor, scoring system, and a library of pre-built quantum games for teaching.',
    author: 'quantum-games-studio',
    category: 'learning',
    downloads: 4210,
    rating: 4.4,
    capabilities: ['puzzle-editor', 'game-templates', 'scoring-system', 'student-progress'],
    repositoryUrl: 'https://github.com/quantum-games-studio/nuclei-game-builder',
    featured: false,
  },
  {
    name: 'LaTeX Circuit Export',
    version: '2.2.0',
    description:
      'Export your quantum circuits as publication-ready LaTeX using the quantikz package. Supports custom styling, annotations, and batch export for multi-circuit documents.',
    author: 'academic-tools',
    category: 'integration',
    downloads: 6320,
    rating: 4.9,
    capabilities: ['quantikz-export', 'custom-styling', 'batch-export', 'tikz-output'],
    repositoryUrl: 'https://github.com/academic-tools/nuclei-latex-export',
    featured: true,
  },
  {
    name: 'Bloch Sphere Enhanced',
    version: '1.3.0',
    description:
      'Enhanced Bloch sphere visualization with trajectory animations, multi-qubit display, gate rotation paths, and the ability to export animations as GIF or MP4.',
    author: 'bloch-viz',
    category: 'visualization',
    downloads: 2940,
    rating: 4.5,
    capabilities: ['trajectory-animation', 'multi-qubit-display', 'rotation-paths', 'animation-export'],
    repositoryUrl: 'https://github.com/bloch-viz/nuclei-bloch-enhanced',
    featured: false,
  },
  {
    name: 'Quantum Error Dashboard',
    version: '1.0.0',
    description:
      'Monitor and visualize quantum error rates across your circuits. Displays error budgets, noise impact analysis, and suggests error mitigation strategies.',
    author: 'error-aware',
    category: 'visualization',
    downloads: 1280,
    rating: 4.1,
    capabilities: ['error-rates', 'noise-analysis', 'mitigation-suggestions', 'error-budget'],
    repositoryUrl: 'https://github.com/error-aware/nuclei-error-dashboard',
    featured: false,
  },
  {
    name: 'CUDA-Q Turbo',
    version: '0.8.0',
    description:
      'Accelerate CUDA-Q development with GPU-aware simulation previews, kernel profiling, and optimized execution strategies for NVIDIA quantum hardware simulators.',
    author: 'cuda-quantum-community',
    category: 'hardware',
    downloads: 980,
    rating: 4.0,
    capabilities: ['gpu-simulation', 'kernel-profiling', 'execution-optimization', 'nvidia-integration'],
    repositoryUrl: 'https://github.com/cuda-quantum-community/nuclei-cudaq-turbo',
    featured: false,
  },
  {
    name: 'Education Pack Pro',
    version: '2.0.0',
    description:
      'A comprehensive education toolkit with guided tutorials, auto-graded assignments, classroom management, and progress tracking dashboards for instructors and students.',
    author: 'quantum-edu',
    category: 'learning',
    downloads: 7150,
    rating: 4.7,
    capabilities: ['guided-tutorials', 'auto-grading', 'classroom-management', 'progress-dashboard', 'assignment-builder'],
    repositoryUrl: 'https://github.com/quantum-edu/nuclei-education-pack',
    featured: false,
  },
];
