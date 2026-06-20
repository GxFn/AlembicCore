// Scope (documented honestly per CO1/A6): this smoke gate verifies IMPORT
// ACCESSIBILITY of the built public surface — every exact export path resolves
// and imports from dist/, required runtime symbols exist, and required type
// names appear in the declaration files. It is NOT a behavioral contract test;
// behavior is covered by the vitest suites. It requires a current `npm run
// build` output.
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const exactExportPaths = Object.keys(pkg.exports).filter((exportPath) => !exportPath.includes('*'));
const requiredRootExports = [
  'DEFAULT_FOLDER_NAMES',
  'KnowledgeRepositoryImpl',
  'createHostAgentWorkflowSession',
];
const forbiddenRootExports = [
  'buildIDEAgentAnalysisPacket',
  'buildIDEAgentAnalysisPacketFromSnapshot',
  'ProjectIntelligenceCapability',
  'SourceGraphQueryService',
  'SourceGraphService',
  'createSourceGraphSnapshot',
  'createSourceGraphValidationPlanResult',
];
const forbiddenExportPaths = ['./source-graph'];
forbiddenExportPaths.push(
  './project-intelligence',
  './service/panorama',
  './workflows/capabilities/project-intelligence'
);
const requiredSubpathExports = {
  '@alembic/core/capability': ['CapabilityProbe'],
  '@alembic/core/enhancement': [
    'FrameworkEnhancements',
    'getFrameworkEnhancements',
    'initFrameworkEnhancements',
    'resolveFrameworkEnhancements',
  ],
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
    'ALEMBIC_RESIDENT_API_AI_JOB_FEATURES',
    'ALEMBIC_RESIDENT_FEATURES',
    'ALEMBIC_RESIDENT_SERVICE_CONTRACT_VERSION',
    'ALEMBIC_JOB_DISPLAY_SNAPSHOT_PATH',
    'ALEMBIC_RUNTIME_HEALTH_PATH',
    'JOB_DISPLAY_SNAPSHOT_ARTIFACT_STORAGE_KINDS',
    'JOB_DISPLAY_SNAPSHOT_CONTRACT_VERSION',
    'JOB_DISPLAY_SNAPSHOT_EVIDENCE_INCOMPLETE_REASONS',
    'JOB_DISPLAY_SNAPSHOT_SECTIONS',
    'JOB_PROCESS_EVENT_DISPLAY_POLICIES',
    'JOB_PROCESS_EVENT_KINDS',
    'JOB_PROCESS_EVENT_RETENTION_POLICIES',
    'JOB_PROCESS_EVENT_SOURCE_CLASSES',
    'PROJECT_CONNECTION_STATES',
    'PROJECT_RUNTIME_API_AI_CONFIG_SOURCES',
    'PROJECT_RUNTIME_CONTRACT_VERSION',
    'PROJECT_RUNTIME_CONTROL_STATE_SCHEMA_VERSION',
    'PROJECT_RUNTIME_FIELD_POLICIES',
    'PROJECT_RUNTIME_FAILURE_REASON_TAXONOMY',
    'PROJECT_RUNTIME_FAILURE_REASONS',
    'PROJECT_RUNTIME_READINESS_STATES',
    'PROJECT_RUNTIME_REQUIRED_SERVICES',
    'classifyAlembicResidentJobFeature',
    'collectJobDisplaySnapshotLlmIoEntries',
    'computeJobDisplaySnapshotChecksum',
    'createJobDisplaySnapshot',
    'createJobDisplaySnapshotArtifactRef',
    'createJobDisplaySnapshotEvidenceIncomplete',
    'createJobProcessDeveloperView',
    'createJobProcessEvent',
    'createJobProcessEventEndpointCapability',
    'createAlembicResidentServiceStatus',
    'createAlembicRuntimeCapabilities',
    'createAlembicRuntimeProjectIdentity',
    'createProjectRuntimeFailureEnvelope',
    'createProjectRuntimeControlState',
    'createProjectRuntimeIdentityContract',
    'createProjectRuntimeIdentityContractFromScopeSummary',
    'createProjectRuntimeServiceReadiness',
    'getProjectRuntimeFailureReasonTaxonomy',
    'isAlembicResidentApiAiJobFeature',
    'isJobDisplaySnapshotEvidenceIncompleteReason',
    'isJobDisplaySnapshotLlmIoKind',
    'isJobProcessEventDeveloperVisible',
    'isProjectRuntimeTarget',
    'normalizeJobProcessEventKind',
    'normalizeAlembicResidentServiceStatus',
    'normalizeJobDisplaySnapshotEvidenceIncompleteReason',
    'normalizeProjectConnectionState',
    'normalizeProjectRuntimeFailureReason',
    'normalizeProjectRuntimeRequiredService',
    'summarizeAlembicResidentServiceStatus',
    'summarizeAlembicRuntimeCapabilities',
    'summarizeAlembicRuntimeProjectIdentity',
    'summarizeProjectRuntimeFailureReasonTaxonomy',
    'summarizeProjectRuntimeFieldTaxonomy',
    'summarizeProjectRuntimeScopeReadiness',
    'validateProjectRuntimeFailureReasonTaxonomy',
    'validateProjectRuntimeFieldTaxonomy',
    'validateJobDisplaySnapshot',
  ],
  '@alembic/core/evolution': ['toRescanImpactDecision'],
  '@alembic/core/guard': ['resolveEnhancementGuardRules'],
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
    'buildProducerStyleGuide',
    'getGatewaySourceLabel',
    'normalizeGatewaySource',
    'normalizeLifecycle',
    'SUBMIT_REQUIREMENTS',
  ],
  '@alembic/core/memory': ['MemoryRepositoryImpl', 'createSemanticMemoryRepository'],
  '@alembic/core/project-context': [
    'ProjectContext',
    'ProjectContextCapabilities',
    'createProjectContextCapabilities',
  ],
  '@alembic/core/project-context-capabilities': [
    'ProjectContextCapabilities',
    'createProjectContextCapabilities',
  ],
  '@alembic/core/recipe-context': [
    'RecipeContextService',
    'createRecipeContextService',
    'createRecipeContextServiceFromCore',
  ],
  '@alembic/core/recipe-context-capabilities': [
    'RECIPE_CONTEXT_REQUEST_KIND_VALUES',
    'RecipeContextService',
    'createRecipeContextCapabilities',
    'createRecipeContextCapabilitiesFromCore',
    'createRecipeContextServiceFromCore',
  ],
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
    'CORE_CONTRACT_SPINE_FIELD_POLICIES',
    'CORE_D25_REQUIRED_FAILURE_KINDS',
    'CORE_DIAGNOSTIC_POLICIES',
    'CORE_FAILURE_PROBLEM_CLASSES',
    'CORE_FAILURE_REF_POLICIES',
    'CORE_FAILURE_RETRY_POLICIES',
    'CORE_FAILURE_STATUSES',
    'CORE_FAILURE_TAXONOMY',
    'CORE_FAILURE_TAXONOMY_VERSION',
    'CORE_FIELD_CLASSES',
    'CORE_FIELD_FAILURE_KINDS',
    'CORE_FIELD_TAXONOMY',
    'CORE_INTERFACE_ROLES',
    'CORE_PRIVATE_FIELD_CLASSES',
    'CORE_SCHEMA_CLOSURE_POLICIES',
    'CORE_LEGACY_CONTRACT_CONVERGENCE_CANDIDATES',
    'CORE_LEGACY_CONVERGENCE_CANDIDATE_IDS',
    'CORE_CONTRACT_SPINE_ROW_IDS',
    'CORE_CONTRACT_SPINE_ROWS',
    'CORE_CONTRACT_SPINE_VERSION',
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
    'getCoreFailureTaxonomyEntry',
    'getDeveloperIdentity',
    'ioLimit',
    'isCoreDiagnosticPolicy',
    'isCoreFieldClass',
    'isCoreFieldFailureKind',
    'isCoreInterfaceRole',
    'isCorePrivateFieldClass',
    'isCoreSchemaClosurePolicy',
    'normalizeFileChangeEventSource',
    'normalizeProposalSource',
    'resolveProjectScopeForFolder',
    'summarizeProjectScopeDescriptor',
    'summarizeCoreContractFieldPolicies',
    'summarizeCoreContractSpine',
    'summarizeCoreFailureTaxonomy',
    'summarizeCoreFieldPolicies',
    'summarizeCoreLegacyContractConvergence',
    'validateCoreContractFieldPolicies',
    'validateCoreContractSpine',
    'validateCoreFailureTaxonomy',
    'validateCoreFieldPolicies',
    'validateCoreLegacyContractConvergence',
  ],
  '@alembic/core/types': ['normalizeFileChangeEventSource'],
  '@alembic/core/test-fixtures': [
    'CapabilityProbe',
    'CORE_GRAMMAR_RESOURCE_FILES',
    'ensureProjectGrammarResources',
    'listCoreGrammarResources',
    'reloadProjectAstPlugins',
  ],
  '@alembic/core/vector': [
    'OllamaEmbedProvider',
    'applyEmbedLane',
    'buildLocalFirstEmbedLanes',
    'createOllamaEmbedLane',
    'keywordEmbedLane',
    'selectEmbedLane',
  ],
};
const requiredTypeDeclarations = {
  '@alembic/core/capability': [
    'CapabilityProbeOptions',
    'CapabilityProbeStatus',
  ],
  '@alembic/core/enhancement': [
    'EnhancementPack',
    'EnhancementRegistry',
    'FrameworkEnhancementResolverOptions',
  ],
  '@alembic/core/daemon': [
    'AlembicApiAiCapability',
    'AlembicApiAiConfigSource',
    'AlembicResidentApiAiJobFeature',
    'AlembicResidentDashboardHandoff',
    'AlembicResidentJobReadRequest',
    'AlembicResidentJobSubmitRequest',
    'AlembicResidentSearchRequest',
    'AlembicResidentServiceProbe',
    'AlembicResidentServiceResult',
    'AlembicResidentServiceStatus',
    'JobDisplaySnapshot',
    'JobDisplaySnapshotArtifactRef',
    'JobDisplaySnapshotArtifactStorageKind',
    'JobDisplaySnapshotEvidenceIncomplete',
    'JobDisplaySnapshotEvidenceIncompleteReason',
    'JobDisplaySnapshotLlmIoEntry',
    'JobDisplaySnapshotManifest',
    'JobDisplaySnapshotMetadata',
    'JobDisplaySnapshotRef',
    'JobDisplaySnapshotSection',
    'JobDisplaySnapshotValidationResult',
    'JobProcessDeveloperView',
    'JobProcessEvent',
    'JobProcessEventArtifactRef',
    'JobProcessEventDisplayPolicy',
    'JobProcessEventEndpointCapability',
    'JobProcessEventKind',
    'JobProcessEventRetentionPolicy',
    'JobProcessEventSourceClass',
    'ProjectRuntimeFailureEnvelope',
    'ProjectRuntimeFailureReason',
    'ProjectRuntimeFailureSeverity',
    'ProjectRuntimeFailureReasonTaxonomyEntry',
    'ProjectRuntimeFailureReasonTaxonomySummary',
    'ProjectRuntimeFailureReasonTaxonomyValidationIssue',
    'ProjectRuntimeFailureReasonTaxonomyValidationResult',
    'ProjectRuntimeIdentityContract',
    'ProjectRuntimeApiAiSummary',
    'ProjectRuntimeFieldPolicy',
    'ProjectRuntimeFieldPolicyContract',
    'ProjectRuntimeFieldTaxonomySummary',
    'ProjectRuntimeFieldTaxonomyValidationResult',
    'ProjectRuntimeReadinessState',
    'ProjectRuntimeReadinessSummary',
    'ProjectRuntimeRequiredService',
    'ProjectRuntimeServiceReadiness',
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
  '@alembic/core/project-context': [
    'ProjectContext',
    'ProjectContextCapabilities',
    'ProjectContextCapabilityQuery',
    'ProjectContextEnvelope',
    'ProjectContextRequest',
    'ProjectContextResult',
  ],
  '@alembic/core/project-context-capabilities': [
    'ProjectContextCapabilities',
    'ProjectContextCapabilityQuery',
  ],
  '@alembic/core/recipe-context': [
    'RecipeContextContract',
    'RecipeContextEnvelope',
    'RecipeContextRequest',
    'RecipeContextResult',
  ],
  '@alembic/core/recipe-context-capabilities': [
    'RecipeContextCapabilities',
    'RecipeContextCoreServices',
    'RecipeContextEnvelope',
    'RecipeContextRequest',
  ],
  '@alembic/core/report': ['ReportEntry', 'ReportQueryOptions', 'ReportReader', 'ReportStore'],
  '@alembic/core/test-fixtures': [
    'CapabilityProbeOptions',
    'CapabilityProbeStatus',
    'CoreGrammarResourceFile',
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
for (const exportPath of forbiddenExportPaths) {
  if (exportPath in pkg.exports) {
    throw new Error(`Forbidden package export resurrected: ${exportPath}`);
  }
}
for (const exportName of requiredRootExports) {
  if (!(exportName in root)) {
    throw new Error(`Missing root export: ${exportName}`);
  }
}
for (const exportName of forbiddenRootExports) {
  if (exportName in root) {
    throw new Error(`Forbidden root export resurrected: ${exportName}`);
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
