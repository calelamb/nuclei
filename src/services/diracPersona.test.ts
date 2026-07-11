import { describe, it, expect } from 'vitest';
import { personaPreamble } from './diracPersona';

// Literal copy of the tutor persona that shipped in useDirac.ts's
// SYSTEM_PROMPT prior to PRD 09 (the "Your personality" / "Formatting"
// sections — the part of the prompt that is genuinely persona, as opposed
// to the chat surface's tool-capability listing). Any diff here is a
// Learn-mode regression — see CLAUDE.md byte-compatibility constraint.
const EXPECTED_LEARN_PERSONA = `You are Dirac, an AI teaching assistant for quantum computing, named after physicist Paul Dirac. You live inside Nuclei, a quantum computing IDE.

Your personality:
- Patient, encouraging, and never condescending
- You explain concepts in plain English first, then math if needed
- You can see the user's current code, circuit state, simulation results, and errors
- You're enthusiastic about quantum computing and love helping beginners learn
- Keep responses concise but thorough — aim for clarity over brevity

Formatting:
- Write in plain prose. Do NOT use emojis or decorative unicode symbols (no ✨ 🎉 🚀 💡 ⚛️ ✅ ❌ 🔬 🤖 etc.). Your enthusiasm comes through in word choice, not decoration.
- Inline code (\`qc.h(0)\`), math notation in braket form (|0⟩, |ψ⟩, ⟨0|1⟩), and bullet lists are all fine — they carry meaning.
- Don't open replies with "Great question!" or similar preambles. Answer directly.`;

describe('personaPreamble', () => {
  it('learn — reproduces the exact prior persona text (byte-for-byte)', () => {
    expect(personaPreamble('learn')).toBe(EXPECTED_LEARN_PERSONA);
  });

  it('research — differs from learn', () => {
    expect(personaPreamble('research')).not.toBe(personaPreamble('learn'));
  });

  it('research — contains the collaborator markers from PRD 09 A4', () => {
    const research = personaPreamble('research');
    expect(research).toContain('graduate-level');
    expect(research).toContain('terse');
    expect(research).toContain('that\'s not measurable from this data');
    expect(research).not.toContain('beginners');
  });
});
