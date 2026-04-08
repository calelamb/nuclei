import type { Lesson } from './types';

export const TRACK17_LESSONS: Lesson[] = [
  // ── Lesson 17.1 ──
  {
    id: '17.1',
    title: 'Feynman, Deutsch & the Birth of QC',
    description:
      'Feynman\'s 1981 talk, Deutsch\'s universal quantum computer, the theoretical foundations that launched a field. Fun stories and the key ideas.',
    difficulty: 'beginner',
    estimatedMinutes: 15,
    prerequisites: [],
    tags: ['history', 'Feynman', 'Deutsch', 'Benioff', 'Manin', 'Church-Turing', 'foundations'],
    diracContext:
      'This is a narrative lesson — tell the story of how quantum computing was born. Feynman is the charismatic entry point: his 1981 talk where he argued nature is not classical and simulating quantum physics requires quantum machines. Deutsch formalized this into the universal quantum computer (1985). Include fun quotes and personality details. Make students feel the excitement of a new field being born.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## A New Kind of Computer

In the early 1980s, quantum computing did not exist — not even as a theoretical field. What changed?

### The Precursors

**Yuri Manin** (1980) — A Soviet mathematician who wrote, almost in passing, that quantum systems might simulate each other more efficiently than classical computers can simulate them. The idea appeared in his book *Computable and Uncomputable*, but it did not spark a movement.

**Paul Benioff** (1980) — An Argonne National Lab physicist who showed that a Turing machine could be described using quantum mechanics. His model was quantum-mechanical but not yet faster than classical — it was the first proof that computation and quantum mechanics were compatible.

But the field needed a showman.`,
      },
      {
        type: 'concept-card',
        title: 'The Key Insight',
        visual: 'custom-svg',
        explanation:
          'Classical computers struggle to simulate quantum systems because the state space grows exponentially. An n-particle quantum system requires 2ⁿ complex numbers to describe classically. For 50 particles, that is over a quadrillion numbers. Feynman realized: instead of simulating quantum mechanics on a classical computer, build a computer that IS quantum mechanical.',
      },
      {
        type: 'text',
        markdown: `## Feynman's Talk (1981)

At the First Physics of Computation Conference at MIT, **Richard Feynman** gave a talk titled *"Simulating Physics with Computers."*

His argument was deceptively simple:

> "Nature isn't classical, dammit, and if you want to make a simulation of nature, you'd better make it quantum mechanical."

Feynman pointed out a fundamental problem: simulating quantum physics on a classical computer requires exponential resources. An n-particle system has 2ⁿ states. A classical computer cannot efficiently track all of them.

His solution: build a computer that works according to quantum mechanics. Such a machine could simulate quantum systems efficiently because it would *be* quantum.

### Why Feynman Mattered

Feynman did not write the first paper or build the first model. But he had three things others lacked:

1. **Clarity**: He stated the problem in a way everyone understood
2. **Authority**: Nobel laureate, beloved teacher, the physicist's physicist
3. **Vision**: He saw that this was not just a curiosity but a fundamental insight about the nature of computation

His talk is widely considered the founding moment of quantum computing as a field.

> **Fun fact:** Feynman was also famous for picking locks at Los Alamos during the Manhattan Project, playing bongo drums, and drawing portraits of nude models. He brought the same irreverent energy to his quantum computing talk.`,
      },
      {
        type: 'text',
        markdown: `## Deutsch's Universal Quantum Computer (1985)

**David Deutsch** at Oxford took Feynman's physical intuition and gave it mathematical rigor.

In his 1985 paper *"Quantum Theory, the Church-Turing Principle, and the Universal Quantum Computer,"* Deutsch:

1. **Defined** the quantum Turing machine — a formal model of quantum computation
2. **Proposed** the quantum Church-Turing principle: "Every finitely realizable physical system can be perfectly simulated by a universal quantum computer"
3. **Showed** the first quantum algorithm (Deutsch's problem) — a simple case where a quantum computer provably outperforms a classical one

### The Deutsch Problem

Given a function f: {0, 1} → {0, 1}, determine if f is **constant** (f(0) = f(1)) or **balanced** (f(0) ≠ f(1)).

| Approach | Queries Needed |
|----------|---------------|
| Classical | 2 (must check both inputs) |
| Quantum | 1 (superposition checks both at once) |

This was the first proof that quantum mechanics enables a computational speedup. The problem is trivial, but the principle is profound.

### Deutsch's Philosophical Motivation

Deutsch was not primarily interested in building faster computers. He was interested in the **foundations of physics**. For him, quantum computation was evidence for the many-worlds interpretation of quantum mechanics:

> "Quantum computation ... is evidence for the multiverse, because the computations are done in parallel universes."

Whether you buy the philosophy or not, the mathematics is solid.`,
      },
      {
        type: 'text',
        markdown: `## The Seeds of a Field

After Feynman and Deutsch, the ideas percolated quietly through the 1980s and early 1990s:

| Year | Event | Significance |
|------|-------|-------------|
| **1980** | Benioff's quantum Turing machine | Proved QM and computation are compatible |
| **1981** | Feynman's MIT talk | Framed the vision: quantum machines for quantum simulation |
| **1985** | Deutsch's paper | Formalized the theory, first quantum speedup |
| **1992** | Deutsch-Jozsa algorithm | Exponential speedup for a specific (contrived) problem |
| **1993** | Bernstein-Vazirani | Another problem with quantum advantage |
| **1994** | Shor's algorithm | **Everything changed** — factoring with exponential speedup |

The period from 1981 to 1994 was the "incubation era." Quantum computing was a niche interest among a handful of physicists and computer scientists. Most of the broader scientific community was skeptical.

Then Peter Shor published his factoring algorithm, and overnight, quantum computing became a matter of national security.

> That story continues in the next lesson.`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '17.1-q1',
            question: 'What was Feynman\'s key argument in his 1981 talk?',
            options: [
              'Quantum computers will be commercially viable within a decade',
              'Simulating quantum physics on classical computers requires exponential resources — build quantum machines instead',
              'Classical computers are fundamentally flawed and should be replaced',
              'Quantum mechanics is wrong and needs revision',
            ],
            correctIndex: 1,
            explanation:
              'Feynman argued that classical computers cannot efficiently simulate quantum systems because the state space grows exponentially. His solution: build computers that operate according to quantum mechanics, which can simulate quantum physics natively.',
          },
          {
            id: '17.1-q2',
            question: 'What did David Deutsch contribute in his 1985 paper?',
            options: [
              'The first experimental quantum computer',
              'Shor\'s factoring algorithm',
              'A formal definition of the quantum Turing machine and the first quantum algorithm',
              'The no-cloning theorem',
            ],
            correctIndex: 2,
            explanation:
              'Deutsch defined the quantum Turing machine, proposed the quantum Church-Turing principle, and demonstrated the first quantum algorithm (Deutsch\'s problem) showing a provable speedup over classical computation.',
          },
          {
            id: '17.1-q3',
            question: 'How many queries does the Deutsch algorithm need to determine if a function is constant or balanced?',
            options: ['0', '1', '2', '4'],
            correctIndex: 1,
            explanation:
              'The Deutsch algorithm needs only 1 query to a quantum oracle, compared to 2 queries classically. It achieves this by evaluating the function on a superposition of both inputs simultaneously.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'The Founding Trio',
        visual: 'custom-svg',
        explanation:
          'Three names anchor the birth of quantum computing: Benioff (proved quantum mechanics and computation are compatible), Feynman (articulated the vision and the motivation — simulating nature), and Deutsch (formalized the theory and proved the first speedup). Each contributed something essential. Without any one of them, the field might have emerged years later.',
      },
    ],
  },

  // ── Lesson 17.2 ──
  {
    id: '17.2',
    title: 'From Shor\'s Algorithm to the Quantum Race',
    description:
      'Shor\'s 1994 breakthrough, Grover\'s search, the first experiments, and how quantum computing became a billion-dollar global competition.',
    difficulty: 'beginner',
    estimatedMinutes: 20,
    prerequisites: ['17.1'],
    tags: ['Shor', 'Grover', 'history', 'factoring', 'RSA', 'timeline', 'milestones', 'race', 'funding'],
    diracContext:
      'This is the dramatic act of the quantum computing story. Shor\'s algorithm turned quantum computing from a curiosity into a national security concern. Walk through the timeline: Shor (1994), Grover (1996), first experimental demonstrations (late 1990s), and the explosion of investment in the 2010s-2020s. Make the stakes clear: Shor threatens all RSA encryption, which protects virtually all internet commerce.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Paper That Changed Everything

In 1994, **Peter Shor** at Bell Labs published an algorithm that could factor large integers in polynomial time on a quantum computer.

Why did this matter so much?

### RSA Encryption

Nearly all internet security (banking, email, passwords) relies on **RSA encryption**, which depends on one assumption:

> Factoring large numbers is computationally hard for classical computers.

A 2048-bit RSA key relies on the product of two ~1024-bit primes. The best classical algorithm (General Number Field Sieve) would take longer than the age of the universe to factor it.

**Shor's algorithm factors it in hours** on a large enough quantum computer.

| Method | Time to Factor RSA-2048 |
|--------|------------------------|
| Classical (GNFS) | ~10²⁰ years |
| Shor's algorithm | ~8 hours (with ~4,000 logical qubits) |
| Current quantum hardware | Cannot — too few qubits, too much noise |

### The Reaction

Overnight, quantum computing went from an academic curiosity to a matter of:
- **National security** — intelligence agencies took notice immediately
- **Commercial interest** — if RSA breaks, everything breaks
- **Research funding** — governments began pouring money into quantum

> **Fun fact:** Shor has said he was somewhat surprised by the reaction. He viewed the algorithm as an interesting theoretical result. The security community viewed it as a ticking time bomb.`,
      },
      {
        type: 'concept-card',
        title: 'Shor\'s Algorithm in One Sentence',
        visual: 'circuit',
        explanation:
          'Shor\'s algorithm reduces factoring to period-finding (a number theory trick), then uses the Quantum Fourier Transform to find the period exponentially faster than any classical method. The quantum speedup comes from QFT, which exploits superposition and interference to extract periodic structure from exponentially many possibilities in polynomial time.',
      },
      {
        type: 'text',
        markdown: `## Grover's Search (1996)

Two years after Shor, **Lov Grover** at Bell Labs published a quantum search algorithm:

| Problem | Classical | Grover's Quantum |
|---------|-----------|-----------------|
| Find marked item in N unsorted items | O(N) queries | O(√N) queries |

A quadratic speedup — less dramatic than Shor's exponential speedup, but far more broadly applicable:

- Database search
- SAT solving (via amplitude amplification)
- Optimization (finding minimum)
- Cryptographic key search

Grover also proved that √N is **optimal** for quantum search — no quantum algorithm can do better for unstructured problems.

### Why Grover Matters

Shor's algorithm is powerful but narrow — it solves factoring and discrete logarithm. Grover's algorithm applies to virtually any search problem. Together, they established the two poles of quantum advantage:

1. **Exponential speedup** for problems with algebraic structure (Shor, quantum simulation)
2. **Quadratic speedup** for unstructured problems (Grover)`,
      },
      {
        type: 'text',
        markdown: `## The First Experiments

With theoretical motivation established, experimentalists raced to build actual quantum devices:

| Year | Milestone | Qubits | Technology |
|------|-----------|--------|-----------|
| **1995** | First quantum logic gate (NIST) | 1 ion | Trapped ion |
| **1998** | First quantum algorithm on hardware (Shor's on 7-qubit NMR) | 7 | Nuclear magnetic resonance |
| **2001** | Shor's algorithm factors 15 = 3 × 5 (IBM) | 7 | NMR |
| **2007** | D-Wave announces "quantum computer" | 16 | Adiabatic (controversial) |
| **2011** | D-Wave One sold to Lockheed Martin | 128 | Adiabatic |
| **2016** | IBM Quantum Experience launches | 5 | Superconducting (cloud access) |
| **2017** | IBM 50-qubit prototype | 50 | Superconducting |
| **2019** | Google quantum supremacy (Sycamore) | 53 | Superconducting |
| **2020** | Jiuzhang boson sampling (USTC) | 76 photons | Photonic |
| **2023** | IBM Condor | 1,121 | Superconducting |
| **2024** | Google Willow — below-threshold error correction | 105 | Superconducting |

### The NMR Era (1997–2005)

The first quantum algorithms ran on **Nuclear Magnetic Resonance** systems — essentially chemistry equipment repurposed for quantum computation. These were not scalable (limited to ~10 qubits), and there was fierce debate about whether they were "really" quantum. But they proved the algorithms worked.

### The Superconducting Revolution (2010s)

IBM, Google, and Rigetti bet on **superconducting transmon qubits** — tiny aluminum circuits cooled to 15 millikelvin. This approach scaled faster than anyone expected, reaching 1,000+ qubits by 2023.`,
      },
      {
        type: 'text',
        markdown: `## The Billion-Dollar Race

Starting around 2015, quantum computing became a global competition:

### Government Investment

| Country | Investment | Focus |
|---------|-----------|-------|
| **China** | $15+ billion | Quantum communication, computing, sensing |
| **USA** | $3+ billion (National Quantum Initiative, 2018) | Research, workforce, industry |
| **EU** | €1 billion (Quantum Flagship, 2018) | Full stack: hardware to applications |
| **UK** | £2.5 billion (National Quantum Strategy) | Technology hubs, commercialization |
| **Germany** | €2 billion | Building domestic quantum computers |
| **Japan** | $1.5+ billion | Quantum computing and networking |

### Private Investment

| Company | Founded | Total Raised | Approach |
|---------|---------|-------------|---------|
| **IonQ** | 2015 | $600M+ (public) | Trapped ions |
| **Rigetti** | 2013 | $300M+ (public) | Superconducting |
| **PsiQuantum** | 2016 | $700M+ | Photonic |
| **Quantinuum** | 2021 (merger) | $600M+ | Trapped ions |
| **Xanadu** | 2016 | $250M+ | Photonic |

Plus IBM, Google, Microsoft, Amazon, and NVIDIA investing billions internally.

### What Drove the Money?

1. **Shor's algorithm** — the threat to encryption motivated defense and intelligence agencies
2. **Quantum simulation** — drug discovery and materials science attracted pharma and chemical companies
3. **Optimization** — finance, logistics, and energy saw potential for quantum advantage
4. **Strategic competition** — no major country wants to fall behind in quantum technology`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '17.2-q1',
            question: 'Why did Shor\'s algorithm cause such a dramatic shift in interest in quantum computing?',
            options: [
              'It was the first quantum algorithm ever published',
              'It threatened RSA encryption, which protects nearly all internet security',
              'It solved the traveling salesman problem',
              'It was immediately demonstrated on hardware',
            ],
            correctIndex: 1,
            explanation:
              'Shor\'s algorithm can factor large integers in polynomial time, breaking RSA encryption that protects banking, email, and web commerce. This turned quantum computing from an academic curiosity into a national security concern.',
          },
          {
            id: '17.2-q2',
            question: 'What type of speedup does Grover\'s search algorithm provide?',
            options: ['Exponential', 'Quadratic', 'Logarithmic', 'Constant'],
            correctIndex: 1,
            explanation:
              'Grover provides a quadratic speedup: searching N items in O(sqrt(N)) queries instead of O(N). This is provably optimal for unstructured search. Unlike Shor\'s exponential speedup for factoring, Grover\'s applies broadly to many search and optimization problems.',
          },
          {
            id: '17.2-q3',
            question: 'What was the first experimental demonstration of Shor\'s algorithm?',
            options: [
              'Factoring 15 on a 7-qubit NMR system (2001)',
              'Factoring 21 on a trapped-ion computer (2012)',
              'Factoring 35 on a superconducting chip (2019)',
              'Factoring 15 on Google Sycamore (2019)',
            ],
            correctIndex: 0,
            explanation:
              'In 2001, IBM used a 7-qubit NMR (nuclear magnetic resonance) system to factor 15 into 3 x 5 using Shor\'s algorithm. NMR systems were not scalable, but this was the first real demonstration that quantum algorithms work on physical hardware.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'The Quantum Timeline',
        visual: 'custom-svg',
        explanation:
          'Three eras of quantum computing: Theory Era (1981-1994) — Feynman, Deutsch, foundations. Algorithm Era (1994-2010) — Shor, Grover, first experiments, debate over whether it is real. Hardware Era (2010-present) — superconducting chips scaling rapidly, cloud access, billions in funding, quantum supremacy demonstrated. We are now entering the Error Correction Era — the transition from noisy intermediate-scale to fault-tolerant quantum computing.',
      },
    ],
  },

  // ── Lesson 17.3 ──
  {
    id: '17.3',
    title: 'Companies & Labs to Know',
    description:
      'IBM, Google, NVIDIA, Microsoft, IonQ, Quantinuum, Xanadu, QuEra — what each is doing. Plus the key academic labs shaping the field.',
    difficulty: 'beginner',
    estimatedMinutes: 15,
    prerequisites: [],
    tags: ['companies', 'labs', 'IBM', 'Google', 'NVIDIA', 'Microsoft', 'IonQ', 'Quantinuum', 'academic', 'industry'],
    diracContext:
      'This is a landscape overview — students need to know who the major players are and what each brings to the table. Be balanced and factual. Each company has a different approach and different strengths. Academic labs are equally important — breakthroughs come from universities as much as industry. This is practical career-relevant knowledge.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## The Major Players

Quantum computing in 2026 is a global effort spanning tech giants, startups, and universities. Here is your field guide.

### IBM Quantum

| Detail | |
|--------|---|
| **Approach** | Superconducting transmon qubits |
| **Key hardware** | Eagle (127 qubits), Heron (133, higher fidelity), Condor (1,121) |
| **Software** | Qiskit (most popular quantum SDK), Qiskit Runtime |
| **Cloud access** | IBM Quantum — free tier available |
| **Strategy** | Quality over quantity; modular multi-chip architecture; error mitigation |
| **Unique strength** | Largest open-source ecosystem (Qiskit), most cloud users |

IBM pioneered cloud quantum access (2016) and has the most mature software stack. Their roadmap targets 100,000+ qubits by 2033 through modular chip-linking.

### Google Quantum AI

| Detail | |
|--------|---|
| **Approach** | Superconducting qubits |
| **Key hardware** | Sycamore (53 qubits, supremacy 2019), Willow (105 qubits, 2024) |
| **Software** | Cirq (Python framework) |
| **Strategy** | Error correction first; reach fault tolerance, then scale |
| **Unique strength** | First quantum supremacy; first below-threshold error correction (Willow) |

Google is laser-focused on reaching fault tolerance. Willow's demonstration that logical error rates decrease with code distance was a landmark achievement.`,
      },
      {
        type: 'text',
        markdown: `### NVIDIA

| Detail | |
|--------|---|
| **Approach** | Not building qubits — building the classical infrastructure around them |
| **Products** | cuQuantum (GPU-accelerated simulation), CUDA-Q (programming framework), DGX Quantum |
| **Strategy** | Make quantum-classical hybrid workflows seamless on GPUs |
| **Unique strength** | Fastest quantum simulation on earth; hardware-agnostic programming with CUDA-Q |

NVIDIA's role is critical: GPU-accelerated simulation sets the bar that quantum hardware must clear, and CUDA-Q provides a unified programming model across simulators and real hardware.

### Microsoft

| Detail | |
|--------|---|
| **Approach** | Topological qubits (Majorana-based) |
| **Software** | Azure Quantum (multi-provider cloud), Q# language |
| **Strategy** | Build inherently protected qubits that need less error correction |
| **Status** | Announced first topological qubit signatures (2025); still early |
| **Unique strength** | If topological qubits work, they skip much of the error correction overhead |

Microsoft's bet is the riskiest and potentially the most rewarding. Topological qubits are theoretically superior but extraordinarily difficult to engineer.

### Amazon (AWS Braket)

| Detail | |
|--------|---|
| **Approach** | Multi-provider cloud access + internal research (cat qubit) |
| **Providers** | IonQ, Rigetti, OQC, QuEra via Braket |
| **Strategy** | Be the cloud platform where everyone runs quantum jobs |
| **Unique strength** | One API for multiple hardware vendors; pay-per-shot pricing |`,
      },
      {
        type: 'text',
        markdown: `### The Startups

| Company | Approach | Key Differentiator |
|---------|---------|-------------------|
| **IonQ** | Trapped ions (Forte, Tempo) | All-to-all connectivity, high gate fidelity, publicly traded |
| **Quantinuum** | Trapped ions (H-series) | Highest measured quantum volume, Honeywell backing |
| **Xanadu** | Photonic (Borealis) | Room-temperature operation, continuous-variable QC |
| **QuEra** | Neutral atoms | Scalable arrays, native long-range interactions |
| **PsiQuantum** | Photonic (fusion-based) | Bet on manufacturing scale from day one |
| **Rigetti** | Superconducting | Vertical integration (fabricate own chips) |
| **Atom Computing** | Neutral atoms | Demonstrated 1,225-qubit array (2023) |
| **Alice & Bob** | Cat qubits | Hardware-level error protection via engineered dissipation |

### What Hardware Approach Will Win?

Nobody knows. The honest answer:

- **Superconducting**: Most mature, scaling fastest, but needs extreme cooling
- **Trapped ions**: Highest fidelity, all-to-all connectivity, but slower gates
- **Photonic**: Room temperature, natural for networking, but hard to build deterministic gates
- **Neutral atoms**: Scalable (1,000+ qubits demonstrated), flexible, but newer
- **Topological**: Theoretically best, but unproven experimentally

The field may converge on one approach, or different applications may favor different hardware — just as CPUs, GPUs, and TPUs coexist in classical computing.`,
      },
      {
        type: 'text',
        markdown: `## Academic Labs

Breakthrough research still comes primarily from universities. Key labs to know:

### North America

| Lab | Institution | Known For |
|-----|-----------|-----------|
| **Preskill group** | Caltech | Quantum error correction theory, coined "NISQ" |
| **Aaronson group** | UT Austin | Computational complexity, quantum supremacy theory |
| **MIT Center for QE** | MIT | Superconducting qubits, quantum networking |
| **Lukin group** | Harvard | Neutral atoms, quantum simulation |
| **Monroe group** | Duke (formerly Maryland) | Trapped ions, IonQ co-founder |
| **Perimeter Institute** | Waterloo, Canada | Quantum foundations, information theory |
| **IQC** | U. Waterloo | Quantum computing and cryptography |

### Europe

| Lab | Institution | Known For |
|-----|-----------|-----------|
| **QuTech** | TU Delft, Netherlands | Quantum internet, NV-center networking |
| **Oxford QC group** | Oxford | Foundations (Deutsch), ion traps |
| **Innsbruck group** | U. Innsbruck, Austria | Trapped ions, Rainer Blatt |
| **MPQ** | Max Planck, Germany | Neutral atoms, cavity QED |

### Asia-Pacific

| Lab | Institution | Known For |
|-----|-----------|-----------|
| **USTC** | U. Science and Tech of China | Jiuzhang (photonic supremacy), quantum satellite |
| **RIKEN** | Japan | Superconducting qubits, quantum error correction |
| **CQT** | National U. Singapore | Quantum information theory |`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '17.3-q1',
            question: 'Which company demonstrated the first quantum supremacy experiment?',
            options: ['IBM', 'Google', 'IonQ', 'Microsoft'],
            correctIndex: 1,
            explanation:
              'Google demonstrated quantum supremacy in 2019 using the 53-qubit Sycamore processor. The experiment performed random circuit sampling in 200 seconds — a task estimated to take 10,000 years classically (though IBM contested this estimate).',
          },
          {
            id: '17.3-q2',
            question: 'What is NVIDIA\'s role in the quantum computing ecosystem?',
            options: [
              'Building superconducting quantum processors',
              'Providing GPU-accelerated quantum simulation and the CUDA-Q programming framework',
              'Operating the largest quantum cloud service',
              'Developing topological qubits',
            ],
            correctIndex: 1,
            explanation:
              'NVIDIA does not build qubits. Instead, it provides the classical infrastructure: cuQuantum for GPU-accelerated simulation, CUDA-Q for hardware-agnostic quantum programming, and DGX Quantum for hybrid workflows. Their simulation speed sets the bar quantum hardware must clear.',
          },
          {
            id: '17.3-q3',
            question: 'What makes Microsoft\'s approach to quantum computing uniquely risky and potentially rewarding?',
            options: [
              'They are the only company using superconducting qubits',
              'They are betting on topological qubits that are theoretically superior but unproven at scale',
              'They refuse to use error correction',
              'They build quantum hardware in space',
            ],
            correctIndex: 1,
            explanation:
              'Microsoft is pursuing topological qubits based on Majorana particles. If they work, these qubits would have built-in error protection, reducing the overhead for fault tolerance. However, demonstrating topological qubits has been extraordinarily challenging.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Choosing Your Ecosystem',
        visual: 'custom-svg',
        explanation:
          'As a quantum developer, your choice of ecosystem shapes your career. Qiskit (IBM) has the largest community and most learning resources. Cirq (Google) is strong for research and error correction. CUDA-Q (NVIDIA) is ideal for GPU-accelerated hybrid workflows. All three are open-source and Nuclei supports all of them. Start with one, learn the concepts, and the knowledge transfers across frameworks.',
      },
    ],
  },

  // ── Lesson 17.4 ──
  {
    id: '17.4',
    title: 'Career Paths in Quantum',
    description:
      'Quantum software engineer, hardware engineer, researcher, applications scientist — what each role does, skills needed, and how to get started.',
    difficulty: 'beginner',
    estimatedMinutes: 15,
    prerequisites: [],
    tags: ['career', 'jobs', 'skills', 'education', 'software-engineer', 'researcher', 'applications', 'community'],
    diracContext:
      'This is a practical, career-focused lesson. Be honest and helpful. Quantum computing jobs exist and are growing, but the field is competitive. Focus on actionable advice: what skills to build, what to learn, where to find communities. Emphasize that students do NOT need a PhD to contribute — quantum software engineering is increasingly accessible. But also be honest that many research roles do require advanced degrees.',
    contentBlocks: [
      {
        type: 'text',
        markdown: `## Quantum Careers Are Real

Quantum computing is no longer just an academic pursuit. Companies are hiring across a range of roles, and the talent gap is significant — demand exceeds supply.

### The Job Market (2026)

| Metric | Estimate |
|--------|----------|
| **Quantum computing companies worldwide** | 300+ |
| **Open quantum computing positions** | 5,000–10,000+ |
| **Average salary (US, quantum software)** | $130,000–$180,000 |
| **Average salary (US, quantum research)** | $100,000–$160,000 |
| **PhD required?** | For research roles, usually. For software roles, often not. |

The field is growing, but be realistic: most positions are at well-funded startups or large tech companies. Geographic hubs: Bay Area, Boston, New York, Boulder, Toronto, London, Delft, Munich, Sydney.`,
      },
      {
        type: 'text',
        markdown: `## The Four Main Career Paths

### 1. Quantum Software Engineer

**What you do:** Write code that runs on quantum computers. Build compilers, optimizers, SDKs, cloud platforms, and applications.

| Skill | Why |
|-------|-----|
| Python, Rust, or C++ | Core implementation languages |
| Linear algebra | Quantum gates are matrices |
| Qiskit / Cirq / CUDA-Q | Quantum SDKs |
| Classical software engineering | Testing, CI/CD, API design |
| Basic quantum mechanics | Enough to understand what the code does |

**Education:** BS/MS in CS, physics, or math. PhD not required for most roles.
**Employers:** IBM, Google, NVIDIA, Amazon, IonQ, Quantinuum, Rigetti, Xanadu, and many startups.

### 2. Quantum Hardware Engineer

**What you do:** Design, fabricate, and characterize quantum processors. Work in labs with dilution refrigerators, lasers, or photonics.

| Skill | Why |
|-------|-----|
| Experimental physics | Hands-on lab work |
| Electronics / RF engineering | Control systems for qubits |
| Cryogenics or photonics | Depending on qubit type |
| Fabrication (nanolithography) | Building the chips |
| Signal processing | Extracting qubit state from noisy measurements |

**Education:** PhD in experimental physics strongly preferred.
**Employers:** IBM, Google, IonQ, Quantinuum, Rigetti, QuEra, national labs.`,
      },
      {
        type: 'text',
        markdown: `### 3. Quantum Research Scientist

**What you do:** Discover new algorithms, error correction codes, complexity results, or quantum information protocols. Publish papers. Push the theoretical frontier.

| Skill | Why |
|-------|-----|
| Advanced mathematics | Group theory, representation theory, combinatorics |
| Quantum information theory | Entanglement, channels, protocols |
| Algorithm design | Creating and analyzing quantum algorithms |
| Scientific writing | Publishing results |
| Programming (Python) | Numerical experiments and verification |

**Education:** PhD required (physics, CS, or math). Postdoc common.
**Employers:** Universities, national labs, IBM Research, Google Research, Microsoft Research, AWS Center for Quantum Computing.

### 4. Quantum Applications Scientist

**What you do:** Find real-world problems that quantum computers can solve. Work with domain experts (chemists, financial analysts, logistics planners) to translate their problems into quantum algorithms.

| Skill | Why |
|-------|-----|
| Domain expertise | Chemistry, finance, optimization, ML |
| Quantum algorithms | VQE, QAOA, quantum simulation |
| Communication | Explaining quantum to non-quantum people |
| Benchmarking | Comparing quantum vs classical approaches honestly |
| Business understanding | ROI analysis, feasibility assessment |

**Education:** MS or PhD, often with domain specialization.
**Employers:** IBM, Zapata, QC Ware, consulting firms, pharma companies, banks.`,
      },
      {
        type: 'text',
        markdown: `## How to Get Started

### If You Are a Student

1. **Complete this track (and others in Nuclei)** — you are building real quantum programming skills
2. **Take online courses:**
   - IBM Qiskit Textbook (free, excellent)
   - MIT 8.370 Quantum Computation (OCW)
   - Coursera / edX quantum courses
3. **Build projects:**
   - Implement a known algorithm and visualize results
   - Contribute to open-source (Qiskit, Cirq are on GitHub)
   - Enter quantum computing hackathons (IBM Quantum, MIT iQuHACK)
4. **Get certified:**
   - IBM Quantum Developer Certification
   - AWS Braket badges

### If You Are a Working Professional

1. **Leverage your existing skills** — quantum needs classical software engineers, ML engineers, domain scientists
2. **Start part-time:** Learn Qiskit/Cirq evenings and weekends
3. **Look for bridge roles:** "Quantum-curious" positions at companies exploring quantum
4. **Network:** Attend quantum meetups, join Slack/Discord communities

### Communities

| Community | What It Is |
|-----------|-----------|
| **Qiskit Community** | Slack, GitHub, global events, advocate program |
| **Unitary Fund** | Grants for open-source quantum projects ($4,000 microgrants) |
| **Quantum Open Source Foundation** | Community around open-source quantum software |
| **r/QuantumComputing** | Reddit community for discussion |
| **Quantum Computing Stack Exchange** | Q&A for technical questions |
| **fullstackquantumcomputation.tech** | Community for quantum developers |

### Resources

| Resource | Link / Description |
|----------|-------------------|
| **IBM Qiskit Textbook** | qiskit.org/learn — the best free resource |
| **Quantum Country** | quantum.country — spaced repetition quantum learning |
| **Nielsen & Chuang** | "Quantum Computation and Quantum Information" — THE textbook |
| **"Programming Quantum Computers"** | O'Reilly — practical, code-first approach |
| **Nuclei** | You are here! Build, visualize, and learn interactively |`,
      },
      {
        type: 'quiz',
        questions: [
          {
            id: '17.4-q1',
            question: 'Which quantum career path typically does NOT require a PhD?',
            options: [
              'Quantum research scientist',
              'Quantum software engineer',
              'Quantum hardware engineer',
              'Theoretical quantum physicist',
            ],
            correctIndex: 1,
            explanation:
              'Quantum software engineering is increasingly accessible with a BS or MS in CS, physics, or math. You need programming skills, linear algebra, and knowledge of quantum SDKs — but not necessarily a PhD. Research and hardware roles typically require doctoral training.',
          },
          {
            id: '17.4-q2',
            question: 'What is the most important mathematical prerequisite for quantum computing?',
            options: ['Calculus', 'Statistics', 'Linear algebra', 'Number theory'],
            correctIndex: 2,
            explanation:
              'Linear algebra is THE fundamental mathematical tool for quantum computing. Quantum states are vectors, gates are matrices, and measurements are projections. If you know linear algebra well, everything else builds on top of it.',
          },
          {
            id: '17.4-q3',
            question: 'Which organization offers $4,000 microgrants for open-source quantum projects?',
            options: ['IBM Quantum', 'Google Quantum AI', 'Unitary Fund', 'AWS Braket'],
            correctIndex: 2,
            explanation:
              'The Unitary Fund offers $4,000 microgrants to individuals and small teams building open-source quantum software. No affiliation required — it is a great way to get funding for quantum projects while building your portfolio.',
          },
        ],
      },
      {
        type: 'concept-card',
        title: 'Your Quantum Journey',
        visual: 'custom-svg',
        explanation:
          'You have already started. By working through Nuclei\'s tracks, you are building the skills quantum employers want: hands-on programming, algorithm understanding, and circuit intuition. The field is young enough that motivated newcomers can make significant contributions. The key: build things, share them, and engage with the community. Your next steps: finish the tracks, pick a project, contribute to open source, and connect with other learners.',
      },
    ],
  },
];
