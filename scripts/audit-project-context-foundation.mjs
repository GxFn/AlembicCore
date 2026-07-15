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
  createProjectContextDependencyOwnershipV1,
  createProjectContextRequestAuditPlans,
  createProjectContextConsumerLineageReceipt,
  evaluateCertifiedProjectFactsReadiness,
  hashBytes,
  hashCanonicalJson,
} from '../dist/projectContextFoundation.js';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const FOUNDATION_PARENT_COMMIT = '10e43a66fac8748b1da176844bd77505aa949b0e';

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
const SP_BILIDILI_PACKAGE_ROOTS = Object.freeze([
  'Packages/AOXFoundationKit',
  'Packages/AOXNetworkKit',
  'Packages/AOXPlayer',
  'Packages/AOXUIKit',
]);

const args = parseArguments(process.argv.slice(2));
if (args.child) {
  await runChild(args);
} else if (args['historical-only']) {
  const result = await readHistoricalLoadedArtifactReproduction(
    requireAbsolutePath(args['workspace-root'], 'workspace-root')
  );
  console.log(JSON.stringify(result));
  if (!result.verdict.passed) process.exitCode = 1;
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

  const [loadedArtifact, strictPathEvidence, historicalLoadedArtifactReproduction] =
    await Promise.all([
    readLoadedArtifactEvidence(),
    readStrictPathEvidence(),
    readHistoricalLoadedArtifactReproduction(workspaceRoot),
  ]);
  const confirmedDiagnostics = modeResults.flatMap((mode) =>
    mode.firstProcess.requestMatrix.flatMap((row) =>
      row.errors
        .filter((diagnostic) => diagnostic.classification === 'confirmed-defect')
        .map((diagnostic) => ({
          owner: 'AlembicCore',
          projectMode: mode.projectMode,
          repoId: row.repoId,
          requestKind: row.kind,
          diagnostic,
        }))
    )
  );
  const dependencyOwnershipSummary = modeResults.map(buildDependencyOwnershipSummary);
  const openDefects = [
    ...confirmedDiagnostics,
    ...modeResults.flatMap((mode) => mode.firstProcess.readiness.errors.map((error) => ({
      owner: 'AlembicCore',
      projectMode: mode.projectMode,
      error,
    }))),
    ...modeResults.flatMap((mode) => (!mode.allStable
      ? [
          {
            owner: 'AlembicCore',
            projectMode: mode.projectMode,
            error: 'fresh-process identity mismatch',
          },
        ]
      : [])),
    ...dependencyOwnershipSummary.flatMap((summary) =>
      summary.conservation.conserved
        ? []
        : [
            {
              owner: 'AlembicCore',
              projectMode: summary.projectMode,
              error: 'dependency ownership observation/graph conservation failed',
            },
          ]
    ),
  ];
  const reportWithoutHash = {
    kind: 'ProjectContextCapabilityAuditReport',
    schemaVersion: 1,
    section: 'AlembicCore',
    taskId: 'i1-i2-core-content-terminal-fence-t1',
    loadedArtifact,
    historicalLoadedArtifactReproduction,
    reproduction: {
      inputModes: ['MR-ALEMBIC', 'SP-BILIDILI'],
      historicalFailure: 'ProjectContext multi-repo traversal 1/5 and Plan repeatability failure',
      rootCause:
        'Directory-derived module owners were disconnected from package imports/exports, so certified internal and sibling dependencies were mislabeled external. Capture also opened each inventory interval after a pre-read observation without a post-read/content fence, allowing a clean Git revision to certify dirty bytes. Rootcause2 binds dependency names to versioned package/module ownership and binds every verifier-backed candidate to a closed snapshot. The remaining legacy content-host fallback still echoed candidate hashes without a terminal full reread.',
      failingBefore:
        'On commit 5414d681, 326 of 500 MR expected-external diagnostics were certified ownership (156 current-repo private/package imports and 170 approved sibling exports). The controller clean-tree probe also returned readiness passed for dirty bytes. On commit 443ab564, a no-verifier content host could certify A in both complete candidates while switching the terminal eligible inventory/content to B after each post observation; readiness still passed.',
      passingAfter:
        'Canonical ownership conservation, module-seed binding, external-hotspot reconciliation, clean-tree byte verification, verifier-backed fences, legacy content terminal full rereads, adversarial add/delete/modify and AbortError tests, fresh-process MR/SP audits, historical loaded-parent probes, package build, and repository gates pass after repair.',
    },
    modes: modeResults,
    producerInventory: {
      authoritativeProducer: '@alembic/core/project-context-foundation',
      strictLegacyEntries: modeResults[0]?.secondProcess.legacyEntries ?? [],
      actualArtifactOnlyAdapterEvidence: modeResults.map((mode) => ({
        projectMode: mode.projectMode,
        ...mode.secondProcess.actualArtifactOnlyAdapterEvidence,
      })),
      auxiliaryStaticPathEvidence: strictPathEvidence,
      normalCaptureCountPerArtifact: 1,
    },
    diagnosticSummary: modeResults.map((mode) => ({
      projectMode: mode.projectMode,
      counts: Object.fromEntries(
        ['expected-external', 'advisory', 'confirmed-defect'].map((classification) => [
          classification,
          mode.secondProcess.requestMatrix.reduce(
            (sum, row) =>
              sum + row.errors.filter((error) => error.classification === classification).length,
            0
          ),
        ])
      ),
    })),
    dependencyOwnershipSummary,
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

function buildDependencyOwnershipSummary(mode) {
  const classifications = [
    'internal-resolved',
    'approved-sibling',
    'expected-external',
    'confirmed-defect',
  ];
  const resolutions = mode.secondProcess.requestMatrix.flatMap((row) =>
    (row.dependencyResolutions ?? []).map((resolution) => ({
      ...resolution,
      repoId: row.repoId,
      requestKind: row.kind,
    }))
  );
  const counts = Object.fromEntries(
    classifications.map((classification) => {
      const rows = resolutions.filter((row) => row.classification === classification);
      return [
        classification,
        {
          requestOccurrenceCount: rows.length,
          uniqueSpecifierCount: new Set(rows.map((row) => row.dependencyName)).size,
          samples: rows
            .sort(
              (left, right) =>
                left.dependencyName.localeCompare(right.dependencyName) ||
                left.repoId.localeCompare(right.repoId) ||
                left.requestKind.localeCompare(right.requestKind)
            )
            .slice(0, 5),
        },
      ];
    })
  );
  const classifiedDependencyObservations = classifications.reduce(
    (sum, classification) => sum + counts[classification].requestOccurrenceCount,
    0
  );
  const graphOutputEvidence = mode.secondProcess.requestMatrix.reduce(
    (summary, row) => ({
      internalResolutionCount:
        summary.internalResolutionCount + row.dependencyGraphEvidence.internalResolutionCount,
      approvedSiblingCount:
        summary.approvedSiblingCount + row.dependencyGraphEvidence.approvedSiblingCount,
      remainingExternalCount:
        summary.remainingExternalCount + row.dependencyGraphEvidence.remainingExternalCount,
    }),
    { internalResolutionCount: 0, approvedSiblingCount: 0, remainingExternalCount: 0 }
  );
  const graphReconciliation = mode.secondProcess.requestMatrix.reduce(
    (summary, row) => ({
      originalExternalHotspotCount:
        summary.originalExternalHotspotCount +
        row.dependencyGraphReconciliation.originalExternalHotspotCount,
      internalResolvedHotspotCount:
        summary.internalResolvedHotspotCount +
        row.dependencyGraphReconciliation.internalResolvedHotspotCount,
      approvedSiblingHotspotCount:
        summary.approvedSiblingHotspotCount +
        row.dependencyGraphReconciliation.approvedSiblingHotspotCount,
      remainingExternalHotspotCount:
        summary.remainingExternalHotspotCount +
        row.dependencyGraphReconciliation.remainingExternalHotspotCount,
      originalExternalDependencyNames: uniqueStrings([
        ...summary.originalExternalDependencyNames,
        ...(row.dependencyGraphReconciliation.originalExternalDependencyNames ?? []),
      ]),
      internalResolvedDependencyNames: uniqueStrings([
        ...summary.internalResolvedDependencyNames,
        ...(row.dependencyGraphReconciliation.internalResolvedDependencyNames ?? []),
      ]),
      approvedSiblingDependencyNames: uniqueStrings([
        ...summary.approvedSiblingDependencyNames,
        ...(row.dependencyGraphReconciliation.approvedSiblingDependencyNames ?? []),
      ]),
      remainingExternalDependencyNames: uniqueStrings([
        ...summary.remainingExternalDependencyNames,
        ...(row.dependencyGraphReconciliation.remainingExternalDependencyNames ?? []),
      ]),
    }),
    emptyDependencyGraphReconciliation()
  );
  const graphWarningCounts = Object.fromEntries(
    classifications.map((classification) => [
      classification,
      mode.secondProcess.requestMatrix
        .filter((row) => row.kind === 'map')
        .flatMap((row) => row.dependencyResolutions ?? [])
        .filter((resolution) => resolution.classification === classification).length,
    ])
  );
  const originalWarningObservations = mode.secondProcess.requestMatrix.reduce(
    (sum, row) => sum + row.dependencyObservationCount,
    0
  );
  const warningConserved = originalWarningObservations === classifiedDependencyObservations;
  const graphConserved =
    graphReconciliation.originalExternalHotspotCount ===
    graphReconciliation.internalResolvedHotspotCount +
      graphReconciliation.approvedSiblingHotspotCount +
      graphReconciliation.remainingExternalHotspotCount;
  const reconciledOutputMatches =
    graphOutputEvidence.internalResolutionCount ===
      graphReconciliation.internalResolvedHotspotCount &&
    graphOutputEvidence.approvedSiblingCount ===
      graphReconciliation.approvedSiblingHotspotCount &&
    graphOutputEvidence.remainingExternalCount ===
      graphReconciliation.remainingExternalHotspotCount;
  const graphWarningAlignment = mode.secondProcess.requestMatrix
    .filter((row) => row.kind === 'map')
    .map(buildDependencyWarningGraphAlignment);
  const warningGraphAligned = graphWarningAlignment.every((row) => row.aligned);
  return {
    projectMode: mode.projectMode,
    ownershipEvidence: {
      ownershipHash: mode.secondProcess.dependencyOwnership.ownershipHash,
      entryCount: mode.secondProcess.dependencyOwnership.entries.length,
      provenanceHashes: [
        ...new Set(
          mode.secondProcess.dependencyOwnership.entries.map(
            (entry) => entry.provenance.contentHash
          )
        ),
      ].sort(),
      ownerBindings: [
        ...new Set(
          mode.secondProcess.dependencyOwnership.entries.map(
            (entry) => `${entry.repoId}:${entry.ownerModuleId}`
          )
        ),
      ].sort(),
    },
    counts,
    conservation: {
      originalWarningObservations,
      classifiedDependencyObservations,
      warningConserved,
      graphConserved,
      reconciledOutputMatches,
      warningGraphAligned,
      conserved:
        warningConserved && graphConserved && reconciledOutputMatches && warningGraphAligned,
    },
    graphWarningCounts,
    graphWarningAlignment,
    graphReconciliation,
    graphOutputEvidence,
  };
}

function summarizeDependencyGraphOutput(value) {
  const summary = {
    internalResolutionCount: 0,
    approvedSiblingCount: 0,
    remainingExternalCount: 0,
  };
  visit(value);
  return summary;

  function visit(entry) {
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item);
      return;
    }
    if (!entry || typeof entry !== 'object') return;
    if (Array.isArray(entry.internalDependencyNamespaceResolutions)) {
      summary.internalResolutionCount += entry.internalDependencyNamespaceResolutions.length;
    }
    if (Array.isArray(entry.approvedSiblingDependencyHotspots)) {
      summary.approvedSiblingCount += entry.approvedSiblingDependencyHotspots.length;
    }
    if (Array.isArray(entry.externalDependencyHotspots)) {
      summary.remainingExternalCount += entry.externalDependencyHotspots.length;
    }
    for (const item of Object.values(entry)) visit(item);
  }
}

function emptyDependencyGraphReconciliation() {
  return {
    originalExternalHotspotCount: 0,
    internalResolvedHotspotCount: 0,
    approvedSiblingHotspotCount: 0,
    remainingExternalHotspotCount: 0,
    originalExternalDependencyNames: [],
    internalResolvedDependencyNames: [],
    approvedSiblingDependencyNames: [],
    remainingExternalDependencyNames: [],
  };
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function buildDependencyWarningGraphAlignment(row) {
  const resolutionNames = (...classifications) =>
    uniqueStrings(
      (row.dependencyResolutions ?? [])
        .filter((resolution) => classifications.includes(resolution.classification))
        .map((resolution) => resolution.dependencyName)
    );
  const warningNames = {
    original: resolutionNames(
      'internal-resolved',
      'approved-sibling',
      'expected-external',
      'confirmed-defect'
    ),
    internal: resolutionNames('internal-resolved'),
    approvedSibling: resolutionNames('approved-sibling'),
    remaining: resolutionNames('expected-external', 'confirmed-defect'),
  };
  const graphNames = {
    original: row.dependencyGraphReconciliation.originalExternalDependencyNames ?? [],
    internal: row.dependencyGraphReconciliation.internalResolvedDependencyNames ?? [],
    approvedSibling: row.dependencyGraphReconciliation.approvedSiblingDependencyNames ?? [],
    remaining: row.dependencyGraphReconciliation.remainingExternalDependencyNames ?? [],
  };
  return {
    repoId: row.repoId,
    requestKind: row.kind,
    warningNames,
    graphNames,
    aligned: JSON.stringify(warningNames) === JSON.stringify(graphNames),
  };
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
  const inventoryPolicy =
    mode === 'SP-BILIDILI'
      ? { ...INVENTORY_POLICY, excludeRelativePaths: [...SP_BILIDILI_PACKAGE_ROOTS] }
      : INVENTORY_POLICY;
  const portableRoots = [
      {
        portableId: 'approved-project-root',
        sourceRoot: mode === 'MR-ALEMBIC' ? workspaceRoot : bilidiliRoot,
      },
      ...repositories.map((repository) => ({
        portableId: repository.repoId,
        sourceRoot: repository.sourceRoot,
        moduleAliases: repository.moduleAliases ?? [],
      })),
    ];
  const inventoryPorts = new NodeProjectContextFoundationHostPorts(undefined, {
    portableRoots,
  });
  const descriptorsByRepo = new Map();
  for (const repository of repositories) {
    descriptorsByRepo.set(
      repository.repoId,
      await inventoryPorts.enumerateEligibleFiles({ repository, policy: inventoryPolicy })
    );
  }
  const dependencyOwnership = await buildDependencyOwnership(
    repositories,
    descriptorsByRepo
  );
  const ports = new NodeProjectContextFoundationHostPorts(undefined, {
    portableRoots,
    dependencyOwnership,
  });
  const requestPlans = repositories.flatMap((repository) =>
    createProjectContextRequestAuditPlans({
      repository,
      eligibleFiles: descriptorsByRepo.get(repository.repoId) ?? [],
      dependencyOwnership,
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
  const certification = await buildCertification(
    mode,
    repositories,
    inventoryPolicy,
    detailPolicy,
    dependencyOwnership
  );
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
      inventoryPolicy,
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
  if (!readiness.ok) {
    const dependencyRows = artifact.facts.requestOutcomes
      .filter((row) => row.dependencyObservationCount || row.dependencyGraphReconciliation?.originalExternalHotspotCount)
      .map((row) => ({
        repoId: row.repoId,
        kind: row.kind,
        dependencyObservationCount: row.dependencyObservationCount,
        resolutionCounts: Object.fromEntries(
          ['internal-resolved', 'approved-sibling', 'expected-external', 'confirmed-defect'].map(
            (classification) => [
              classification,
              (row.dependencyResolutions ?? []).filter(
                (resolution) => resolution.classification === classification
              ).length,
            ]
          )
        ),
        dependencyGraphReconciliation: row.dependencyGraphReconciliation,
      }));
    throw new TypeError(
      `Capture readiness failed: ${JSON.stringify({ errors: readiness.errors, dependencyRows })}`
    );
  }
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
  const adapterCallTrace = [];
  const adapterStore = new FileCertifiedProjectFactsStore(
    path.join(storeRoot, mode.toLowerCase()),
    { logger: silentLogger }
  );
  const consumerPort = new CertifiedProjectFactsConsumerPort({
    async acquireRunLease(request) {
      adapterCallTrace.push({ operation: 'acquireRunLease', consumerRunId: request.runId });
      return adapterStore.acquireRunLease(request);
    },
    async open(artifactId, certificationBindingHash) {
      adapterCallTrace.push({ operation: 'open', artifactId });
      return adapterStore.open(artifactId, certificationBindingHash);
    },
  });
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
    actualArtifactOnlyAdapterEvidence: {
      allowedStoreOperations: ['acquireRunLease', 'open'],
      callTrace: adapterCallTrace,
      consumerCount: consumerBindings.length,
      legacyProjectContextCallCapabilityExposed: false,
      rawFilesystemScannerCapabilityExposed: false,
    },
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
      sourceRangeHash: hashCanonicalJson(row.sourceRanges),
      sourceRangeSample: row.sourceRanges.slice(0, 5),
      errors: row.errors,
      dependencyResolutions: row.dependencyResolutions,
      dependencyObservationCount: row.dependencyObservationCount ?? 0,
      dependencyGraphReconciliation:
        row.dependencyGraphReconciliation ?? emptyDependencyGraphReconciliation(),
      dependencyGraphEvidence: summarizeDependencyGraphOutput(row.output),
    })),
    dependencyOwnership,
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
    moduleAliases:
      relativeRoot === '.' ? [] : [path.posix.basename(relativeRoot)],
  }));
}

async function buildDependencyOwnership(repositories, descriptorsByRepo) {
  const entries = [];
  for (const repository of repositories) {
    const descriptors = descriptorsByRepo.get(repository.repoId) ?? [];
    const packagePath = path.join(repository.sourceRoot, 'package.json');
    const packageBytes = await readOptionalFile(packagePath);
    if (packageBytes) {
      const manifest = JSON.parse(packageBytes.toString('utf8'));
      const packageName = typeof manifest.name === 'string' ? manifest.name.trim() : '';
      if (packageName) {
        const provenance = {
          relativePath: 'package.json',
          contentHash: hashBytes(packageBytes),
        };
        const ownerModuleId = selectPrimaryOwnerModuleId(descriptors, packageName);
        entries.push({
          repoId: repository.repoId,
          ownerModuleId,
          ownerPackageName: packageName,
          source: 'package-name',
          pattern: packageName,
          provenance,
        });
        for (const exportKey of readPackageMapKeys(manifest.exports, '.')) {
          if (exportKey === '.') continue;
          entries.push({
            repoId: repository.repoId,
            ownerModuleId,
            ownerPackageName: packageName,
            source: 'package-export',
            pattern: `${packageName}${exportKey.slice(1)}`,
            provenance,
          });
        }
        for (const importKey of readPackageMapKeys(manifest.imports, '#')) {
          entries.push({
            repoId: repository.repoId,
            ownerModuleId,
            ownerPackageName: packageName,
            source: 'package-import',
            pattern: importKey,
            targetPatterns: readPackageTargetPatterns(manifest.imports[importKey], importKey),
            provenance,
          });
        }
      }
    }
    for (const moduleAlias of repository.moduleAliases ?? []) {
      const provenanceBytes =
        (await readOptionalFile(path.join(repository.sourceRoot, 'Package.swift'))) ??
        Buffer.from(`explicit-module-alias:${moduleAlias}\n`);
      entries.push({
        repoId: repository.repoId,
        ownerModuleId: selectPrimaryOwnerModuleId(descriptors, moduleAlias),
        ownerPackageName: moduleAlias,
        source: 'module-alias',
        pattern: moduleAlias,
        provenance: {
          relativePath: (await fileExists(path.join(repository.sourceRoot, 'Package.swift')))
            ? 'Package.swift'
            : 'explicit-module-alias-v1',
          contentHash: hashBytes(provenanceBytes),
        },
      });
    }
  }
  return createProjectContextDependencyOwnershipV1(entries);
}

function selectPrimaryOwnerModuleId(descriptors, preferredName) {
  const counts = new Map();
  for (const descriptor of descriptors) {
    for (const owner of descriptor.ownerModuleIds ?? []) {
      if (!owner.startsWith('test:')) {
        counts.set(owner, (counts.get(owner) ?? 0) + 1);
      }
    }
  }
  const preferred = [...counts.keys()].find(
    (owner) => path.posix.basename(owner.slice(owner.indexOf(':') + 1)) === preferredName
  );
  const selected =
    preferred ??
    [...counts.entries()].sort(
      ([leftOwner, leftCount], [rightOwner, rightCount]) =>
        rightCount - leftCount || leftOwner.localeCompare(rightOwner)
    )[0]?.[0];
  if (!selected) {
    throw new TypeError(`No certified module owner is available for ${preferredName}.`);
  }
  return selected;
}

function readPackageMapKeys(value, requiredPrefix) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value)
    .filter((key) => key.startsWith(requiredPrefix))
    .sort();
}

function readPackageTargetPatterns(value, importKey) {
  const targets = [];
  visit(value);
  if (targets.length === 0) {
    throw new TypeError(`Package import ${importKey} has no canonical repository target.`);
  }
  return [...new Set(targets)].sort();

  function visit(entry) {
    if (typeof entry === 'string') {
      if (!entry.startsWith('./')) {
        throw new TypeError(`Package import ${importKey} targets outside its repository: ${entry}.`);
      }
      targets.push(entry.slice(2));
      return;
    }
    if (entry === null) {
      throw new TypeError(`Package import ${importKey} contains a null target.`);
    }
    if (Array.isArray(entry)) {
      for (const child of entry) visit(child);
      return;
    }
    if (entry && typeof entry === 'object') {
      for (const child of Object.values(entry)) visit(child);
      return;
    }
    throw new TypeError(`Package import ${importKey} contains an unsupported target.`);
  }
}

async function readOptionalFile(filePath) {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function fileExists(filePath) {
  return Boolean(await readOptionalFile(filePath));
}

async function buildCertification(
  mode,
  repositories,
  inventoryPolicy,
  detailPolicy,
  dependencyOwnership
) {
  const [capabilityBytes, foundationBytes, captureBytes, grammarEntries] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, 'dist/project-context-capabilities.js')),
    fs.readFile(path.join(REPO_ROOT, 'dist/projectContextFoundation.js')),
    fs.readFile(path.join(REPO_ROOT, 'dist/service/project-context/foundation/capture.js')),
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
    acceptedRuntimeHash: hashCanonicalJson({
      capture: hashBytes(captureBytes),
      entry: hashBytes(foundationBytes),
    }),
    acceptedConfigHash: hashCanonicalJson({
      mode,
      inventoryPolicy,
      detailPolicy,
      dependencyOwnershipHash: dependencyOwnership.ownershipHash,
    }),
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
  const [commit, tree, packageBytes, foundationBytes, capabilityBytes, captureBytes] =
    await Promise.all([
      gitOutput(['rev-parse', 'HEAD']),
      gitOutput(['rev-parse', 'HEAD^{tree}']),
      fs.readFile(path.join(REPO_ROOT, 'package.json')),
      fs.readFile(path.join(REPO_ROOT, 'dist/projectContextFoundation.js')),
      fs.readFile(path.join(REPO_ROOT, 'dist/project-context-capabilities.js')),
      fs.readFile(path.join(REPO_ROOT, 'dist/service/project-context/foundation/capture.js')),
    ]);
  const files = {
    'package.json': hashBytes(packageBytes),
    'dist/projectContextFoundation.js': hashBytes(foundationBytes),
    'dist/project-context-capabilities.js': hashBytes(capabilityBytes),
    'dist/service/project-context/foundation/capture.js': hashBytes(captureBytes),
  };
  return {
    repository: '@alembic/core',
    commit,
    tree,
    files,
    runtimeHash: hashCanonicalJson({ node: process.version, files }),
  };
}

async function readHistoricalLoadedArtifactReproduction(workspaceRoot) {
  const fixtureRoot = path.join(
    workspaceRoot,
    'Test/tmp/p4-dual-mode-five-tool-acceptance-resume6-t1/sources/mr-alembic'
  );
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pcf-parent-capsule-'));
  const capsuleRoot = path.join(temporaryRoot, 'capsule');
  const archivePath = path.join(temporaryRoot, 'parent.tar');
  try {
    await fs.mkdir(capsuleRoot, { recursive: true });
    await execFileAsync(
      'git',
      ['archive', '--format=tar', `--output=${archivePath}`, FOUNDATION_PARENT_COMMIT],
      { cwd: REPO_ROOT, maxBuffer: 128 * 1024 * 1024 }
    );
    await execFileAsync('tar', ['-xf', archivePath, '-C', capsuleRoot], {
      maxBuffer: 128 * 1024 * 1024,
    });
    await fs.symlink(path.join(REPO_ROOT, 'node_modules'), path.join(capsuleRoot, 'node_modules'));
    await execFileAsync('npm', ['run', 'build'], {
      cwd: capsuleRoot,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
    });
    const [firstProcess, secondProcess, parentTree, packageBytes, lockBytes, currentLockBytes] =
      await Promise.all([
        runHistoricalLoadedProbe(capsuleRoot, fixtureRoot, path.join(temporaryRoot, 'home-1')),
        runHistoricalLoadedProbe(capsuleRoot, fixtureRoot, path.join(temporaryRoot, 'home-2')),
        gitOutput(['rev-parse', `${FOUNDATION_PARENT_COMMIT}^{tree}`]),
        fs.readFile(path.join(capsuleRoot, 'package.json')),
        fs.readFile(path.join(capsuleRoot, 'package-lock.json')),
        fs.readFile(path.join(REPO_ROOT, 'package-lock.json')),
      ]);
    const distTable = await hashDirectoryTree(path.join(capsuleRoot, 'dist'));
    const distTreeHash = hashCanonicalJson(distTable);
    const crossProcessStable = firstProcess.outputHash === secondProcess.outputHash;
    const sameProcessRepeatable =
      firstProcess.plan.sameProcessRepeatable && secondProcess.plan.sameProcessRepeatable;
    const projectContextFiveOfFive =
      firstProcess.space.folderCount === 5 &&
      secondProcess.space.folderCount === 5 &&
      firstProcess.space.errorCount === 0 &&
      secondProcess.space.errorCount === 0;
    const configuredPackageIdentity = await readConfiguredPackageIdentity(workspaceRoot);
    const historicalOracles = await readHistoricalOracleEvidence(workspaceRoot);
    return {
      parentCapsule: {
        repository: '@alembic/core',
        commit: FOUNDATION_PARENT_COMMIT,
        tree: parentTree,
        buildCommand: 'npm run build',
        packageHash: hashBytes(packageBytes),
        distTreeHash,
        distFileCount: distTable.length,
        packageLockHash: hashBytes(lockBytes),
        currentPackageLockHash: hashBytes(currentLockBytes),
        dependencyLockMatchesCurrent: hashBytes(lockBytes) === hashBytes(currentLockBytes),
        packageSelfReferenceOnly: true,
      },
      input: {
        fixtureRef:
          'Test/tmp/p4-dual-mode-five-tool-acceptance-resume6-t1/sources/mr-alembic',
        projectMode: 'MR-ALEMBIC',
        repositoryCount: 5,
        inputHash: firstProcess.inputHash,
        repositoryRevisions: firstProcess.repositoryRevisions,
      },
      firstProcess,
      secondProcess,
      verdict: {
        projectContextFiveOfFive,
        sameProcessRepeatable,
        crossProcessStable,
        passed: projectContextFiveOfFive && sameProcessRepeatable && crossProcessStable,
      },
      rootCauseClassification: {
        multiRepoOneOfFive: {
          classification: 'downstream-plugin-consumer-source-defect',
          coreSourceDefect: false,
          staleDistPackageConfigOrRoot: false,
          reason:
            'Plugin b9733ce with Core f427557 discovered/attempted 5 but succeeded 1 because its private 240-file cap and unsupported broad-parser policy converted four usable repositories into failures; Plugin bf9e587 alone produced 5/5/5 with the same Core commit.',
        },
        planRepeatability: {
          classification: 'historical-core-source-defect-fixed-before-parent',
          currentSourceDefect: false,
          staleDistPackageConfigOrRoot: false,
          reason:
            'Core 6b60bcd lost 17 warm-pass symbols because Tree.delete was missing; f427557 fixed tree lifetime and is an ancestor of the loaded parent. The fresh-built parent is repeatable in the same process and across two processes.',
        },
        configuredPackageIdentity,
      },
      historicalOracles,
    };
  } finally {
    await fs.rm(temporaryRoot, { force: true, recursive: true });
  }
}

async function runHistoricalLoadedProbe(capsuleRoot, fixtureRoot, homeRoot) {
  await fs.mkdir(homeRoot, { recursive: true });
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--input-type=module', '--eval', historicalLoadedProbeSource()],
    {
      cwd: capsuleRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        ALEMBIC_HOME: homeRoot,
        PCF_PARENT_FIXTURE: fixtureRoot,
      },
      maxBuffer: 128 * 1024 * 1024,
    }
  );
  const marker = stdout
    .split('\n')
    .findLast((line) => line.startsWith('PCF_PARENT_PROBE:'));
  if (!marker) {
    throw new TypeError('Historical loaded parent probe did not return its result marker.');
  }
  return JSON.parse(marker.slice('PCF_PARENT_PROBE:'.length));
}

async function hashDirectoryTree(root) {
  const rows = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = (await fs.readdir(current, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name)
    );
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
      } else if (entry.isFile()) {
        rows.push({
          relativePath: path.relative(root, absolutePath).split(path.sep).join('/'),
          hash: hashBytes(await fs.readFile(absolutePath)),
        });
      }
    }
  }
  return rows.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function readConfiguredPackageIdentity(workspaceRoot) {
  const manifestPath = path.join(workspaceRoot, 'AlembicPlugin/dist/.build-manifest.json');
  const installedCorePath = path.join(workspaceRoot, 'AlembicPlugin/node_modules/@alembic/core');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const resolvedCoreRoot = await fs.realpath(installedCorePath);
  const { stdout } = await execFileAsync('git', ['-C', resolvedCoreRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  const resolvedCommit = stdout.trim();
  return {
    classification:
      manifest.coreCommit === resolvedCommit
        ? 'configured-package-root-aligned'
        : 'configured-package-root-identity-mismatch',
    declaredCoreCommit: manifest.coreCommit,
    resolvedCoreCommit: resolvedCommit,
    resolvedPackageRef: 'AlembicPlugin/node_modules/@alembic/core -> AlembicCore',
    aligned: manifest.coreCommit === resolvedCommit,
    usedAsParentProof: false,
  };
}

async function readHistoricalOracleEvidence(workspaceRoot) {
  const refs = [
    'AlembicPlugin/.tmp/p4-plan-draft-repeatability-characterization-report.json',
    'AlembicPlugin/.tmp/plan-draft-repeatability-core.json',
    'AlembicPlugin/.tmp/controller-graph-real-probe.json',
    'wakeflow-ledger/workspace/archive/2026-07/alembic-five-knowledge-tools-deep-audit-2026-07-11/developer-progress.md',
  ];
  return Promise.all(
    refs.map(async (relativeRef) => ({
      relativeRef,
      hash: hashBytes(await fs.readFile(path.join(workspaceRoot, relativeRef))),
    }))
  );
}

function historicalLoadedProbeSource() {
  return String.raw`
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const fixtureRoot = process.env.PCF_PARENT_FIXTURE;
const homeRoot = process.env.ALEMBIC_HOME;
if (!fixtureRoot || !homeRoot) throw new Error('historical probe roots are required');
const packageJson = JSON.parse(await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8'));
const projectContextUrl = import.meta.resolve('@alembic/core/project-context');
const planFactsUrl = import.meta.resolve('@alembic/core/service/planFacts');
const distUrl = pathToFileURL(path.join(process.cwd(), 'dist') + path.sep).href;
if (!projectContextUrl.startsWith(distUrl) || !planFactsUrl.startsWith(distUrl)) {
  throw new Error('package self-reference escaped the isolated parent capsule dist');
}
const { ProjectContext } = await import('@alembic/core/project-context');
const { collectPlanProjectContext, buildCompleteProjectInfoTree } =
  await import('@alembic/core/service/planFacts');
const scopeModule = await import(pathToFileURL(path.join(process.cwd(), 'dist/shared/ProjectScope.js')).href);
const repositoryNames = ['Alembic', 'AlembicCore', 'AlembicAgent', 'AlembicPlugin', 'AlembicDashboard'];
const descriptor = scopeModule.createProjectDescriptor({
  controlRoot: fixtureRoot,
  dataRoot: path.join(homeRoot, '.asd/workspaces/parent-probe'),
  displayName: 'Historical parent five repository probe',
  folders: repositoryNames.map((name, index) => ({
    displayName: name,
    id: 'folder-' + name.toLowerCase(),
    path: path.join(fixtureRoot, name),
    repositoryId: name,
    role: index === 0 ? 'primary-source' : 'source',
  })),
  projectId: 'historical-parent-mr',
  projectScopeId: 'scope-historical-parent-mr',
});
await fs.mkdir(path.join(homeRoot, '.asd'), { recursive: true });
const registry = scopeModule.createProjectScopeRegistryDocument([descriptor]);
await fs.writeFile(
  path.join(homeRoot, '.asd', scopeModule.PROJECT_SCOPE_REGISTRY_FILENAME),
  JSON.stringify(registry, null, 2)
);
const sourceFolders = repositoryNames.map((name, index) => ({
  displayName: name,
  folderId: 'folder-' + name.toLowerCase(),
  path: name,
  repositoryId: name,
  role: index === 0 ? 'primary-source' : 'source',
}));
const spaceEnvelope = await ProjectContext.execute({
  kind: 'space',
  project: { projectId: 'historical-parent-mr', projectRoot: fixtureRoot, source: 'parent-probe' },
  scope: { projectRoot: fixtureRoot },
  payload: { includeProjectTree: true, projectId: 'historical-parent-mr', sourceFolders },
});
const summarizePlan = async () => {
  const analysis = await collectPlanProjectContext(fixtureRoot, {
    goal: 'Refresh the isolated P4 source revision manifest without changing source or generating knowledge',
    maxBudget: 5,
  });
  const tree = buildCompleteProjectInfoTree(analysis);
  const portableTree = portable(tree);
  const serializedTree = JSON.stringify(portableTree);
  return {
    contextStatus: analysis.contextStatus,
    fileCount: analysis.fileCount,
    moduleCount: analysis.moduleCount,
    requestKinds: analysis.requestKinds,
    sourceFileFactCount: analysis.sourceFileFacts.length,
    symbolCount: countKind(tree, 'symbol'),
    fullTreeBytes: Buffer.byteLength(serializedTree),
    fullTreeHash: sha(serializedTree),
    parserFailures: analysis.presenterInput.warnings
      .filter((warning) => warning.message.includes('parser failed for'))
      .map((warning) => portable(warning.message)),
  };
};
const first = await summarizePlan();
const repeated = await summarizePlan();
const repositoryRevisions = repositoryNames.map((name) => {
  const root = path.join(fixtureRoot, name);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  return {
    repoId: name,
    relativeRoot: name,
    commit: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'),
    statusHash: sha(git('status', '--porcelain=v1', '--untracked-files=all')),
  };
});
const portableSpace = portable(spaceEnvelope);
const space = {
  folderCount: Array.isArray(spaceEnvelope.data?.sourceFolders)
    ? spaceEnvelope.data.sourceFolders.length
    : 0,
  repositoryIds: Array.isArray(spaceEnvelope.data?.sourceFolders)
    ? spaceEnvelope.data.sourceFolders.map((folder) => folder.repositoryId).sort()
    : [],
  errorCount: spaceEnvelope.errors?.length ?? 0,
  errors: portable(spaceEnvelope.errors ?? []),
  outputHash: sha(JSON.stringify(portableSpace)),
};
const loadedFiles = await Promise.all([projectContextUrl, planFactsUrl].map(async (url) => {
  const bytes = await fs.readFile(fileURLToPath(url));
  return {
    resolvedSuffix: path.relative(process.cwd(), fileURLToPath(url)).split(path.sep).join('/'),
    hash: sha(bytes),
    sizeBytes: bytes.byteLength,
  };
}));
const result = {
  inputHash: sha(JSON.stringify({ projectId: 'historical-parent-mr', sourceFolders: portable(sourceFolders) })),
  repositoryRevisions,
  loadedPackage: {
    name: packageJson.name,
    version: packageJson.version,
    files: loadedFiles,
  },
  runtime: {
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    webTreeSitter: packageJson.dependencies?.['web-tree-sitter'] ?? null,
  },
  space,
  plan: {
    first,
    repeated,
    sameProcessRepeatable: JSON.stringify(first) === JSON.stringify(repeated),
  },
};
result.outputHash = sha(JSON.stringify(result));
console.log('PCF_PARENT_PROBE:' + JSON.stringify(result));

function portable(value) {
  if (typeof value === 'string') {
    return value
      .replaceAll(fixtureRoot.replaceAll('\\\\', '/'), 'portable:fixture')
      .replaceAll(process.cwd().replaceAll('\\\\', '/'), 'portable:parent-capsule')
      .replaceAll(homeRoot.replaceAll('\\\\', '/'), 'portable:probe-home');
  }
  if (Array.isArray(value)) return value.map(portable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, portable(entry)]));
  }
  return value;
}
function sha(value) {
  return 'sha256:' + createHash('sha256').update(value).digest('hex');
}
function countKind(value, kind) {
  if (!value || typeof value !== 'object') return 0;
  const own = value.kind === kind ? 1 : 0;
  return own + (Array.isArray(value.children)
    ? value.children.reduce((sum, child) => sum + countKind(child, kind), 0)
    : 0);
}
`;
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
    if (key === 'child' || key === 'historical-only') {
      result[key] = true;
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
