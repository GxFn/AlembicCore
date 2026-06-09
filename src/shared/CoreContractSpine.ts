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

export type CoreContractSpineRowId = (typeof CORE_CONTRACT_SPINE_ROW_IDS)[number];
export type CoreContractSpineForbiddenResponsibility =
  (typeof CORE_CONTRACT_SPINE_FORBIDDEN_RESPONSIBILITIES)[number];
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
