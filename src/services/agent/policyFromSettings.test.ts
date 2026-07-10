import { describe, expect, it } from 'vitest';
import type { AgentHardwareSettings } from '../../stores/settingsStore';
import { DEFAULT_POLICY } from './policy';
import { policyFromSettings } from './policyFromSettings';

const DEFAULT_AGENT_HARDWARE: AgentHardwareSettings = {
  autonomousHardwareEnabled: false,
  allowQpu: false,
  maxSpend: 0,
  maxShots: 4096,
  providerAllowlist: [],
};

describe('policyFromSettings', () => {
  it('maps default settings to a policy with autonomous hardware submission OFF', () => {
    const policy = policyFromSettings({ agentHardware: DEFAULT_AGENT_HARDWARE });
    expect(policy.autonomousHardwareEnabled).toBe(false);
    expect(policy).toEqual(DEFAULT_POLICY);
  });

  it('overlays enabled settings onto the policy', () => {
    const enabled: AgentHardwareSettings = {
      autonomousHardwareEnabled: true,
      allowQpu: true,
      maxSpend: 25,
      maxShots: 2048,
      providerAllowlist: ['ibm', 'ionq'],
    };
    const policy = policyFromSettings({ agentHardware: enabled });
    expect(policy.autonomousHardwareEnabled).toBe(true);
    expect(policy.allowQpu).toBe(true);
    expect(policy.maxSpend).toBe(25);
    expect(policy.maxShots).toBe(2048);
    expect(policy.providerAllowlist).toEqual(['ibm', 'ionq']);
  });

  it('keeps every unmapped AutonomyPolicy field at its DEFAULT_POLICY value', () => {
    const policy = policyFromSettings({
      agentHardware: { ...DEFAULT_AGENT_HARDWARE, autonomousHardwareEnabled: true },
    });
    expect(policy.allowSimulator).toBe(DEFAULT_POLICY.allowSimulator);
    expect(policy.maxQubits).toBe(DEFAULT_POLICY.maxQubits);
    expect(policy.maxCircuitDepth).toBe(DEFAULT_POLICY.maxCircuitDepth);
    expect(policy.costUnknownBehavior).toBe(DEFAULT_POLICY.costUnknownBehavior);
  });

  it('is pure — never mutates DEFAULT_POLICY or the input settings', () => {
    const before = { ...DEFAULT_POLICY };
    policyFromSettings({ agentHardware: { ...DEFAULT_AGENT_HARDWARE, autonomousHardwareEnabled: true, maxSpend: 999 } });
    expect(DEFAULT_POLICY).toEqual(before);
  });
});
