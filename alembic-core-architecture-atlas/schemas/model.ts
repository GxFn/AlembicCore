export interface TestEvidence {
  relation: 'direct' | 'indirect' | 'none';
  path?: string;
  caseTitle?: string;
  anchorSymbol?: string;
  assertedBehavior?: string;
  assertionExcerpt?: string;
  scenarioKind?: string;
  reason?: string;
}
export interface SourceAnchor {
  path: string;
  symbol: string;
  excerpt: string;
}
export interface GraphNode {
  id: string;
  label: string;
  role: string;
  path?: string;
  symbol?: string;
}
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: string;
  source: SourceAnchor;
  test: TestEvidence;
}
export interface Graph {
  id: string;
  title: string;
  description: string;
  viewType: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
export interface Consumer {
  repository: string;
  path: string;
  excerpt: string;
  meaning: string;
  sha256?: string;
}
export interface AtlasDocument {
  moduleDetails?: ModuleDetail[];
  failureModes?: FailureMode[];
  path: string;
  topicId: string;
  title: string;
  question: string;
  truthKind: string;
  baselineCommit: string;
  reviewDepth: string;
  reviewedAt: string;
  sourcePaths: string[];
  testPaths: string[];
  configPaths: string[];
  consumerRefs: Consumer[];
  risks: string[];
  diagrams: Graph[];
  sourceFingerprint: string;
  contextFingerprint: string;
  body: string;
  freshness: string;
  dependencySelection: string[];
  reviewOrigin: string;
}
export interface SourceFile {
  reviewRecordId?: string;
  reviewOrigin?: string;
  reviewedAt?: string;
  reviewMethod?: string;
  path: string;
  sha256: string;
  bytes: number;
  category: string;
  topicId: string | null;
  readLevel: string;
  responsibility: string;
  flow: string;
  reviewStatus: string;
}
export interface ImportEdge {
  id: string;
  from: string;
  to: string | null;
  specifier: string;
  kind: string;
  line: number;
  excerpt: string;
  resolution: string;
}
export interface ModuleDetail {
  id?: string;
  aliases?: string[];
  graphRefs?: string[];
  failureRefs?: string[];
  apiRefs?: string[];
  name: string;
  entry: SourceAnchor;
  input: string;
  output: string;
  calls: string;
  sideEffects: string;
  limits: string;
}
export interface FailureMode {
  aliases?: string[];
  moduleRefs?: string[];
  graphRefs?: string[];
  apiRefs?: string[];
  runbook?: {
    preconditions: string;
    checks: Array<{ observe: string; meaning: string; source?: SourceAnchor; fields?: string[] }>;
    action: string;
    identity: string;
    verify: string;
    stop: string;
  };
  id: string;
  trigger: string;
  remainingState: string;
  automaticAction: string;
  explicitRecovery: string;
  stopCondition: string;
  source: SourceAnchor;
  test: TestEvidence;
}
