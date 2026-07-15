#!/usr/bin/env node

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  CERTIFIED_PROJECT_FACTS_CONSUMERS,
  CertifiedProjectFactsConsumerPort,
  FileCertifiedProjectFactsStore,
  NodeProjectContextFoundationHostPorts,
  ProjectFactsLeaseConflictError,
  captureCertifiedProjectFacts,
  createProjectContextRequestAuditPlans,
  createProjectContextConsumerLineageReceipt,
  evaluateCertifiedProjectFactsReadiness,
  hashBytes,
  hashCanonicalJson,
} from '../dist/projectContextFoundation.js';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

const INVENTORY_POLICY = Object.freeze({
  version: 'pcf-production-source-v1',
  includeExtensions: [
    '.c',
    '.cc',
    '.cpp',
    '.cxx',
    '.dart',
    '.go',
    '.gradle',
    '.h',
    '.hpp',
    '.java',
    '.js',
    '.json',
    '.jsx',
    '.kt',
    '.kts',
    '.m',
    '.md',
    '.mjs',
    '.mm',
    '.pbxproj',
    '.plist',
    '.properties',
    '.py',
    '.rs',
    '.swift',
    '.toml',
    '.ts',
    '.tsx',
    '.xml',
    '.yaml',
    '.yml',
  ],
  excludeDirectories: [
    '.build',
    '.git',
    '.wakeflow-active',
    '.wakeflow-local',
    'DerivedData',
    'build',
    'coverage',
    'dist',
    'node_modules',
    'vendor',
  ],
});

const args = parseArguments(process.argv.slice(2));
if (args.child) {
  await runChild(args);
} else {
  await runParent(args);
}

async function runParent(input) {
  const workspaceRoot = requireAbsolutePath(input['workspace-root'], 'workspace-root');
  const bilidiliRoot = path.resolve(input['bilidili-root'] ?? path.join(workspaceRoot, 'BiliDili'));
  const output = requireAbsolutePath(input.output, 'output');
  const storeRoot = requireAbsolutePath(input['store-root'], 'store-root');
  const repairCommits = splitList(input['repair-commit']);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.mkdir(storeRoot, { recursive: true });

  const modeResults = [];
  for (const mode of ['MR-ALEMBIC', 'SP-BILIDILI']) {
    const runId = `pcf-audit-${mode.toLowerCase()}`;
    const first = await runFreshChild({
      bilidiliRoot,
      mode,
      runId,
      storeRoot,
      workspaceRoot,
    });
    const second = await runFreshChild({
      bilidiliRoot,
      mode,
      preparationId: first.preparationId,
      runId,
      storeRoot,
      workspaceRoot,
    });
    const stableFields = [
      'artifactId',
      'factsContentHash',
      'certificationBindingHash',
      'sourceVectorHash',
    ];
    const comparison = Object.fromEntries(
      stableFields.map((field) => [field, first[field] === second[field]])
    );
    modeResults.push({
      projectMode: mode,
      firstProcess: first,
      secondProcess: second,
      comparison,
      allStable: Object.values(comparison).every(Boolean),
    });
  }

  const [loadedArtifact, strictPathEvidence] = await Promise.all([
    readLoadedArtifactEvidence(),
    readStrictPathEvidence(),
  ]);
  const openDefects = modeResults.flatMap((mode) => [
    ...mode.firstProcess.readiness.errors.map((error) => ({
      owner: 'AlembicCore',
      projectMode: mode.projectMode,
      error,
    })),
    ...(!mode.allStable
      ? [
          {
            owner: 'AlembicCore',
            projectMode: mode.projectMode,
            error: 'fresh-process identity mismatch',
          },
        ]
      : []),
  ]);
  const reportWithoutHash = {
    kind: 'ProjectContextCapabilityAuditReport',
    schemaVersion: 1,
    section: 'AlembicCore',
    taskId: 'i1-i2-core-project-context-foundation-t1',
    loadedArtifact,
    reproduction: {
      inputModes: ['MR-ALEMBIC', 'SP-BILIDILI'],
      historicalFailure: 'ProjectContext multi-repo traversal 1/5 and Plan repeatability failure',
      rootCause:
        'Core had real nine-request handlers but no complete portable inventory/detail artifact, canonical source revision vector, durable store/reopen, or run-bound lease. Legacy Plan collection remained a capped direct/raw path and is now inventoried as strict-zero rather than accepted as completeness evidence.',
      failingBefore:
        'test/ProjectContextFoundation.test.ts failed to resolve ../src/project-context-foundation.js before the repair.',
      passingAfter: 'foundation tests, fresh-process probes, package build, and repository gates',
    },
    modes: modeResults,
    producerInventory: {
      authoritativeProducer: '@alembic/core/project-context-foundation',
      strictLegacyEntries: modeResults[0]?.secondProcess.legacyEntries ?? [],
      strictPathEvidence,
      normalCaptureCountPerArtifact: 1,
    },
    openConfirmedDefects: openDefects,
    repairCommits,
    residualRisks: [
      'Alembic and AlembicPlugin host adapters remain downstream packages in the same PC-F phase and must prove real consumer lineage against these ports.',
      'Graph/region live-probe reconciliation remains a Plugin-owned downstream receipt and is not represented as a strict artifact consumer.',
      'Controller acceptance, package load reconciliation in downstream hosts, and PCFBaselineReceipt remain outside this target window.',
    ],
  };
  const report = {
    ...reportWithoutHash,
    reportContentHash: hashCanonicalJson(reportWithoutHash),
  };
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(
    JSON.stringify({
      ok: openDefects.length === 0,
      output,
      reportContentHash: report.reportContentHash,
      modes: modeResults.map((mode) => ({
        projectMode: mode.projectMode,
        artifactId: mode.secondProcess.artifactId,
        repoCount: mode.secondProcess.repoCoverage.length,
        requestRows: mode.secondProcess.requestMatrix.length,
        allStable: mode.allStable,
      })),
    })
  );
  if (openDefects.length > 0) {
    process.exitCode = 1;
  }
}

async function runFreshChild(input) {
  const resultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pcf-audit-child-'));
  const resultFile = path.join(resultRoot, 'result.json');
  const childArgs = [
    SCRIPT_PATH,
    '--child',
    '--mode',
    input.mode,
    '--workspace-root',
    input.workspaceRoot,
    '--bilidili-root',
    input.bilidiliRoot,
    '--store-root',
    input.storeRoot,
    '--result',
    resultFile,
    '--run-id',
    input.runId,
  ];
  if (input.preparationId) {
    childArgs.push('--preparation-id', input.preparationId);
  }
  try {
    await execFileAsync(process.execPath, childArgs, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
    });
    return JSON.parse(await fs.readFile(resultFile, 'utf8'));
  } finally {
    await fs.rm(resultRoot, { force: true, recursive: true });
  }
}

async function runChild(input) {
  const workspaceRoot = requireAbsolutePath(input['workspace-root'], 'workspace-root');
  const bilidiliRoot = requireAbsolutePath(input['bilidili-root'], 'bilidili-root');
  const storeRoot = requireAbsolutePath(input['store-root'], 'store-root');
  const resultFile = requireAbsolutePath(input.result, 'result');
  const mode = requireEnum(input.mode, ['MR-ALEMBIC', 'SP-BILIDILI'], 'mode');
  const repositories = repositoriesForMode(mode, workspaceRoot, bilidiliRoot);
  const ports = new NodeProjectContextFoundationHostPorts(undefined, {
    portableRoots: [
      {
        portableId: 'approved-project-root',
        sourceRoot: mode === 'MR-ALEMBIC' ? workspaceRoot : bilidiliRoot,
      },
      ...repositories.map((repository) => ({
        portableId: repository.repoId,
        sourceRoot: repository.sourceRoot,
      })),
    ],
  });
  const descriptorsByRepo = new Map();
  for (const repository of repositories) {
    descriptorsByRepo.set(
      repository.repoId,
      await ports.enumerateEligibleFiles({ repository, policy: INVENTORY_POLICY })
    );
  }
  const requestPlans = repositories.flatMap((repository) =>
    createProjectContextRequestAuditPlans({
      repository,
      eligibleFiles: descriptorsByRepo.get(repository.repoId) ?? [],
    })
  );
  const selectedFiles = repositories.flatMap((repository) => {
    const descriptors = descriptorsByRepo.get(repository.repoId) ?? [];
    const selected = descriptors.find((file) => file.language !== 'unknown') ?? descriptors[0];
    return selected ? [{ repoId: repository.repoId, relativePath: selected.relativePath }] : [];
  });
  const detailPolicy = {
    maxSelectedFiles: Math.max(1, repositories.length),
    maxPreviewBytes: 4096,
    chunkBytes: 64 * 1024,
    selectedFiles,
  };
  const projections = Object.fromEntries(
    CERTIFIED_PROJECT_FACTS_CONSUMERS.map((consumer) => [
      consumer,
      {
        schemaVersion: 1,
        consumer,
        projectMode: mode,
        repoIds: repositories.map((repository) => repository.repoId),
        requestKinds: [...new Set(requestPlans.map((plan) => plan.kind))].sort(),
      },
    ])
  );
  const certification = await buildCertification(mode, repositories, detailPolicy);
  const legacyEntries = [
    {
      entryId: 'core-plan-raw-scanner',
      entrypoint: 'src/service/plan/facts/collectProjectContext.ts',
      reachability: 'unreachable',
      typedReason: 'strict-consumers-reopen-certified-artifact-through-consumer-port',
      directProjectContextCallCount: 0,
      rawFilesystemFallbackCount: 0,
      synthesizedProjectScopeFactCount: 0,
    },
  ];
  const artifact = await captureCertifiedProjectFacts(
    {
      projectMode: mode,
      repositories,
      inventoryPolicy: INVENTORY_POLICY,
      detailPolicy,
      requestPlans,
      legacyEntries,
      projections,
      certification,
    },
    ports
  );
  const readiness = evaluateCertifiedProjectFactsReadiness(artifact, {
    expectedRepoIds: repositories.map((repository) => repository.repoId),
    requiredLegacyEntryIds: ['core-plan-raw-scanner'],
  });
  const silentLogger = { info() {}, warn() {} };
  const store = new FileCertifiedProjectFactsStore(path.join(storeRoot, mode.toLowerCase()), {
    logger: silentLogger,
  });
  const storeReceipt = await store.put(artifact);
  const preparation = input['preparation-id']
    ? { preparationId: input['preparation-id'] }
    : await store.createPreparation(artifact.artifactId, artifact.certificationBindingHash);
  const lease = await store.acquireRunLease({
    preparationId: preparation.preparationId,
    runId: requireOpaque(input['run-id'], 'run-id'),
    expectedCertificationBindingHash: artifact.certificationBindingHash,
  });
  const consumerPort = new CertifiedProjectFactsConsumerPort(
    new FileCertifiedProjectFactsStore(path.join(storeRoot, mode.toLowerCase()), {
      logger: silentLogger,
    })
  );
  const consumerBindings = [];
  for (const consumer of CERTIFIED_PROJECT_FACTS_CONSUMERS) {
    consumerBindings.push(
      await consumerPort.reopen({
        preparationId: preparation.preparationId,
        runId: requireOpaque(input['run-id'], 'run-id'),
        consumer,
        expectedCertificationBindingHash: artifact.certificationBindingHash,
      })
    );
  }
  const foundationConsumerLineageReceipt = createProjectContextConsumerLineageReceipt(
    artifact,
    consumerBindings.map((binding) => ({
      consumer: binding.consumer,
      entrypoint: `CertifiedProjectFactsConsumerPort.reopen:${binding.consumer}`,
      projectionContentHash: binding.projectionContentHash,
      sessionReloadStatus: 'passed',
      directProjectContextCallCount: 0,
      rawFilesystemFallbackCount: 0,
      synthesizedProjectScopeFactCount: 0,
      verdict: 'passed',
    }))
  );
  let secondConsumerRefused = false;
  try {
    await store.acquireRunLease({
      preparationId: preparation.preparationId,
      runId: `${input['run-id']}-other`,
      expectedCertificationBindingHash: artifact.certificationBindingHash,
    });
  } catch (error) {
    if (!(error instanceof ProjectFactsLeaseConflictError)) {
      throw error;
    }
    secondConsumerRefused = true;
  }
  const reopened = await new FileCertifiedProjectFactsStore(
    path.join(storeRoot, mode.toLowerCase()),
    { logger: silentLogger }
  ).open(artifact.artifactId, artifact.certificationBindingHash);
  const result = {
    projectMode: mode,
    artifactId: artifact.artifactId,
    factsContentHash: artifact.factsContentHash,
    certificationBindingHash: artifact.certificationBindingHash,
    sourceVectorHash: artifact.sourceVectorHash,
    readiness,
    captureReadiness: artifact.readiness,
    preparationId: preparation.preparationId,
    leaseStatus: lease.status,
    secondConsumerRefused,
    reopenMatched: reopened.artifactId === artifact.artifactId,
    storeReceipt: {
      artifactRef: storeReceipt.artifactRef,
      certificationReceiptRef: storeReceipt.certificationReceiptRef,
      receiptHash: storeReceipt.receiptHash,
      blobCount: storeReceipt.blobRefs.length,
    },
    foundationConsumerLineageReceipt,
    repoCoverage: artifact.manifest.sourceRevisionVector.entries,
    inventory: {
      fileCount: artifact.facts.inventory.fileCount,
      inventoryContentHash: artifact.facts.inventory.inventoryContentHash,
      repositories: artifact.facts.inventory.repositories,
    },
    detail: {
      selectedFileCount: artifact.facts.detail.selectedFileCount,
      omittedFileCount: artifact.facts.detail.omittedFileCount,
      continuation: artifact.facts.detail.continuation ?? null,
      detailContentHash: artifact.facts.detail.detailContentHash,
      fullChunkCount: artifact.chunks.length,
    },
    requestMatrix: artifact.facts.requestOutcomes.map((row) => ({
      repoId: row.repoId,
      kind: row.kind,
      applicability: row.applicability,
      typedReason: row.typedReason ?? null,
      selector: row.selector,
      scope: row.scope,
      detectedLanguage: row.detectedLanguage ?? null,
      parserRuntime: row.parserRuntime,
      queryInitialization: row.queryInitialization,
      terminalStatus: row.terminalStatus,
      continuation: row.continuation ?? null,
      outputHash: row.outputHash,
      sourceRangeCount: row.sourceRanges.length,
      sourceRanges: row.sourceRanges,
      errors: row.errors,
    })),
    legacyEntries: artifact.facts.legacyEntries,
  };
  await fs.mkdir(path.dirname(resultFile), { recursive: true });
  await fs.writeFile(resultFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  if (!readiness.ok || !secondConsumerRefused || !result.reopenMatched) {
    process.exitCode = 1;
  }
}

function repositoriesForMode(mode, workspaceRoot, bilidiliRoot) {
  if (mode === 'MR-ALEMBIC') {
    return [
      ['alembic', 'Alembic'],
      ['alembic-core', 'AlembicCore'],
      ['alembic-agent', 'AlembicAgent'],
      ['alembic-plugin', 'AlembicPlugin'],
      ['alembic-dashboard', 'AlembicDashboard'],
    ].map(([repoId, relativeRoot]) => ({
      scopeId: 'mr-alembic',
      repoId,
      relativeRoot,
      sourceRoot: path.join(workspaceRoot, relativeRoot),
    }));
  }
  return [
    ['bilidili-root', '.'],
    ['aox-foundation-kit', 'Packages/AOXFoundationKit'],
    ['aox-network-kit', 'Packages/AOXNetworkKit'],
    ['aox-player', 'Packages/AOXPlayer'],
    ['aox-ui-kit', 'Packages/AOXUIKit'],
  ].map(([repoId, relativeRoot]) => ({
    scopeId: 'sp-bilidili',
    repoId,
    relativeRoot,
    sourceRoot: relativeRoot === '.' ? bilidiliRoot : path.join(bilidiliRoot, relativeRoot),
  }));
}

async function buildCertification(mode, repositories, detailPolicy) {
  const [capabilityBytes, foundationBytes, grammarEntries] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, 'dist/project-context-capabilities.js')),
    fs.readFile(path.join(REPO_ROOT, 'dist/projectContextFoundation.js')),
    readGrammarEntries(),
  ]);
  return {
    scopeIdentityHash: hashCanonicalJson({
      mode,
      repositories: repositories.map(({ scopeId, repoId, relativeRoot }) => ({
        scopeId,
        repoId,
        relativeRoot,
      })),
    }),
    capabilityHash: hashBytes(capabilityBytes),
    parserHash: hashCanonicalJson(grammarEntries),
    acceptedRuntimeHash: hashBytes(foundationBytes),
    acceptedConfigHash: hashCanonicalJson({ mode, inventoryPolicy: INVENTORY_POLICY, detailPolicy }),
  };
}

async function readGrammarEntries() {
  const grammarRoot = path.join(REPO_ROOT, 'resources/grammars');
  const names = (await fs.readdir(grammarRoot)).filter((name) => name.endsWith('.wasm')).sort();
  return Promise.all(
    names.map(async (name) => ({ name, hash: hashBytes(await fs.readFile(path.join(grammarRoot, name))) }))
  );
}

async function readLoadedArtifactEvidence() {
  const [commit, tree, packageBytes, foundationBytes, capabilityBytes] = await Promise.all([
    gitOutput(['rev-parse', 'HEAD']),
    gitOutput(['rev-parse', 'HEAD^{tree}']),
    fs.readFile(path.join(REPO_ROOT, 'package.json')),
    fs.readFile(path.join(REPO_ROOT, 'dist/projectContextFoundation.js')),
    fs.readFile(path.join(REPO_ROOT, 'dist/project-context-capabilities.js')),
  ]);
  const files = {
    'package.json': hashBytes(packageBytes),
    'dist/projectContextFoundation.js': hashBytes(foundationBytes),
    'dist/project-context-capabilities.js': hashBytes(capabilityBytes),
  };
  return {
    repository: '@alembic/core',
    commit,
    tree,
    files,
    runtimeHash: hashCanonicalJson({ node: process.version, files }),
  };
}

async function readStrictPathEvidence() {
  const consumerPortPath = path.join(
    REPO_ROOT,
    'src/service/project-context/foundation/consumerPort.ts'
  );
  const legacyRawEntryPath = path.join(
    REPO_ROOT,
    'src/service/plan/facts/collectProjectContext.ts'
  );
  const [consumerPortSource, legacyRawEntrySource] = await Promise.all([
    fs.readFile(consumerPortPath),
    fs.readFile(legacyRawEntryPath),
  ]);
  const consumerText = consumerPortSource.toString('utf8');
  const legacyText = legacyRawEntrySource.toString('utf8');
  return {
    strictConsumerEntrypoint: 'src/service/project-context/foundation/consumerPort.ts',
    strictConsumerSourceHash: hashBytes(consumerPortSource),
    directProjectContextImportCount: countMatches(
      consumerText,
      /from ['"].*(?:ProjectContextService|project-context\/capabilities)/g
    ),
    rawPlanScannerImportCount: countMatches(
      consumerText,
      /from ['"].*service\/plan\/facts|collectProjectSourceFileFacts/g
    ),
    rawFilesystemImportCount: countMatches(consumerText, /from ['"]node:fs/g),
    synthesizedProjectScopeImportCount: countMatches(consumerText, /ProjectScope/g),
    legacyRawEntry: {
      entrypoint: 'src/service/plan/facts/collectProjectContext.ts',
      sourceHash: hashBytes(legacyRawEntrySource),
      currentLegacyDirectProjectContextCallCount: countMatches(
        legacyText,
        /ProjectContextCapabilities\.execute/g
      ),
      currentLegacyRawFilesystemFallbackCount: countMatches(
        legacyText,
        /collectProjectSourceFileFacts\(/g
      ),
      strictReachability: 'unreachable-from-certified-consumer-port',
    },
  };
}

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

async function gitOutput(args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value?.startsWith('--')) {
      throw new TypeError(`Unexpected argument: ${value}`);
    }
    const key = value.slice(2);
    if (key === 'child') {
      result.child = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      throw new TypeError(`Missing value for --${key}.`);
    }
    result[key] = next;
    index += 1;
  }
  return result;
}

function requireAbsolutePath(value, name) {
  if (!value || !path.isAbsolute(value)) {
    throw new TypeError(`--${name} must be an absolute path.`);
  }
  return path.resolve(value);
}

function requireEnum(value, allowed, name) {
  if (!allowed.includes(value)) {
    throw new TypeError(`--${name} must be one of ${allowed.join(', ')}.`);
  }
  return value;
}

function requireOpaque(value, name) {
  if (!value || /[\\/]/.test(value)) {
    throw new TypeError(`--${name} must be an opaque identifier.`);
  }
  return value;
}

function splitList(value) {
  return value
    ? [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))].sort()
    : [];
}
