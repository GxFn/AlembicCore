import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const exactExportPaths = Object.keys(pkg.exports).filter((exportPath) => !exportPath.includes('*'));
const requiredRootExports = [
  'DEFAULT_FOLDER_NAMES',
  'KnowledgeRepositoryImpl',
  'ProjectIntelligenceCapability',
  'createExternalWorkflowSession',
];
const requiredSubpathExports = {
  '@alembic/core/config': [
    'CANDIDATES_DIR',
    'ConfigDefaults',
    'ConfigLoader',
    'ConfigPaths',
    'RECIPES_DIR',
    'getProjectSkillsPath',
  ],
  '@alembic/core/daemon': [
    'ALEMBIC_JOB_PROCESS_EVENTS_PATH',
    'ALEMBIC_RESIDENT_FEATURES',
    'ALEMBIC_RESIDENT_SERVICE_CONTRACT_VERSION',
    'ALEMBIC_RUNTIME_HEALTH_PATH',
    'JOB_PROCESS_EVENT_DISPLAY_POLICIES',
    'JOB_PROCESS_EVENT_KINDS',
    'JOB_PROCESS_EVENT_RETENTION_POLICIES',
    'JOB_PROCESS_EVENT_SOURCE_CLASSES',
    'PROJECT_CONNECTION_STATES',
    'PROJECT_RUNTIME_CONTROL_STATE_SCHEMA_VERSION',
    'classifyAlembicResidentJobFeature',
    'createJobProcessDeveloperView',
    'createJobProcessEvent',
    'createJobProcessEventEndpointCapability',
    'createAlembicResidentServiceStatus',
    'createAlembicRuntimeCapabilities',
    'createAlembicRuntimeProjectIdentity',
    'createProjectRuntimeControlState',
    'isJobProcessEventDeveloperVisible',
    'isProjectRuntimeTarget',
    'normalizeJobProcessEventKind',
    'normalizeAlembicResidentServiceStatus',
    'normalizeProjectConnectionState',
    'summarizeAlembicResidentServiceStatus',
    'summarizeAlembicRuntimeCapabilities',
    'summarizeAlembicRuntimeProjectIdentity',
  ],
  '@alembic/core/evolution': ['toRescanImpactDecision'],
  '@alembic/core/host-agent-workflows': [
    'PROJECT_SKILL_ASSET_KINDS',
    'PROJECT_SKILL_AUTHORIZATION_STATUSES',
    'PROJECT_SKILL_CONFLICT_STATUSES',
    'PROJECT_SKILL_DELIVERY_CONTRACT_VERSION',
    'PROJECT_SKILL_DELIVERY_ROUTES',
    'PROJECT_SKILL_LINK_MODES',
    'PROJECT_SKILL_RUNTIME_EXPORT_STATUSES',
    'PROJECT_SKILL_RUNTIME_EXPORT_STRATEGIES',
    'createAlembicProjectSkillDeliveryReceipt',
    'createPluginProjectSkillDeliveryReceipt',
    'createProjectSkillDeliveryEvidenceRef',
    'isProjectSkillDeliveryReceipt',
    'normalizeProjectSkillDeliveryReceipt',
    'summarizeProjectSkillDeliveryReceipt',
    'validateProjectSkillDeliveryReceipt',
  ],
  '@alembic/core/knowledge': [
    'getGatewaySourceLabel',
    'normalizeGatewaySource',
    'normalizeLifecycle',
  ],
  '@alembic/core/memory': ['MemoryRepositoryImpl', 'createSemanticMemoryRepository'],
  '@alembic/core/repositories': ['getProposalSourceLabel', 'normalizeProposalSource'],
  '@alembic/core/service/candidate': ['aggregateCandidates', 'findSimilarRecipes'],
  '@alembic/core/search': [
    'AuthoritySignal',
    'ContextMatchSignal',
    'MultiSignalRanker',
    'RelevanceSignal',
    'cosineSimilarity',
    'jaccardSimilarity',
    'tokenizeForSimilarity',
  ],
  '@alembic/core/shared': [
    'ALEMBIC_AGENT_SOURCE',
    'AppConfigSchema',
    'ConstitutionViolation',
    'DEFAULT_FOLDER_NAMES',
    'HOST_AGENT_SOURCE',
    'NotFoundError',
    'PROJECT_SCOPE_CONTRACT_VERSION',
    'PROJECT_SCOPE_OPERATIONS',
    'WorkspaceSettingsStore',
    'addProjectScopeFolder',
    'applyTestDimensionFilter',
    'computeContentHash',
    'createProjectDescriptor',
    'createProjectScopeEndpointCapability',
    'createProjectScopeSourceRef',
    'getDeveloperIdentity',
    'ioLimit',
    'normalizeFileChangeEventSource',
    'normalizeProposalSource',
    'resolveProjectScopeForFolder',
    'summarizeProjectScopeDescriptor',
  ],
  '@alembic/core/types': ['normalizeFileChangeEventSource'],
};
const requiredTypeDeclarations = {
  '@alembic/core/daemon': [
    'AlembicResidentDashboardHandoff',
    'AlembicResidentJobReadRequest',
    'AlembicResidentJobSubmitRequest',
    'AlembicResidentSearchRequest',
    'AlembicResidentServiceProbe',
    'AlembicResidentServiceResult',
    'AlembicResidentServiceStatus',
    'JobProcessDeveloperView',
    'JobProcessEvent',
    'JobProcessEventArtifactRef',
    'JobProcessEventDisplayPolicy',
    'JobProcessEventEndpointCapability',
    'JobProcessEventKind',
    'JobProcessEventRetentionPolicy',
    'JobProcessEventSourceClass',
  ],
  '@alembic/core/host-agent-workflows': [
    'ProjectSkillAssetKind',
    'ProjectSkillAuthorizationStatus',
    'ProjectSkillConflictStatus',
    'ProjectSkillDeliveryAsset',
    'ProjectSkillDeliveryAuthorization',
    'ProjectSkillDeliveryEvidenceRef',
    'ProjectSkillDeliveryReceipt',
    'ProjectSkillDeliveryRoute',
    'ProjectSkillDeliveryValidationIssue',
    'ProjectSkillDeliveryValidationResult',
    'ProjectSkillLinkMode',
    'ProjectSkillManagedMarker',
    'ProjectSkillRuntimeExportReceipt',
    'ProjectSkillRuntimeExportStatus',
    'ProjectSkillRuntimeExportStrategy',
  ],
  '@alembic/core/types': [
    'IncrementalPlan',
    'McpContext',
    'WorkflowDatabaseLike',
    'WorkflowSkillHooks',
  ],
};

const imported = [];

for (const exportPath of exactExportPaths) {
  const specifier = exportPath === '.' ? pkg.name : `${pkg.name}/${exportPath.slice(2)}`;
  const mod = await import(specifier);
  imported.push({ specifier, keys: Object.keys(mod).length });
}

const root = await import(pkg.name);
for (const exportName of requiredRootExports) {
  if (!(exportName in root)) {
    throw new Error(`Missing root export: ${exportName}`);
  }
}

for (const [specifier, exportNames] of Object.entries(requiredSubpathExports)) {
  const mod = await import(specifier);
  for (const exportName of exportNames) {
    if (!(exportName in mod)) {
      throw new Error(`Missing ${specifier} export: ${exportName}`);
    }
  }
}

for (const [specifier, exportNames] of Object.entries(requiredTypeDeclarations)) {
  const subpath = specifier === pkg.name ? '.' : `./${specifier.slice(`${pkg.name}/`.length)}`;
  const declarationPath = pkg.exports[subpath]?.types;
  if (!declarationPath) {
    throw new Error(`Missing ${specifier} declaration path`);
  }

  const declaration = readFileSync(
    new URL(`../${declarationPath.replace(/^\.\//, '')}`, import.meta.url),
    'utf8'
  );
  for (const exportName of exportNames) {
    if (!new RegExp(`\\b${exportName}\\b`).test(declaration)) {
      throw new Error(`Missing ${specifier} type declaration: ${exportName}`);
    }
  }
}

console.log(`Imported ${imported.length} exact public API entrypoints.`);
