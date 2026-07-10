import { describe, expect, it } from 'vitest';
import type { AutonomyPolicy, SubmissionFacts } from './policy';
import { DEFAULT_POLICY, evaluateSubmission } from './policy';

const SIM_FACTS: SubmissionFacts = {
  provider: 'simulator',
  backend: 'local-sim',
  shots: 1024,
  qubits: 2,
  depth: 3,
  isSimulator: true,
  estimatedCost: 0,
};

const QPU_FACTS: SubmissionFacts = {
  provider: 'ibm',
  backend: 'ibm-brisbane',
  shots: 1024,
  qubits: 5,
  depth: 10,
  isSimulator: false,
  estimatedCost: 2,
};

const PERMISSIVE_POLICY: AutonomyPolicy = {
  autonomousHardwareEnabled: true,
  allowSimulator: true,
  allowQpu: true,
  providerAllowlist: ['ibm'],
  maxSpend: 10,
  maxShots: 4096,
  maxQubits: 32,
  maxCircuitDepth: 1000,
  costUnknownBehavior: 'needs_approval',
};

describe('evaluateSubmission', () => {
  it('DEFAULT_POLICY allows a simulator submission', () => {
    const decision = evaluateSubmission(SIM_FACTS, DEFAULT_POLICY, Number.POSITIVE_INFINITY);
    expect(decision.decision).toBe('allow');
    expect(decision.reasons).toEqual([]);
  });

  it('DEFAULT_POLICY needs_approval for a real QPU submission (autonomous disabled dominates)', () => {
    const decision = evaluateSubmission(QPU_FACTS, DEFAULT_POLICY, Number.POSITIVE_INFINITY);
    expect(decision.decision).toBe('needs_approval');
    expect(decision.reasons.length).toBeGreaterThan(0);
  });

  it('autonomousHardwareEnabled:false always dominates, regardless of other permissive fields', () => {
    const policy: AutonomyPolicy = { ...PERMISSIVE_POLICY, autonomousHardwareEnabled: false };
    const decision = evaluateSubmission(QPU_FACTS, policy, 1000);
    expect(decision.decision).toBe('needs_approval');
  });

  it('simulator denied when allowSimulator is false', () => {
    const policy: AutonomyPolicy = { ...DEFAULT_POLICY, allowSimulator: false };
    const decision = evaluateSubmission(SIM_FACTS, policy, Number.POSITIVE_INFINITY);
    expect(decision.decision).toBe('deny');
    expect(decision.reasons.length).toBeGreaterThan(0);
  });

  it('allows an ibm QPU submission within every limit under a permissive policy', () => {
    const decision = evaluateSubmission(QPU_FACTS, PERMISSIVE_POLICY, 100);
    expect(decision.decision).toBe('allow');
    expect(decision.reasons).toEqual([]);
  });

  it('denies when allowQpu is false even with autonomy enabled', () => {
    const policy: AutonomyPolicy = { ...PERMISSIVE_POLICY, allowQpu: false };
    const decision = evaluateSubmission(QPU_FACTS, policy, 100);
    expect(decision.decision).toBe('deny');
    expect(decision.reasons.some((r) => /QPU/i.test(r))).toBe(true);
  });

  it('denies when the provider is not in a non-empty allowlist', () => {
    const facts: SubmissionFacts = { ...QPU_FACTS, provider: 'google' };
    const decision = evaluateSubmission(facts, PERMISSIVE_POLICY, 100);
    expect(decision.decision).toBe('deny');
    expect(decision.reasons.some((r) => /allowlist/i.test(r))).toBe(true);
  });

  it('allows any provider when the allowlist is empty', () => {
    const policy: AutonomyPolicy = { ...PERMISSIVE_POLICY, providerAllowlist: [] };
    const facts: SubmissionFacts = { ...QPU_FACTS, provider: 'google' };
    const decision = evaluateSubmission(facts, policy, 100);
    expect(decision.decision).toBe('allow');
  });

  it('denies when shots exceed maxShots, with a shots-specific reason', () => {
    const facts: SubmissionFacts = { ...QPU_FACTS, shots: 5000 };
    const decision = evaluateSubmission(facts, PERMISSIVE_POLICY, 100);
    expect(decision.decision).toBe('deny');
    expect(decision.reasons.some((r) => /shots/i.test(r))).toBe(true);
  });

  it('denies when qubits exceed maxQubits, with a qubits-specific reason', () => {
    const facts: SubmissionFacts = { ...QPU_FACTS, qubits: 64 };
    const decision = evaluateSubmission(facts, PERMISSIVE_POLICY, 100);
    expect(decision.decision).toBe('deny');
    expect(decision.reasons.some((r) => /qubit/i.test(r))).toBe(true);
  });

  it('denies when depth exceeds maxCircuitDepth, with a depth-specific reason', () => {
    const facts: SubmissionFacts = { ...QPU_FACTS, depth: 5000 };
    const decision = evaluateSubmission(facts, PERMISSIVE_POLICY, 100);
    expect(decision.decision).toBe('deny');
    expect(decision.reasons.some((r) => /depth/i.test(r))).toBe(true);
  });

  it('collects a reason for every independent limit violated at once', () => {
    const facts: SubmissionFacts = { ...QPU_FACTS, shots: 5000, qubits: 64, depth: 5000 };
    const decision = evaluateSubmission(facts, PERMISSIVE_POLICY, 100);
    expect(decision.decision).toBe('deny');
    expect(decision.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('denies when estimated cost exceeds maxSpend', () => {
    const facts: SubmissionFacts = { ...QPU_FACTS, estimatedCost: 999 };
    const decision = evaluateSubmission(facts, PERMISSIVE_POLICY, 1000);
    expect(decision.decision).toBe('deny');
    expect(decision.reasons.some((r) => /maxSpend|spend limit/i.test(r))).toBe(true);
  });

  it('denies when estimated cost exceeds the remaining budget even under maxSpend', () => {
    const facts: SubmissionFacts = { ...QPU_FACTS, estimatedCost: 5 };
    const decision = evaluateSubmission(facts, PERMISSIVE_POLICY, 2);
    expect(decision.decision).toBe('deny');
    expect(decision.reasons.some((r) => /remaining budget/i.test(r))).toBe(true);
  });

  it('costUnknownBehavior "deny" denies a null-cost submission', () => {
    const policy: AutonomyPolicy = { ...PERMISSIVE_POLICY, costUnknownBehavior: 'deny' };
    const facts: SubmissionFacts = { ...QPU_FACTS, estimatedCost: null };
    const decision = evaluateSubmission(facts, policy, 100);
    expect(decision.decision).toBe('deny');
  });

  it('costUnknownBehavior "needs_approval" returns needs_approval for a null-cost submission', () => {
    const policy: AutonomyPolicy = { ...PERMISSIVE_POLICY, costUnknownBehavior: 'needs_approval' };
    const facts: SubmissionFacts = { ...QPU_FACTS, estimatedCost: null };
    const decision = evaluateSubmission(facts, policy, 100);
    expect(decision.decision).toBe('needs_approval');
  });

  it('costUnknownBehavior "reserve" allows a null-cost submission when every other check passes', () => {
    const policy: AutonomyPolicy = { ...PERMISSIVE_POLICY, costUnknownBehavior: 'reserve' };
    const facts: SubmissionFacts = { ...QPU_FACTS, estimatedCost: null };
    const decision = evaluateSubmission(facts, policy, 100);
    expect(decision.decision).toBe('allow');
  });

  it('a deny-worthy limit violation still wins over a needs_approval-worthy unknown cost', () => {
    const policy: AutonomyPolicy = { ...PERMISSIVE_POLICY, costUnknownBehavior: 'needs_approval' };
    const facts: SubmissionFacts = { ...QPU_FACTS, shots: 5000, estimatedCost: null };
    const decision = evaluateSubmission(facts, policy, 100);
    expect(decision.decision).toBe('deny');
  });

  it('never throws for pathological inputs', () => {
    const facts: SubmissionFacts = {
      provider: '',
      backend: '',
      shots: -1,
      qubits: -1,
      depth: -1,
      isSimulator: false,
      estimatedCost: Number.NaN,
    };
    expect(() => evaluateSubmission(facts, DEFAULT_POLICY, 0)).not.toThrow();
  });
});
