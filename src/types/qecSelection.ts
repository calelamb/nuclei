export type QecEntityKind =
  | 'study'
  | 'source'
  | 'session'
  | 'dataset'
  | 'circuit-revision'
  | 'tick'
  | 'qubit'
  | 'stabilizer'
  | 'detector'
  | 'edge'
  | 'logical-observable'
  | 'campaign-point'
  | 'decoder'
  | 'shot'
  | 'round'
  | 'time-window'
  | 'calibration-record'
  | 'cohort'
  | 'alert'
  | 'finding';

export interface QecEntityRef {
  kind: QecEntityKind;
  id: string;
  sessionId?: string;
  datasetId?: string;
}

export interface ResearchSelection {
  primary: QecEntityRef | null;
  scope: readonly QecEntityRef[];
  timeWindow: { start: number; end: number; domain: 'tick' | 'round' | 'ns' } | null;
  source: 'user' | 'panel' | 'alert' | 'dirac' | 'restore';
}
