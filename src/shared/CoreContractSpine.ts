export const CORE_CONTRACT_SPINE_VERSION = 1;

export const CORE_CONTRACT_SPINE_ROW_IDS = [
  'I01',
  'I03',
  'I04',
  'I05',
  'I06',
  'I07',
  'I08',
  'I21',
  'I23',
] as const;

export const CORE_CONTRACT_SPINE_FORBIDDEN_RESPONSIBILITIES = [
  'codex-mcp',
  'dashboard-ui-state',
  'ai-provider-runtime',
  'cli-daemon-runtime',
  'agent-tool-execution',
  'tool-execution',
] as const;

export const CORE_LEGACY_CONVERGENCE_CANDIDATE_IDS = [
  'D9-C01',
  'D9-C02',
  'D9-C03',
  'D9-C04',
] as const;

export type CoreContractSpineRowId = (typeof CORE_CONTRACT_SPINE_ROW_IDS)[number];
export type CoreContractSpineForbiddenResponsibility =
  (typeof CORE_CONTRACT_SPINE_FORBIDDEN_RESPONSIBILITIES)[number];
export type CoreLegacyContractConvergenceCandidateId =
  (typeof CORE_LEGACY_CONVERGENCE_CANDIDATE_IDS)[number];
export type CoreLegacyContractConvergenceStatus =
  | 'deleted'
  | 'preserved-with-owner'
  | 'rewritten'
  | 'already-solved'
  | 'blocked';
export type CoreContractFunctionClass =
  | 'package-export'
  | 'rest-query'
  | 'rest-command'
  | 'event-stream'
  | 'job-artifact'
  | 'diagnostic-observability';
export type CoreContractRole =
  | 'package-producer'
  | 'shared-schema-source'
  | 'shared-source-contract';

export interface CoreContractSpineRow {
  artifactPolicy: string;
  capabilityCoverage: readonly string[];
  capabilityDiscovery: readonly string[];
  consumers: readonly string[];
  coreRole: CoreContractRole;
  currentCompatibilityOwner: readonly string[];
  driftGate: string;
  errorKinds: readonly string[];
  exposureClasses: readonly string[];
  fixturePolicy: string;
  functionClass: CoreContractFunctionClass;
  id: CoreContractSpineRowId;
  observabilityKeys: readonly string[];
  removalBlocker: string;
  requiredExportPaths: readonly string[];
  sourceFiles: readonly string[];
  title: string;
  validationCommands: readonly string[];
}

export interface CoreContractSpineValidationIssue {
  code:
    | 'missing-row'
    | 'unexpected-row'
    | 'missing-export'
    | 'missing-source-file'
    | 'missing-contract-field';
  message: string;
  path: string;
  rowId?: CoreContractSpineRowId | string;
}

export interface CoreContractSpineValidationResult {
  issues: CoreContractSpineValidationIssue[];
  rowCount: number;
  valid: boolean;
  version: typeof CORE_CONTRACT_SPINE_VERSION;
}

export interface ValidateCoreContractSpineOptions {
  expectedRowIds?: readonly CoreContractSpineRowId[];
  packageExports?: readonly string[];
  sourceFiles?: readonly string[];
}

export interface CoreContractSpineSummary {
  coreRoles: Record<CoreContractRole, number>;
  functionClasses: Record<CoreContractFunctionClass, number>;
  rowIds: CoreContractSpineRowId[];
  version: typeof CORE_CONTRACT_SPINE_VERSION;
}

export interface CoreLegacyContractConvergenceCandidate {
  cleanupBlocker: string;
  currentCompatibilityOwner: readonly string[];
  currentConsumers: readonly string[];
  decisionRationale: string;
  id: CoreLegacyContractConvergenceCandidateId;
  legacySurface: string;
  publicExposurePolicy: string;
  registryRows: readonly CoreContractSpineRowId[];
  removalTrigger: string;
  replacementContract: string;
  requiredExportPaths: readonly string[];
  sourceFiles: readonly string[];
  status: CoreLegacyContractConvergenceStatus;
  validationCommands: readonly string[];
}

export interface CoreLegacyContractConvergenceValidationIssue {
  candidateId?: CoreLegacyContractConvergenceCandidateId | string;
  code:
    | 'missing-candidate'
    | 'unexpected-candidate'
    | 'missing-export'
    | 'missing-source-file'
    | 'missing-convergence-field'
    | 'deleted-candidate-has-active-consumer';
  message: string;
  path: string;
}

export interface CoreLegacyContractConvergenceValidationResult {
  candidateCount: number;
  issues: CoreLegacyContractConvergenceValidationIssue[];
  valid: boolean;
  version: typeof CORE_CONTRACT_SPINE_VERSION;
}

export interface ValidateCoreLegacyContractConvergenceOptions {
  activeLegacyConsumerRefs?: readonly CoreLegacyContractConvergenceCandidateId[];
  expectedCandidateIds?: readonly CoreLegacyContractConvergenceCandidateId[];
  packageExports?: readonly string[];
  sourceFiles?: readonly string[];
}

export interface CoreLegacyContractConvergenceSummary {
  candidateIds: CoreLegacyContractConvergenceCandidateId[];
  deletedCandidateIds: CoreLegacyContractConvergenceCandidateId[];
  preservedCandidateIds: CoreLegacyContractConvergenceCandidateId[];
  statuses: Record<CoreLegacyContractConvergenceStatus, number>;
  version: typeof CORE_CONTRACT_SPINE_VERSION;
}

export const CORE_CONTRACT_SPINE_ROWS = [
  {
    artifactPolicy: 'Inline export summary; generated declarations and large diffs by artifactRef.',
    capabilityCoverage: ['public subpath import success', 'missing subpath/type failure'],
    capabilityDiscovery: ['package export map', 'consumer import scan'],
    consumers: ['Alembic', 'AlembicPlugin', 'AlembicAgent'],
    coreRole: 'package-producer',
    currentCompatibilityOwner: ['Alembic', 'AlembicPlugin', 'AlembicAgent'],
    driftGate: 'Export map/API inventory diff plus consumer import-boundary lint.',
    errorKinds: ['capability-mismatch', 'not-found', 'internal-build-error'],
    exposureClasses: ['public', 'consumer-needed', 'diagnostic'],
    fixturePolicy: 'Core public import smoke fixtures and consumer builds.',
    functionClass: 'package-export',
    id: 'I01',
    observabilityKeys: ['packageName', 'subpath', 'consumerRepo', 'importFile', 'checkCommand'],
    removalBlocker:
      'No subpath removal before import scans prove no consumer or replacement path is connected.',
    requiredExportPaths: ['.', './daemon', './guard', './shared'],
    sourceFiles: ['package.json', 'src/index.ts', 'src/daemon/index.ts', 'src/shared/index.ts'],
    title: 'Core public package boundary',
    validationCommands: [
      'npm run build:check',
      'npm run smoke:public-api',
      'npm run lint:public-api-boundary',
    ],
  },
  {
    artifactPolicy: 'Inline compact health summary; logs and state snapshots by detailRef.',
    capabilityCoverage: ['ready', 'unavailable', 'partial', 'stale runtime'],
    capabilityDiscovery: ['health response capabilities object'],
    consumers: ['AlembicPlugin', 'AlembicDashboard'],
    coreRole: 'shared-schema-source',
    currentCompatibilityOwner: ['Plugin resident service', 'Dashboard runtime header'],
    driftGate: 'Core runtime fixture compared with provider route and consumer normalizers.',
    errorKinds: ['unavailable', 'capability-mismatch', 'not-found', 'internal-error'],
    exposureClasses: ['public', 'consumer-needed', 'diagnostic', 'internal'],
    fixturePolicy: 'Alembic route fixtures derive from Core runtime contracts.',
    functionClass: 'rest-query',
    id: 'I03',
    observabilityKeys: ['mode', 'route', 'projectId', 'projectScopeId', 'dataRootSource'],
    removalBlocker: 'Consumers discover runtime support through the health route.',
    requiredExportPaths: ['./daemon'],
    sourceFiles: ['src/daemon/RuntimeContracts.ts'],
    title: 'Runtime health and capability discovery',
    validationCommands: ['npm run build:check', 'npm run test'],
  },
  {
    artifactPolicy: 'Inline state summary; diagnostics and logs by detailRef.',
    capabilityCoverage: ['list', 'status', 'current', 'select', 'start', 'stop', 'switch'],
    capabilityDiscovery: ['runtime health', 'projects route summary'],
    consumers: ['AlembicDashboard', 'AlembicPlugin'],
    coreRole: 'shared-schema-source',
    currentCompatibilityOwner: ['Dashboard project runtime selector', 'Plugin dashboard handoff'],
    driftGate: 'Route fixture plus Dashboard source-of-truth normalization test.',
    errorKinds: ['unavailable', 'conflict', 'permission-denied', 'timeout', 'cancelled'],
    exposureClasses: ['consumer-needed', 'diagnostic', 'internal'],
    fixturePolicy: 'Provider route fixtures and Dashboard project runtime samples.',
    functionClass: 'rest-command',
    id: 'I04',
    observabilityKeys: ['projectId', 'projectRoot', 'reasonCode', 'blockingCondition'],
    removalBlocker: 'Runtime switch/open-dashboard workflows depend on this contract.',
    requiredExportPaths: ['./daemon'],
    sourceFiles: ['src/daemon/ProjectRuntimeContracts.ts'],
    title: 'Project runtime control',
    validationCommands: ['npm run build:check', 'npm run test'],
  },
  {
    artifactPolicy: 'Inline summary; registry snapshots by artifactRef.',
    capabilityCoverage: ['empty scope', 'folder list', 'add folder', 'resolve folder'],
    capabilityDiscovery: [
      'runtime health projectScope capability',
      'project-scope route capability',
    ],
    consumers: ['AlembicDashboard', 'AlembicPlugin'],
    coreRole: 'shared-schema-source',
    currentCompatibilityOwner: ['Dashboard ProjectScopePanel', 'Plugin project-scoped tools'],
    driftGate: 'Core ProjectScope fixture against Dashboard normalizer and Plugin client.',
    errorKinds: ['invalid-input', 'unavailable', 'permission-denied', 'conflict', 'not-found'],
    exposureClasses: ['consumer-needed', 'diagnostic'],
    fixturePolicy: 'Provider route fixtures and Dashboard panel samples.',
    functionClass: 'rest-command',
    id: 'I05',
    observabilityKeys: ['projectScopeId', 'folderId', 'controlRoot', 'dataRootSource'],
    removalBlocker: 'Project-scoped routing and UI need this capability.',
    requiredExportPaths: ['./daemon', './shared'],
    sourceFiles: ['src/shared/ProjectScope.ts', 'src/daemon/RuntimeContracts.ts'],
    title: 'ProjectScope contract',
    validationCommands: ['npm run build:check', 'npm run test'],
  },
  {
    artifactPolicy: 'Compact job summary inline; reports/logs/snapshots via artifactRef/detailRef.',
    capabilityCoverage: ['queued', 'running', 'completed', 'failed', 'cancelled'],
    capabilityDiscovery: ['daemon health jobs capability'],
    consumers: ['AlembicPlugin', 'AlembicDashboard'],
    coreRole: 'shared-schema-source',
    currentCompatibilityOwner: ['Plugin codex-local tools', 'Dashboard JobsView'],
    driftGate: 'Job route fixture plus Plugin and Dashboard consumer tests.',
    errorKinds: ['invalid-input', 'unavailable', 'timeout', 'cancelled', 'conflict', 'not-found'],
    exposureClasses: ['public', 'consumer-needed', 'diagnostic'],
    fixturePolicy: 'Alembic owns job route fixtures and real bootstrap/rescan reports.',
    functionClass: 'rest-command',
    id: 'I06',
    observabilityKeys: ['jobId', 'kind', 'status', 'phase', 'reasonCode', 'correlationId'],
    removalBlocker: 'Job orchestration is a primary runtime workflow.',
    requiredExportPaths: ['./daemon'],
    sourceFiles: ['src/daemon/RuntimeContracts.ts', 'src/daemon/JobStore.ts'],
    title: 'Jobs command surface',
    validationCommands: ['npm run build:check', 'npm run test'],
  },
  {
    artifactPolicy:
      'Developer-facing events inline; raw-provider, secret, and hidden reasoning hidden by default.',
    capabilityCoverage: ['workflow', 'llm.input', 'llm.reflection', 'tool', 'artifact', 'error'],
    capabilityDiscovery: ['daemon health jobs.processEvents capability'],
    consumers: ['AlembicDashboard', 'AlembicPlugin'],
    coreRole: 'shared-schema-source',
    currentCompatibilityOwner: ['Dashboard job event timeline'],
    driftGate: 'Event schema fixture plus socket/recovery integration.',
    errorKinds: ['partial', 'unavailable', 'not-found', 'internal-error'],
    exposureClasses: ['developer-facing', 'machine-only', 'raw-provider', 'secret'],
    fixturePolicy: 'Process-event endpoint fixtures and Dashboard hook event samples.',
    functionClass: 'event-stream',
    id: 'I07',
    observabilityKeys: ['jobId', 'eventId', 'sequence', 'correlationId', 'sourceClass'],
    removalBlocker: 'Durable event/recovery behavior depends on this schema.',
    requiredExportPaths: ['./daemon'],
    sourceFiles: ['src/daemon/JobProcessEventContracts.ts'],
    title: 'Job process events',
    validationCommands: ['npm run build:check', 'npm run test'],
  },
  {
    artifactPolicy: 'Snapshot manifest inline; large reports, logs, and LLM IO by artifactRef.',
    capabilityCoverage: ['summary', 'timeline', 'events', 'artifacts', 'llm-io', 'warnings'],
    capabilityDiscovery: ['jobs capability', 'snapshot manifest'],
    consumers: ['AlembicDashboard', 'AlembicPlugin'],
    coreRole: 'shared-schema-source',
    currentCompatibilityOwner: ['Dashboard JobsView'],
    driftGate: 'Snapshot schema validation plus Dashboard rendering fixture.',
    errorKinds: ['not-found', 'artifact-missing', 'artifact-unreadable', 'checksum-mismatch'],
    exposureClasses: ['public', 'developer-facing', 'diagnostic', 'sensitive'],
    fixturePolicy: 'Generated snapshot fixtures and real bootstrap/rescan artifacts.',
    functionClass: 'job-artifact',
    id: 'I08',
    observabilityKeys: ['jobId', 'snapshotId', 'snapshotVersion', 'checksum', 'artifactRef'],
    removalBlocker: 'Runtime verification and user-facing job evidence rely on these endpoints.',
    requiredExportPaths: ['./daemon'],
    sourceFiles: ['src/daemon/JobDisplaySnapshotContracts.ts'],
    title: 'Job display snapshots and artifacts',
    validationCommands: ['npm run build:check', 'npm run test'],
  },
  {
    artifactPolicy: 'Compact findings inline; full reports by artifactRef.',
    capabilityCoverage: ['pass', 'fail', 'warning', 'blocked/unavailable', 'rule lookup'],
    capabilityDiscovery: ['route capability', 'Plugin visible tools'],
    consumers: ['AlembicPlugin', 'AlembicDashboard', 'Codex host'],
    coreRole: 'shared-schema-source',
    currentCompatibilityOwner: ['Codex plugin guard workflow', 'Dashboard guard UI'],
    driftGate: 'Route output vs MCP clean output and Dashboard severity fixture.',
    errorKinds: ['invalid-input', 'unavailable', 'capability-mismatch', 'internal-error'],
    exposureClasses: ['public', 'consumer-needed', 'diagnostic', 'internal'],
    fixturePolicy: 'Alembic guard route fixtures and Plugin/Dashboard replay.',
    functionClass: 'rest-command',
    id: 'I21',
    observabilityKeys: ['ruleId', 'filePath', 'severity', 'operation', 'sourceRef'],
    removalBlocker: 'Code-review workflow depends on guard semantics.',
    requiredExportPaths: ['./guard'],
    sourceFiles: ['src/guard.ts', 'src/service/guard/index.ts'],
    title: 'Guard, rules, violations, and code review surfaces',
    validationCommands: ['npm run build:check', 'npm run test'],
  },
  {
    artifactPolicy: 'Summaries inline; logs and reports as detailRef.',
    capabilityCoverage: ['file-change dispatch', 'signal display', 'audit trail', 'monitoring'],
    capabilityDiscovery: ['runtime health fileMonitor capability', 'route availability'],
    consumers: ['AlembicDashboard', 'AlembicPlugin'],
    coreRole: 'shared-source-contract',
    currentCompatibilityOwner: ['Dashboard diagnostics', 'Plugin diagnostics'],
    driftGate: 'Source-contract aliases plus Dashboard/Plugin diagnostic fixture.',
    errorKinds: ['invalid-input', 'unavailable', 'permission-denied', 'not-found'],
    exposureClasses: ['diagnostic', 'internal', 'consumer-needed', 'sensitive'],
    fixturePolicy: 'Diagnostic route and socket fixtures.',
    functionClass: 'diagnostic-observability',
    id: 'I23',
    observabilityKeys: ['source', 'eventId', 'operation', 'reasonCode', 'failureCode', 'logRef'],
    removalBlocker: 'Diagnostics are required for runtime verification and troubleshooting.',
    requiredExportPaths: ['./daemon', './shared'],
    sourceFiles: ['src/shared/source-contracts.ts', 'src/daemon/RuntimeContracts.ts'],
    title: 'File changes, signals, audit, monitoring, logs',
    validationCommands: ['npm run build:check', 'npm run test'],
  },
] as const satisfies readonly CoreContractSpineRow[];

export const CORE_LEGACY_CONTRACT_CONVERGENCE_CANDIDATES = [
  {
    cleanupBlocker:
      'Alembic and AlembicPlugin still import daemon, shared, guard, search, and core/* public subpaths; direct narrowing waits for consumer migration.',
    currentCompatibilityOwner: ['Alembic', 'AlembicPlugin', 'AlembicAgent'],
    currentConsumers: ['Alembic', 'AlembicPlugin', 'AlembicAgent'],
    decisionRationale:
      'Current product source scans still consume broad public families, so D9 records them as owned Core public contracts instead of narrowing exports early.',
    id: 'D9-C01',
    legacySurface:
      'Wildcard package exports for daemon, shared, guard, search, core/ast, core/capability, core/discovery, and core/enhancement families.',
    publicExposurePolicy:
      'Preserved only as Core-owned deterministic public package boundaries; runtime, UI, MCP, CLI, AI-provider, and tool execution stay outside Core.',
    registryRows: ['I01', 'I03', 'I04', 'I05', 'I06', 'I07', 'I08', 'I21', 'I23'],
    removalTrigger:
      'Every active product import is migrated to an explicit replacement export and consumer build or fixture replay passes.',
    replacementContract:
      'D2 Core contract spine rows plus explicit package export and public API smoke coverage.',
    requiredExportPaths: [
      './daemon',
      './daemon/*',
      './guard',
      './search',
      './shared',
      './core',
      './core/*',
      './core/analysis',
      './core/analysis/*',
      './core/ast',
      './core/ast/*',
      './core/capability',
      './core/capability/*',
      './core/discovery',
      './core/discovery/*',
      './core/enhancement',
      './core/enhancement/*',
    ],
    sourceFiles: ['package.json', 'src/search.ts', 'src/daemon/index.ts', 'src/shared/index.ts'],
    status: 'preserved-with-owner',
    validationCommands: [
      'rg -n "@alembic/core/(search|daemon|shared|guard|core/)" Alembic AlembicPlugin AlembicAgent AlembicDashboard -g "!**/vendor/**" -g "!**/dist/**"',
      'npm run smoke:public-api',
      'npm run check',
    ],
  },
  {
    cleanupBlocker:
      'Dashboard and provider health fixtures still surface fileMonitor.compatibilityAliases for legacy ide-edit classification.',
    currentCompatibilityOwner: ['Alembic provider health route', 'AlembicDashboard capability UI'],
    currentConsumers: ['Alembic', 'AlembicDashboard'],
    decisionRationale:
      'The alias map is consumer-needed diagnostic contract data until provider and Dashboard fixtures prove canonical sources alone are sufficient.',
    id: 'D9-C02',
    legacySurface: 'fileMonitor.compatibilityAliases mapping ide-edit to host-edit.',
    publicExposurePolicy:
      'Diagnostic/consumer-needed capability metadata only; canonical acceptedEventSources remain the source of truth.',
    registryRows: ['I03', 'I23'],
    removalTrigger:
      'Dashboard and provider fixture replay no longer read or display compatibilityAliases and canonical event sources cover all current states.',
    replacementContract:
      'Explicit file monitor capability discovery with canonical acceptedEventSources and source-contract normalizers.',
    requiredExportPaths: ['./daemon', './shared'],
    sourceFiles: ['src/daemon/RuntimeContracts.ts', 'src/shared/source-contracts.ts'],
    status: 'preserved-with-owner',
    validationCommands: [
      'npm run test -- RuntimeContracts SourceContracts',
      'rg -n "compatibilityAliases|ide-edit" Alembic AlembicDashboard -g "!**/vendor/**" -g "!**/dist/**"',
    ],
  },
  {
    cleanupBlocker:
      'Alembic provider project-scope analysis, AlembicAgent evidence, Plugin IDE-agent surfaces, and Dashboard project-scope UI still consume legacyPath compatibility data.',
    currentCompatibilityOwner: [
      'Alembic provider ProjectScopeAnalysis',
      'AlembicAgent source evidence',
      'AlembicPlugin IDEAgentAnalysisSurface',
      'AlembicDashboard ProjectScopePanel',
    ],
    currentConsumers: ['Alembic', 'AlembicAgent', 'AlembicPlugin', 'AlembicDashboard'],
    decisionRationale:
      'Qualified refs are mandatory for new Core-normalized paths, while legacyPath stays as compatibility input/output with explicit ambiguity behavior.',
    id: 'D9-C03',
    legacySurface:
      'legacyPath, byLegacyPath, unique-legacy-path, and ambiguous-legacy-path source-ref compatibility.',
    publicExposurePolicy:
      'qualifiedPath/projectScopeId are first-class; legacyPath is compatibility-only and ambiguous legacy refs must be rejected.',
    registryRows: ['I05'],
    removalTrigger:
      'No current product source or fixture consumes legacyPath/byLegacyPath and qualifiedPath fixture replay passes across provider, Agent, Plugin, and Dashboard.',
    replacementContract:
      'ProjectScope source refs keyed by projectScopeId and repo-qualified qualifiedPath.',
    requiredExportPaths: ['./shared'],
    sourceFiles: ['src/shared/ProjectScope.ts'],
    status: 'preserved-with-owner',
    validationCommands: [
      'npm run test -- ProjectScopeContracts',
      'rg -n "legacyPath|byLegacyPath|ambiguous-legacy-path|unique-legacy-path" Alembic AlembicAgent AlembicPlugin AlembicDashboard -g "!**/vendor/**" -g "!**/dist/**"',
    ],
  },
  {
    cleanupBlocker:
      'No active product consumer remains after D9 alias import scan; keep BM25Scorer class but do not reintroduce BM25* type aliases.',
    currentCompatibilityOwner: [],
    currentConsumers: [],
    decisionRationale:
      'Active product source scan has zero BM25Document/BM25SearchResult/BM25DocMeta imports, and Core internals now use ScorerDocument/ScorerResult/DocMeta.',
    id: 'D9-C04',
    legacySurface: 'Deprecated BM25Document, BM25SearchResult, and BM25DocMeta type aliases.',
    publicExposurePolicy:
      'Deleted type aliases; current public scorer type names remain ScorerDocument, ScorerResult, and DocMeta.',
    registryRows: ['I01'],
    removalTrigger: 'Already satisfied by clean active product import scan and Core typecheck.',
    replacementContract: 'Current scorer names exported from @alembic/core/search.',
    requiredExportPaths: ['./search', './service/search', './service/search/*'],
    sourceFiles: [
      'src/search.ts',
      'src/service/search/SearchTypes.ts',
      'src/service/search/BM25Scorer.ts',
      'src/service/search/FieldWeightedScorer.ts',
    ],
    status: 'deleted',
    validationCommands: [
      'rg -n "BM25Document|BM25SearchResult|BM25DocMeta" Alembic AlembicPlugin AlembicAgent AlembicDashboard -g "!**/vendor/**" -g "!**/dist/**"',
      'npm run build:check',
      'npm run test',
    ],
  },
] as const satisfies readonly CoreLegacyContractConvergenceCandidate[];

export function validateCoreContractSpine(
  options: ValidateCoreContractSpineOptions = {}
): CoreContractSpineValidationResult {
  const expectedRowIds = options.expectedRowIds ?? CORE_CONTRACT_SPINE_ROW_IDS;
  const packageExports = options.packageExports ? new Set(options.packageExports) : null;
  const sourceFiles = options.sourceFiles ? new Set(options.sourceFiles) : null;
  const rowsById = new Map(CORE_CONTRACT_SPINE_ROWS.map((row) => [row.id, row]));
  const expected = new Set(expectedRowIds);
  const issues: CoreContractSpineValidationIssue[] = [];

  for (const rowId of expectedRowIds) {
    if (!rowsById.has(rowId)) {
      issues.push({
        code: 'missing-row',
        message: `Core contract spine row ${rowId} is missing.`,
        path: `rows.${rowId}`,
        rowId,
      });
    }
  }

  for (const row of CORE_CONTRACT_SPINE_ROWS) {
    if (!expected.has(row.id)) {
      issues.push({
        code: 'unexpected-row',
        message: `Core contract spine row ${row.id} is not assigned to D2.`,
        path: `rows.${row.id}`,
        rowId: row.id,
      });
    }

    collectRequiredFieldIssues(row, issues);

    if (packageExports) {
      for (const exportPath of row.requiredExportPaths) {
        if (!packageExports.has(exportPath)) {
          issues.push({
            code: 'missing-export',
            message: `Required package export ${exportPath} is missing for ${row.id}.`,
            path: `rows.${row.id}.requiredExportPaths`,
            rowId: row.id,
          });
        }
      }
    }

    if (sourceFiles) {
      for (const sourceFile of row.sourceFiles) {
        if (!sourceFiles.has(sourceFile)) {
          issues.push({
            code: 'missing-source-file',
            message: `Required source file ${sourceFile} is missing for ${row.id}.`,
            path: `rows.${row.id}.sourceFiles`,
            rowId: row.id,
          });
        }
      }
    }
  }

  return {
    issues,
    rowCount: CORE_CONTRACT_SPINE_ROWS.length,
    valid: issues.length === 0,
    version: CORE_CONTRACT_SPINE_VERSION,
  };
}

export function validateCoreLegacyContractConvergence(
  options: ValidateCoreLegacyContractConvergenceOptions = {}
): CoreLegacyContractConvergenceValidationResult {
  const expectedCandidateIds =
    options.expectedCandidateIds ?? CORE_LEGACY_CONVERGENCE_CANDIDATE_IDS;
  const packageExports = options.packageExports ? new Set(options.packageExports) : null;
  const sourceFiles = options.sourceFiles ? new Set(options.sourceFiles) : null;
  const activeLegacyConsumerRefs = new Set(options.activeLegacyConsumerRefs ?? []);
  const candidatesById = new Map(
    CORE_LEGACY_CONTRACT_CONVERGENCE_CANDIDATES.map((candidate) => [candidate.id, candidate])
  );
  const expected = new Set(expectedCandidateIds);
  const issues: CoreLegacyContractConvergenceValidationIssue[] = [];

  for (const candidateId of expectedCandidateIds) {
    if (!candidatesById.has(candidateId)) {
      issues.push({
        candidateId,
        code: 'missing-candidate',
        message: `Core legacy convergence candidate ${candidateId} is missing.`,
        path: `candidates.${candidateId}`,
      });
    }
  }

  for (const candidate of CORE_LEGACY_CONTRACT_CONVERGENCE_CANDIDATES) {
    if (!expected.has(candidate.id)) {
      issues.push({
        candidateId: candidate.id,
        code: 'unexpected-candidate',
        message: `Core legacy convergence candidate ${candidate.id} is not assigned to D9.`,
        path: `candidates.${candidate.id}`,
      });
    }

    collectLegacyConvergenceFieldIssues(candidate, issues);

    if (candidate.status === 'deleted' && activeLegacyConsumerRefs.has(candidate.id)) {
      issues.push({
        candidateId: candidate.id,
        code: 'deleted-candidate-has-active-consumer',
        message: `Deleted convergence candidate ${candidate.id} still has an active legacy consumer reference.`,
        path: `candidates.${candidate.id}.status`,
      });
    }

    if (packageExports) {
      for (const exportPath of candidate.requiredExportPaths) {
        if (!packageExports.has(exportPath)) {
          issues.push({
            candidateId: candidate.id,
            code: 'missing-export',
            message: `Required package export ${exportPath} is missing for ${candidate.id}.`,
            path: `candidates.${candidate.id}.requiredExportPaths`,
          });
        }
      }
    }

    if (sourceFiles) {
      for (const sourceFile of candidate.sourceFiles) {
        if (!sourceFiles.has(sourceFile)) {
          issues.push({
            candidateId: candidate.id,
            code: 'missing-source-file',
            message: `Required source file ${sourceFile} is missing for ${candidate.id}.`,
            path: `candidates.${candidate.id}.sourceFiles`,
          });
        }
      }
    }
  }

  return {
    candidateCount: CORE_LEGACY_CONTRACT_CONVERGENCE_CANDIDATES.length,
    issues,
    valid: issues.length === 0,
    version: CORE_CONTRACT_SPINE_VERSION,
  };
}

export function summarizeCoreContractSpine(
  rows: readonly CoreContractSpineRow[] = CORE_CONTRACT_SPINE_ROWS
): CoreContractSpineSummary {
  const coreRoles = emptyCoreRoleCounts();
  const functionClasses = emptyFunctionClassCounts();
  for (const row of rows) {
    coreRoles[row.coreRole] += 1;
    functionClasses[row.functionClass] += 1;
  }
  return {
    coreRoles,
    functionClasses,
    rowIds: rows.map((row) => row.id),
    version: CORE_CONTRACT_SPINE_VERSION,
  };
}

export function summarizeCoreLegacyContractConvergence(
  candidates: readonly CoreLegacyContractConvergenceCandidate[] = CORE_LEGACY_CONTRACT_CONVERGENCE_CANDIDATES
): CoreLegacyContractConvergenceSummary {
  const statuses = emptyLegacyConvergenceStatusCounts();
  const deletedCandidateIds: CoreLegacyContractConvergenceCandidateId[] = [];
  const preservedCandidateIds: CoreLegacyContractConvergenceCandidateId[] = [];
  for (const candidate of candidates) {
    statuses[candidate.status] += 1;
    if (candidate.status === 'deleted') {
      deletedCandidateIds.push(candidate.id);
    }
    if (candidate.status === 'preserved-with-owner') {
      preservedCandidateIds.push(candidate.id);
    }
  }

  return {
    candidateIds: candidates.map((candidate) => candidate.id),
    deletedCandidateIds,
    preservedCandidateIds,
    statuses,
    version: CORE_CONTRACT_SPINE_VERSION,
  };
}

function collectRequiredFieldIssues(
  row: CoreContractSpineRow,
  issues: CoreContractSpineValidationIssue[]
) {
  for (const key of [
    'capabilityCoverage',
    'capabilityDiscovery',
    'consumers',
    'currentCompatibilityOwner',
    'errorKinds',
    'exposureClasses',
    'observabilityKeys',
    'requiredExportPaths',
    'sourceFiles',
    'validationCommands',
  ] as const) {
    if (row[key].length === 0) {
      issues.push({
        code: 'missing-contract-field',
        message: `Core contract spine row ${row.id} has empty ${key}.`,
        path: `rows.${row.id}.${key}`,
        rowId: row.id,
      });
    }
  }

  for (const key of ['artifactPolicy', 'driftGate', 'fixturePolicy', 'removalBlocker'] as const) {
    if (row[key].trim().length === 0) {
      issues.push({
        code: 'missing-contract-field',
        message: `Core contract spine row ${row.id} has empty ${key}.`,
        path: `rows.${row.id}.${key}`,
        rowId: row.id,
      });
    }
  }
}

function collectLegacyConvergenceFieldIssues(
  candidate: CoreLegacyContractConvergenceCandidate,
  issues: CoreLegacyContractConvergenceValidationIssue[]
) {
  for (const key of [
    'registryRows',
    'requiredExportPaths',
    'sourceFiles',
    'validationCommands',
  ] as const) {
    if (candidate[key].length === 0) {
      issues.push({
        candidateId: candidate.id,
        code: 'missing-convergence-field',
        message: `Core legacy convergence candidate ${candidate.id} has empty ${key}.`,
        path: `candidates.${candidate.id}.${key}`,
      });
    }
  }

  if (candidate.status === 'preserved-with-owner') {
    for (const key of ['currentConsumers', 'currentCompatibilityOwner'] as const) {
      if (candidate[key].length === 0) {
        issues.push({
          candidateId: candidate.id,
          code: 'missing-convergence-field',
          message: `Preserved convergence candidate ${candidate.id} has empty ${key}.`,
          path: `candidates.${candidate.id}.${key}`,
        });
      }
    }
  }

  for (const key of [
    'cleanupBlocker',
    'decisionRationale',
    'legacySurface',
    'publicExposurePolicy',
    'removalTrigger',
    'replacementContract',
  ] as const) {
    if (candidate[key].trim().length === 0) {
      issues.push({
        candidateId: candidate.id,
        code: 'missing-convergence-field',
        message: `Core legacy convergence candidate ${candidate.id} has empty ${key}.`,
        path: `candidates.${candidate.id}.${key}`,
      });
    }
  }
}

function emptyCoreRoleCounts(): Record<CoreContractRole, number> {
  return {
    'package-producer': 0,
    'shared-schema-source': 0,
    'shared-source-contract': 0,
  };
}

function emptyFunctionClassCounts(): Record<CoreContractFunctionClass, number> {
  return {
    'diagnostic-observability': 0,
    'event-stream': 0,
    'job-artifact': 0,
    'package-export': 0,
    'rest-command': 0,
    'rest-query': 0,
  };
}

function emptyLegacyConvergenceStatusCounts(): Record<CoreLegacyContractConvergenceStatus, number> {
  return {
    'already-solved': 0,
    blocked: 0,
    deleted: 0,
    'preserved-with-owner': 0,
    rewritten: 0,
  };
}
