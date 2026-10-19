/**
 * Side-effect import for tests that exercise the Learn workspace: the gate
 * (see stores/learnGateStore.ts) is off by default, so Learn is unreachable
 * unless a suite opts in. `import '<rel>/test/learnGateOn'` turns it on for
 * that file's module registry.
 */
import { useLearnGateStore } from '../stores/learnGateStore';

useLearnGateStore.getState().setLearnEnabled(true);
