/** Reads the live Discovery store and builds the Dirac context (Research only; the caller guards the mode). */

import { useDiscoveryStore, selectSelectedView } from '../../stores/discoveryStore';
import { buildDiscoveryContext } from './context';

export function buildDiscoveryContextFromStores(): string {
  const state = useDiscoveryStore.getState();
  const definition = state.definitions.find((d) => d.fileName === state.selectedDefinition) ?? null;
  const view = selectSelectedView(state);
  return buildDiscoveryContext({
    spec: view?.run.spec ?? definition?.spec ?? null,
    run: view?.run ?? null,
    candidates: view ? view.order.map((id) => view.candidates[id]).filter(Boolean) : [],
    selectedCandidateId: state.selectedCandidateId,
  });
}
