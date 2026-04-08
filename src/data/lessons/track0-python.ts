import type { Lesson } from './types';

export const TRACK0_LESSONS: Lesson[] = [
  {
    id: '0.1',
    title: 'Hello, Quantum World',
    description: 'Print statements, running code — your very first Python program.',
    difficulty: 'absolute-beginner',
    estimatedMinutes: 10,
    prerequisites: [],
    tags: ['python-basics', 'print', 'running-code'],
    diracContext: 'The student has never coded before. Celebrate everything. Explain what print() does. Explain what a string is. Do not use jargon. If they make a syntax error, explain it patiently.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Hello, Quantum World!

Every programmer's first step is making the computer say something. In Python, we use \`print()\` to display text. Let's start with a quantum twist on the classic first program.`,
      },
      {
        type: 'demo',
        code: `# Your first Python program!
print("Hello, Quantum World!")
print("I'm learning quantum computing!")
print(2 + 2)`,
        framework: 'qiskit',
        description: 'Run this to see output in the terminal. print() displays text and numbers.',
        explorationPrompt: 'Try changing the text inside the quotes. What happens if you remove the quotes? What if you try print(10 * 5)?',
      },
      {
        type: 'exercise',
        id: '0.1-ex1',
        title: 'Print your own message',
        description: 'Make the program print "Quantum computing is cool!" on one line, then print the number 42 on the next line.',
        starterCode: `# TODO: Print "Quantum computing is cool!"

# TODO: Print the number 42
`,
        framework: 'qiskit',
        tolerancePercent: 0,
        hints: [
          'Use print() with text in quotes: print("your text here")',
          'Numbers don\'t need quotes: print(42)',
        ],
        successMessage: 'You just wrote your first program! print() is how Python talks to you.',
      },
    ],
  },

  {
    id: '0.2',
    title: 'Variables Store Qubits',
    description: 'Variables, types, and assignment — storing quantum information in code.',
    difficulty: 'absolute-beginner',
    estimatedMinutes: 15,
    prerequisites: ['0.1'],
    tags: ['python-basics', 'variables', 'types'],
    diracContext: 'Teach variables as labeled boxes that hold values. Use quantum-themed examples (qubit_count, gate_name). Keep it concrete — no abstract CS theory.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Variables — Naming Things

A **variable** is a name for a value. Instead of typing the same number or text over and over, you give it a name and reuse it.

\`\`\`python
qubit_count = 5      # A number (integer)
gate_name = "H"      # Text (string)
is_quantum = True    # True or False (boolean)
\`\`\``,
      },
      {
        type: 'demo',
        code: `# Variables in quantum computing context
qubit_count = 3
gate_name = "Hadamard"
angle = 3.14159

print("Circuit has", qubit_count, "qubits")
print("Applying the", gate_name, "gate")
print("Rotation angle:", angle)`,
        framework: 'qiskit',
        description: 'Variables store values and can be used in print statements.',
        explorationPrompt: 'Try changing qubit_count to 10. Try creating a new variable called circuit_name and printing it.',
      },
      {
        type: 'exercise',
        id: '0.2-ex1',
        title: 'Store qubit info',
        description: 'Create a variable num_qubits set to 2, and a variable framework set to "qiskit". Print both.',
        starterCode: `# TODO: Create num_qubits variable set to 2

# TODO: Create framework variable set to "qiskit"

# TODO: Print them both
`,
        framework: 'qiskit',
        tolerancePercent: 0,
        hints: [
          'Assign a number: num_qubits = 2',
          'Assign text: framework = "qiskit"',
          'Print: print(num_qubits, framework)',
        ],
        successMessage: 'Variables let you name and reuse values. This is how we\'ll configure quantum circuits.',
      },
    ],
  },

  {
    id: '0.3',
    title: 'Functions Build Circuits',
    description: 'Defining and calling functions — reusable blocks of code.',
    difficulty: 'absolute-beginner',
    estimatedMinutes: 15,
    prerequisites: ['0.2'],
    tags: ['python-basics', 'functions', 'def'],
    diracContext: 'Functions are recipes. You define them once, use them many times. Use quantum circuit building as the motivating example — "a function that creates a circuit with N qubits."',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Functions — Reusable Recipes

A **function** is a named block of code you can run whenever you want. Think of it as a recipe: define it once, use it many times.

\`\`\`python
def greet(name):
    print("Hello,", name)

greet("Alice")    # Hello, Alice
greet("Bob")      # Hello, Bob
\`\`\``,
      },
      {
        type: 'demo',
        code: `def make_circuit(num_qubits):
    """Create a description of a quantum circuit."""
    print("Creating circuit with", num_qubits, "qubits")
    print("That's", 2**num_qubits, "possible states!")
    return num_qubits

result = make_circuit(3)
print("Circuit created:", result, "qubits")`,
        framework: 'qiskit',
        description: 'Functions take inputs (parameters) and can return outputs.',
        explorationPrompt: 'Try calling make_circuit(5). How many possible states is that? What about make_circuit(10)?',
      },
      {
        type: 'exercise',
        id: '0.3-ex1',
        title: 'Write a circuit description function',
        description: 'Write a function called describe_gate that takes a gate_name parameter and prints "Applying gate: " followed by the gate name. Then call it with "H".',
        starterCode: `# TODO: Define the describe_gate function

# TODO: Call it with "H"
`,
        framework: 'qiskit',
        tolerancePercent: 0,
        hints: [
          'Start with: def describe_gate(gate_name):',
          'Inside the function: print("Applying gate:", gate_name)',
          'Call it: describe_gate("H")',
        ],
        successMessage: 'Functions are the building blocks of programs. In quantum computing, we use them to build and reuse circuits.',
      },
    ],
  },

  {
    id: '0.4',
    title: 'Loops Apply Gates',
    description: 'For loops and range() — applying operations to multiple qubits.',
    difficulty: 'absolute-beginner',
    estimatedMinutes: 15,
    prerequisites: ['0.3'],
    tags: ['python-basics', 'loops', 'for', 'range'],
    diracContext: 'Loops repeat actions. The quantum motivation is clear: "apply H to all 5 qubits" is tedious to write 5 times but easy with a loop. Keep examples concrete.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Loops — Repeat Yourself (Efficiently)

A **for loop** repeats code for each item in a sequence. \`range(n)\` generates numbers from 0 to n-1.

\`\`\`python
for i in range(3):
    print("Qubit", i)
# Qubit 0
# Qubit 1
# Qubit 2
\`\`\``,
      },
      {
        type: 'demo',
        code: `# Apply "gates" to multiple qubits
num_qubits = 5

for qubit in range(num_qubits):
    print(f"Applying H gate to qubit {qubit}")

print(f"\\nDone! Applied H to all {num_qubits} qubits")`,
        framework: 'qiskit',
        description: 'Loops let you apply the same operation to many qubits without repeating yourself.',
        explorationPrompt: 'Change num_qubits to 10. Imagine writing 10 separate lines — the loop is much better! Try adding a second print inside the loop.',
      },
      {
        type: 'exercise',
        id: '0.4-ex1',
        title: 'Loop over qubits',
        description: 'Use a for loop to print "Measuring qubit X" for qubits 0 through 3 (4 qubits total).',
        starterCode: `# TODO: Use a for loop with range(4) to print
# "Measuring qubit X" for each qubit 0-3
`,
        framework: 'qiskit',
        tolerancePercent: 0,
        hints: [
          'Use: for i in range(4):',
          'Inside the loop: print("Measuring qubit", i)',
        ],
        successMessage: 'Loops are essential for quantum circuits — real algorithms use hundreds of qubits, and you\'d never write each gate by hand.',
      },
    ],
  },

  {
    id: '0.5',
    title: 'Importing Qiskit',
    description: 'Imports, modules, and your first real quantum circuit.',
    difficulty: 'absolute-beginner',
    estimatedMinutes: 15,
    prerequisites: ['0.4'],
    tags: ['python-basics', 'imports', 'qiskit'],
    diracContext: 'This is the bridge from Python basics to quantum computing. Explain that import brings in code someone else wrote. Qiskit is IBM\'s quantum computing library. After this lesson, the student is ready for Track 1.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Importing Libraries

Python has a huge ecosystem of **libraries** — code packages other people wrote that you can use. To use a library, you **import** it.

\`from qiskit import QuantumCircuit\` means: "from the Qiskit library, bring in the QuantumCircuit tool."`,
      },
      {
        type: 'demo',
        code: `from qiskit import QuantumCircuit

# Create a circuit with 2 qubits and 2 classical bits
qc = QuantumCircuit(2, 2)

# Add some gates
qc.h(0)          # Hadamard on qubit 0
qc.cx(0, 1)      # CNOT: control=0, target=1
qc.measure([0, 1], [0, 1])  # Measure both qubits

# That's it! You just built a quantum circuit.
print("Circuit created successfully!")`,
        framework: 'qiskit',
        description: 'Your first real quantum circuit using Qiskit.',
        explorationPrompt: 'This is a Bell state — the most famous quantum circuit. Press Run (Cmd+Enter) to execute it and see the results in the histogram!',
      },
      {
        type: 'exercise',
        id: '0.5-ex1',
        title: 'Build your first circuit',
        description: 'Import QuantumCircuit from qiskit. Create a 1-qubit circuit, add an H gate, add a measurement, and print "Circuit ready!".',
        starterCode: `# TODO: Import QuantumCircuit from qiskit

# TODO: Create a circuit with 1 qubit and 1 classical bit

# TODO: Add an H gate to qubit 0

# TODO: Measure qubit 0 to classical bit 0

print("Circuit ready!")`,
        framework: 'qiskit',
        tolerancePercent: 0,
        hints: [
          'Import: from qiskit import QuantumCircuit',
          'Create: qc = QuantumCircuit(1, 1)',
          'H gate: qc.h(0)',
          'Measure: qc.measure(0, 0)',
        ],
        successMessage: 'You\'re ready for quantum computing! You know Python basics and you\'ve built your first circuit. Head to Track 1 to start learning quantum concepts.',
      },
    ],
  },
];
