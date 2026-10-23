import type { AtlasDocument, FailureMode, ModuleDetail, SourceAnchor } from './model.ts';
export type JourneyRelation = 'call' | 'data' | 'binding' | 'host-action' | 'reading-order';
export interface JourneyStep {
  id: string;
  title: string;
  relation: JourneyRelation;
  objectRefs?: string[];
  moduleRefs: string[];
  edgeRefs: string[];
  failureRefs: string[];
  input: string;
  output: string;
  state: string;
  action: string;
  source: SourceAnchor;
}
export interface Journey {
  id: string;
  title: string;
  question: string;
  scope: string;
  entryApis: string[];
  steps: JourneyStep[];
  example: { kind: 'illustrative'; input: string; expected: string; limits: string };
  objectRefs: string[];
  runRefs: string[];
  body: string;
  path?: string;
  sourcePaths?: string[];
  testPaths?: string[];
  sourceFingerprint?: string;
  freshness?: string;
  reviewOrigin?: string;
}
export interface CoreObject {
  id: string;
  title: string;
  producer: string;
  consumer: string;
  persistence: string;
  identity: string;
  invalidation: string;
  states: Array<{ name: string; meaning: string }>;
  moduleRefs: string[];
  failureRefs: string[];
  source: SourceAnchor;
  path?: string;
  body?: string;
}
export interface RunRecord {
  command?: { executable: string; args: string[] };
  receiptRef?: string;
  receiptSha256?: string;
  consoleRef?: string;
  consoleSha256?: string;
  observationsRef?: string;
  observationsSha256?: string;
  id: string;
  title: string;
  status: string;
  journeyRefs: string[];
  failureRefs: string[];
  sourcePaths: string[];
  testFiles: string[];
  testNamePattern?: string;
  fixtureDescription?: string;
  observations?: string[];
  limitations?: string[];
  observedAt?: string;
  sourceDigest?: string;
  environment?: Record<string, string>;
  cases?: Array<{ title: string; status: string; duration?: number }>;
  rawRef?: string;
  rawSha256?: string;
  inputFiles?: Array<{ root: string; path: string; sha256: string }>;
  exitCode?: number | null;
  verification?: string;
  errors?: string[];
  probeObservations?: Array<Record<string, unknown>>;
}
export interface JourneyBacklink {
  id: string;
  stepId: string;
  title: string;
  route: string;
}
export interface ModuleCard extends ModuleDetail {
  id: string;
  topicId: string;
  topicTitle: string;
  route: string;
  journeys: JourneyBacklink[];
}
export interface FailureCard extends FailureMode {
  topicId: string;
  topicTitle: string;
  route: string;
  journeys: JourneyBacklink[];
}
export interface SearchEntry {
  id: string;
  kind: string;
  title: string;
  detail: string;
  route: string;
  text: string;
}
export interface BookInput {
  documents: AtlasDocument[];
  journeys?: Journey[];
  objects?: CoreObject[];
  runs?: RunRecord[];
  api: { entries: Array<{ name: string; policy?: string }> };
}
export interface BookIndex {
  modules: ModuleCard[];
  failures: FailureCard[];
  journeys: Journey[];
  objects: CoreObject[];
  runs: RunRecord[];
  graphs: Array<{ id: string; title: string; topicId: string; route: string }>;
  edges: Array<{ id: string; title: string; topicId: string; route: string; path: string }>;
  search: SearchEntry[];
  topicInputs: Array<{ topicId: string; paths: string[] }>;
}
