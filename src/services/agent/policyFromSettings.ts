import type { AgentHardwareSettings } from '../../stores/settingsStore';
import { DEFAULT_POLICY } from './policy';
import type { AutonomyPolicy } from './policy';

// ---------------------------------------------------------------------------
// Pure mapper from the user-facing `agentHardware` settings group to the
// runtime's AutonomyPolicy. Starts from DEFAULT_POLICY (autonomous hardware
// submission OFF) and only overlays the fields the Settings UI actually
// exposes — every other AutonomyPolicy field (maxQubits, maxCircuitDepth,
// costUnknownBehavior, allowSimulator) keeps its safe default, since there
// is no corresponding user-facing knob for them yet.
// ---------------------------------------------------------------------------

/**
 * Maps persisted `agentHardware` settings onto an AutonomyPolicy. Pure,
 * deterministic, never throws. Settings that are absent/malformed fall back
 * to DEFAULT_POLICY's safe values via the spread below.
 */
export function policyFromSettings(settings: { agentHardware: AgentHardwareSettings }): AutonomyPolicy {
  const { agentHardware } = settings;
  return {
    ...DEFAULT_POLICY,
    autonomousHardwareEnabled: agentHardware.autonomousHardwareEnabled,
    allowQpu: agentHardware.allowQpu,
    maxSpend: agentHardware.maxSpend,
    maxShots: agentHardware.maxShots,
    providerAllowlist: agentHardware.providerAllowlist,
  };
}
