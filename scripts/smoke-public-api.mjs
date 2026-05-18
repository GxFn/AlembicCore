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
    'ALEMBIC_RUNTIME_HEALTH_PATH',
    'createAlembicRuntimeCapabilities',
    'summarizeAlembicRuntimeCapabilities',
  ],
  '@alembic/core/evolution': ['toRescanImpactDecision'],
  '@alembic/core/knowledge': ['getGatewaySourceLabel', 'normalizeGatewaySource'],
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
    'WorkspaceSettingsStore',
    'applyTestDimensionFilter',
    'computeContentHash',
    'getDeveloperIdentity',
    'ioLimit',
    'normalizeFileChangeEventSource',
    'normalizeProposalSource',
  ],
  '@alembic/core/types': ['normalizeFileChangeEventSource'],
};
const requiredTypeDeclarations = {
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
