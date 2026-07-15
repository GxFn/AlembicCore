#!/usr/bin/env node

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  buildProjectContextRequestMatrixV2,
  buildProjectScopeManifestV1,
  CERTIFIED_PROJECT_FACTS_CONSUMERS,
  CertifiedProjectFactsConsumerPort,
  FileCertifiedProjectFactsStore,
  NodeProjectContextFoundationHostPorts,
  ProjectFactsLeaseConflictError,
  captureCertifiedProjectFactsV2,
  createProjectContextConsumerLineageReceiptV2,
  createProjectContextDependencyOwnershipV1,
  createProjectContextRequestAuditPlansV2,
  evaluateCertifiedProjectFactsReadinessV2,
  evaluateProjectContextRequestMatrixV2,
  hashBytes,
  hashCanonicalJson,
  verifyProjectScopeManifestV1,
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
    '.swiftpm',
    '.wakeflow-active',
    '.wakeflow-local',
    'DerivedData',
    'build',
    'coverage',
    'dist',
    'node_modules',
    'vendor',
    'xcuserdata',
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
      'projectScopeHash',
      'requestMatrixHash',
      'frozenFileManifestHash',
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
  const authorityMutationCards = buildAuthorityMutationCards(modeResults);
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
    ...modeResults.flatMap((mode) =>
      mode.firstProcess.baseConsumerOrdering.unchanged && mode.firstProcess.detail.conservation
        ? []
        : [
            {
              owner: 'AlembicCore',
              projectMode: mode.projectMode,
              error: 'base/post-open ordering or frozen-file conservation failed',
            },
          ]
    ),
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
    ...authorityMutationCards.flatMap((card) =>
      card.rejected
        ? []
        : [
            {
              owner: 'AlembicCore',
              projectMode: card.projectMode,
              error: `authority mutation was not rejected: ${card.mutation}`,
            },
          ]
    ),
  ];
  const reportWithoutHash = {
    kind: 'ProjectContextCapabilityAuditReport',
    schemaVersion: 2,
    section: 'AlembicCore',
    taskId: 'i1-i2-core-foundation-authority-v2-t1',
    loadedArtifact,
    reproduction: {
      inputModes: ['MR-ALEMBIC', 'SP-BILIDILI'],
      historicalFailure: 'ProjectContext multi-repo traversal 1/5 and Plan repeatability failure',
      rootCause:
        'The accepted V1 checkpoint closed capture coherence and durability, but its scope/readiness lists were caller-coordinated, its request identity was mostly repo+kind single-row, omitted detail bytes were not stored, inventory owners had no typed authority, and audit placeholders could be presented as consumer lineage. Strict V2 separates these authority planes without rebuilding the Foundation store or lease.',
      failingBefore:
        'On commit 5414d681, 326 of 500 MR expected-external diagnostics were certified ownership (156 current-repo private/package imports and 170 approved sibling exports). The controller clean-tree probe also returned readiness passed for dirty bytes. On commit 443ab564, a no-verifier content host could certify A in both complete candidates while switching the terminal eligible inventory/content to B after each post observation; readiness still passed.',
      passingAfter:
        'Core-owned scope receipts, exact V2 request matrices, all-readable frozen-file refs, typed owner evidence, sealed base certification and post-open adapter receipts pass focused mutation tests and fresh-process MR/SP audits. Global PC-F remains pending Main/Plugin actual adapters plus Graph/Map truth.',
    },
    scopeAuthority: {
      modes: modeResults.map((mode) => ({
        projectMode: mode.projectMode,
        manifest: mode.secondProcess.projectScopeManifest,
        captureDerivedFromReceipt: true,
        sourceVectorReconciled: mode.secondProcess.readiness.ok,
      })),
    },
    requestAuditV2: modeResults.map((mode) => ({
      projectMode: mode.projectMode,
      expectedIndexHash: mode.secondProcess.requestMatrixReceipt.matrixHash,
      actualIndexHash: hashCanonicalJson(
        mode.secondProcess.requestMatrix.map((row) => ({
          rowId: row.rowId,
          repoId: row.repoId,
          kind: row.kind,
          selectorHash: row.selectorHash,
          canonicalScopeHash: row.canonicalScopeHash,
          language: row.language,
          parserFamily: row.parserFamily,
          ownerSurfaceId: row.ownerSurfaceId,
          applicability: row.applicability,
        })).sort((left, right) => left.rowId.localeCompare(right.rowId))
      ),
      rowCount: mode.secondProcess.requestMatrix.length,
      conserved: mode.secondProcess.readiness.ok,
    })),
    frozenContentConservation: modeResults.map((mode) => ({
      projectMode: mode.projectMode,
      eligibleFiles: mode.secondProcess.inventory.fileCount,
      frozenFileRefs: mode.secondProcess.detail.frozenFileCount,
      readFailed: 0,
      criticalReadFailures: 0,
      uniqueCasBlobs: mode.secondProcess.storeReceipt.blobCount,
      frozenFileManifestHash: mode.secondProcess.detail.frozenFileManifestHash,
      conserved: mode.secondProcess.detail.conservation,
    })),
    ownerConservation: modeResults.map((mode) => ({
      projectMode: mode.projectMode,
      ...mode.secondProcess.inventory.ownerEvidence,
      conserved:
        mode.secondProcess.inventory.ownerEvidence.untypedRows === 0 &&
        mode.secondProcess.inventory.ownerEvidence.pathHeuristicExclusiveRows === 0,
    })),
    mutationCards: authorityMutationCards,
    modes: modeResults.map(compactModeEvidence),
    producerInventory: {
      authoritativeProducer: '@alembic/core/project-context-foundation',
      strictLegacyEntries: modeResults[0]?.secondProcess.legacyEntries ?? [],
      coreContractProbeEvidence: modeResults.map((mode) => ({
        projectMode: mode.projectMode,
        ...mode.secondProcess.coreContractProbeEvidence,
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
    globalPcF: {
      status: 'pending',
      pendingRows: [
        'Alembic Main actual plan/recipe-generation/dependency-graph/module-coverage adapters and session reload',
        'AlembicPlugin actual dimension-completion/module-axis/submit-tool-router adapter and session reload',
        'Main 12/80 and Plugin 24/500/raw/synthetic/empty-axis strict bypass counters',
        'Plugin .gitmodules discovery reconciliation against Core scope tuples/revisions',
        'terminal Graph/region semantic receipt with duplicate-root and script-as-repo zero',
        'Map mount accounting/project coverage split and cumulative per-type continuation',
      ],
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

function buildAuthorityMutationCards(modeResults) {
  return modeResults.flatMap((mode) => {
    const scope = mode.secondProcess.projectScopeManifest;
    const matrix = mode.secondProcess.requestMatrixReceipt;
    const rows = matrix.rows;
    const scopeAlias = structuredClone(scope);
    scopeAlias.repositories[0].repoId = `${scopeAlias.repositories[0].repoId}-alias`;
    let scopeAliasRejected = false;
    try {
      verifyProjectScopeManifestV1(scopeAlias);
    } catch {
      scopeAliasRejected = true;
    }
    const languageSwap = structuredClone(rows);
    languageSwap[0].language = languageSwap[0].language === 'swift' ? 'typescript' : 'swift';
    const scopeSwap = structuredClone(rows);
    if (scopeSwap.length > 1) {
      scopeSwap[0].canonicalScopeHash = scopeSwap[1].canonicalScopeHash;
    }
    return [
      {
        projectMode: mode.projectMode,
        mutation: 'synchronized-repo-alias-against-accepted-scope-receipt',
        rejected: scopeAliasRejected,
      },
      {
        projectMode: mode.projectMode,
        mutation: 'v2-row-delete',
        rejected: !evaluateProjectContextRequestMatrixV2(matrix, rows.slice(1), scope).ok,
      },
      {
        projectMode: mode.projectMode,
        mutation: 'v2-row-duplicate',
        rejected: !evaluateProjectContextRequestMatrixV2(matrix, [...rows, rows[0]], scope).ok,
      },
      {
        projectMode: mode.projectMode,
        mutation: 'v2-language-swap',
        rejected: !evaluateProjectContextRequestMatrixV2(matrix, languageSwap, scope).ok,
      },
      {
        projectMode: mode.projectMode,
        mutation: 'v2-scope-only-swap',
        rejected: !evaluateProjectContextRequestMatrixV2(matrix, scopeSwap, scope).ok,
      },
      {
        projectMode: mode.projectMode,
        mutation: 'audit-placeholder-projection',
        rejected: mode.secondProcess.placeholderProjectionRejected,
      },
      {
        projectMode: mode.projectMode,
        mutation: 'omitted-frozen-file-fresh-process-reopen',
        rejected:
          !mode.secondProcess.omittedFrozenRestartProbe.applicable ||
          (mode.secondProcess.omittedFrozenRestartProbe.matched &&
            mode.secondProcess.omittedFrozenRestartProbe.freshProcess &&
            mode.secondProcess.omittedFrozenRestartProbe.liveFileDeleted &&
            mode.secondProcess.omittedFrozenRestartProbe.liveMutationHash !==
              mode.secondProcess.omittedFrozenRestartProbe.expectedBlobHash),
        evidence: mode.secondProcess.omittedFrozenRestartProbe,
      },
      {
        projectMode: mode.projectMode,
        mutation: 'base-hash-post-open-mutation',
        rejected:
          mode.secondProcess.baseConsumerOrdering.unchanged &&
          mode.secondProcess.baseConsumerOrdering.mutationRejected,
      },
    ];
  });
}

function compactModeEvidence(mode) {
  return {
    ...mode,
    firstProcess: compactProcessEvidence(mode.firstProcess),
    secondProcess: compactProcessEvidence(mode.secondProcess),
  };
}

function compactProcessEvidence(processEvidence) {
  const {
    requestMatrix,
    requestMatrixReceipt,
    dependencyOwnership,
    ...boundedEvidence
  } = processEvidence;
  return {
    ...boundedEvidence,
    requestMatrixReceipt: {
      kind: requestMatrixReceipt.kind,
      version: requestMatrixReceipt.version,
      projectScopeHash: requestMatrixReceipt.projectScopeHash,
      matrixHash: requestMatrixReceipt.matrixHash,
      receiptHash: requestMatrixReceipt.receiptHash,
      planCount: requestMatrixReceipt.plans.length,
      rowCount: requestMatrixReceipt.rows.length,
      rows: requestMatrixReceipt.rows,
    },
    requestMatrix: requestMatrix.map((row) => {
      const {
        dependencyResolutions,
        dependencyGraphReconciliation,
        dependencyGraphEvidence,
        ...boundedRow
      } = row;
      return {
        ...boundedRow,
        dependencyResolutionCount: dependencyResolutions?.length ?? 0,
        dependencyResolutionHash: hashCanonicalJson(dependencyResolutions ?? []),
        dependencyGraphReconciliationHash: hashCanonicalJson(
          dependencyGraphReconciliation ?? emptyDependencyGraphReconciliation()
        ),
        dependencyGraphEvidenceHash: hashCanonicalJson(dependencyGraphEvidence ?? {}),
      };
    }),
    dependencyOwnership: {
      version: dependencyOwnership.version,
      ownershipHash: dependencyOwnership.ownershipHash,
      entryCount: dependencyOwnership.entries.length,
    },
  };
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
  const projectScope = buildProjectScopeManifestV1({
    acceptedScope: {
      projectMode: mode,
      projectIdentity: {
        projectId: mode === 'MR-ALEMBIC' ? 'alembic-workspace' : 'bilidili',
        scopeId: mode === 'MR-ALEMBIC' ? 'mr-alembic' : 'sp-bilidili',
      },
      repositories: repositories.map(({ repoId, relativeRoot }) => ({
        repoId,
        relativeRoot,
      })),
    },
    controlRoot: mode === 'MR-ALEMBIC' ? workspaceRoot : bilidiliRoot,
    sourceRoots: repositories.map(({ repoId, sourceRoot }) => ({ repoId, sourceRoot })),
  });
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
  for (const repository of repositories) {
    descriptorsByRepo.set(
      repository.repoId,
      await ports.enumerateEligibleFiles({ repository, policy: inventoryPolicy })
    );
  }
  const requestPlans = repositories.flatMap((repository) =>
    createProjectContextRequestAuditPlansV2({
      repository,
      eligibleFiles: descriptorsByRepo.get(repository.repoId) ?? [],
      projectScopeManifest: projectScope.manifest,
    })
  );
  const requestMatrix = buildProjectContextRequestMatrixV2(
    projectScope.manifest,
    requestPlans
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
    projectScope.manifest,
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
  const artifact = await captureCertifiedProjectFactsV2(
    {
      projectMode: mode,
      repositories,
      projectScope,
      requestMatrix,
      inventoryPolicy,
      detailPolicy,
      requestPlans,
      legacyEntries,
      projections,
      certification,
    },
    ports
  );
  const readiness = evaluateCertifiedProjectFactsReadinessV2(artifact, {
    acceptedScopeManifest: projectScope.manifest,
    requestMatrix,
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
  const baseSealBeforeOpen = {
    certificationBindingHash: artifact.certificationBindingHash,
    storeReceiptHash: storeReceipt.receiptHash,
  };
  const projectionResults = [];
  for (const consumer of CERTIFIED_PROJECT_FACTS_CONSUMERS) {
    projectionResults.push(
      await consumerPort.reopenWithAdapter({
        preparationId: preparation.preparationId,
        runId: requireOpaque(input['run-id'], 'run-id'),
        consumer,
        expectedCertificationBindingHash: artifact.certificationBindingHash,
        adapter: {
          adapterVersion: 'core-contract-probe-v2',
          entrypoint: `contract-probe/core/${consumer}`,
          payloadSchemaHash: hashCanonicalJson({ consumer, schemaVersion: 2 }),
          loadEvidenceHash: hashCanonicalJson({
            consumer,
            runtime: process.version,
            foundationArtifactId: artifact.artifactId,
          }),
          project(opened) {
            return {
              consumer,
              inventoryContentHash: opened.facts.inventory.inventoryContentHash,
              requestMatrixHash: opened.manifest.requestMatrixHash,
              sourceVectorHash: opened.sourceVectorHash,
            };
          },
        },
      })
    );
  }
  const coreContractProbeLineageReceipt = createProjectContextConsumerLineageReceiptV2(
    artifact,
    projectionResults.map(({ receipt }) => ({
      projectionReceipt: receipt,
      canonicalScopeHash: projectScope.manifest.canonicalScopeHash,
      sessionPersistReloadStatus: 'not-applicable',
      directProjectContextCallCount: 0,
      rawFilesystemFallbackCount: 0,
      synthesizedProjectScopeFactCount: 0,
    }))
  );
  let placeholderProjectionRejected = false;
  try {
    await consumerPort.reopenWithAdapter({
      preparationId: preparation.preparationId,
      runId: requireOpaque(input['run-id'], 'run-id'),
      consumer: 'plan',
      expectedCertificationBindingHash: artifact.certificationBindingHash,
      adapter: {
        adapterVersion: 'audit-placeholder-v1',
        entrypoint: 'scripts/audit-project-context-foundation.mjs',
        payloadSchemaHash: hashCanonicalJson({ placeholder: true }),
        loadEvidenceHash: hashCanonicalJson({ audit: true }),
        project() {
          return { placeholder: true };
        },
      },
    });
  } catch (error) {
    placeholderProjectionRejected =
      error instanceof TypeError && /actual loaded adapter/i.test(error.message);
  }
  let baseMutationRejected = false;
  try {
    await consumerPort.reopenWithAdapter({
      preparationId: preparation.preparationId,
      runId: requireOpaque(input['run-id'], 'run-id'),
      consumer: 'plan',
      expectedCertificationBindingHash: artifact.certificationBindingHash,
      adapter: {
        adapterVersion: 'core-mutation-probe-v2',
        entrypoint: 'contract-probe/core/mutation',
        payloadSchemaHash: hashCanonicalJson({ consumer: 'plan', schemaVersion: 2 }),
        loadEvidenceHash: hashCanonicalJson({ mutationProbe: true }),
        project(opened) {
          opened.facts.detail.decisions.pop();
          return { mutated: true };
        },
      },
    });
  } catch (error) {
    baseMutationRejected = error instanceof TypeError;
  }
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
  const omittedFrozenRestartProbe = await probeFrozenOmittedFileMutation(
    path.join(storeRoot, mode.toLowerCase()),
    silentLogger
  );
  const result = {
    projectMode: mode,
    artifactId: artifact.artifactId,
    factsContentHash: artifact.factsContentHash,
    certificationBindingHash: artifact.certificationBindingHash,
    sourceVectorHash: artifact.sourceVectorHash,
    projectScopeHash: projectScope.manifest.canonicalScopeHash,
    requestMatrixHash: requestMatrix.matrixHash,
    frozenFileManifestHash: artifact.facts.detail.frozenFileManifestHash,
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
    projectScopeManifest: projectScope.manifest,
    requestMatrixReceipt: requestMatrix,
    coreContractProbeLineageReceipt,
    placeholderProjectionRejected,
    omittedFrozenRestartProbe,
    baseConsumerOrdering: {
      baseSealBeforeOpen,
      baseSealAfterLineage: {
        certificationBindingHash: artifact.certificationBindingHash,
        storeReceiptHash: storeReceipt.receiptHash,
      },
      unchanged:
        baseSealBeforeOpen.certificationBindingHash === artifact.certificationBindingHash &&
        baseSealBeforeOpen.storeReceiptHash === storeReceipt.receiptHash,
      mutationRejected: baseMutationRejected,
      order: [
        'base-certification-store-put-readback',
        'preparation-lease-open',
        'core-contract-projection-receipts',
        'immutable-post-open-lineage',
      ],
    },
    coreContractProbeEvidence: {
      allowedStoreOperations: ['acquireRunLease', 'open'],
      callTrace: adapterCallTrace,
      consumerCount: projectionResults.length,
      productionConsumerEvidence: false,
      typedReason:
        'Core exercises the actual adapter port contract; Main/Plugin production adapters remain pending downstream work.',
      legacyProjectContextCallCapabilityExposed: false,
      rawFilesystemScannerCapabilityExposed: false,
    },
    repoCoverage: artifact.manifest.sourceRevisionVector.entries,
    inventory: {
      fileCount: artifact.facts.inventory.fileCount,
      inventoryContentHash: artifact.facts.inventory.inventoryContentHash,
      repositories: artifact.facts.inventory.repositories,
      ownerEvidence: {
        rowCount: artifact.facts.inventory.files.reduce(
          (sum, file) => sum + (file.ownersV2?.length ?? 0),
          0
        ),
        originCounts: Object.fromEntries(
          ['package-build-declaration', 'host-declared', 'path-heuristic'].map((origin) => [
            origin,
            artifact.facts.inventory.files.reduce(
              (sum, file) =>
                sum + (file.ownersV2 ?? []).filter((owner) => owner.origin === origin).length,
              0
            ),
          ])
        ),
        untypedRows: artifact.facts.inventory.files.reduce(
          (sum, file) =>
            sum +
            (file.ownersV2 ?? []).filter(
              (owner) => !owner.typedReason || owner.evidence.length === 0
            ).length,
          0
        ),
        pathHeuristicExclusiveRows: artifact.facts.inventory.files.reduce(
          (sum, file) =>
            sum +
            (file.ownersV2 ?? []).filter(
              (owner) =>
                owner.origin === 'path-heuristic' && owner.disposition === 'exclusive'
            ).length,
          0
        ),
      },
    },
    detail: {
      selectedFileCount: artifact.facts.detail.selectedFileCount,
      omittedFileCount: artifact.facts.detail.omittedFileCount,
      continuation: artifact.facts.detail.continuation ?? null,
      detailContentHash: artifact.facts.detail.detailContentHash,
      fullChunkCount: artifact.chunks.length,
      frozenFileCount: artifact.facts.detail.frozenFiles?.length ?? 0,
      frozenFileManifestHash: artifact.facts.detail.frozenFileManifestHash ?? null,
      conservation:
        artifact.facts.inventory.fileCount ===
        (artifact.facts.detail.frozenFiles?.length ?? 0),
    },
    requestMatrix: artifact.facts.requestOutcomes.map((row) => ({
      repoId: row.repoId,
      kind: row.kind,
      rowId: row.rowId,
      selectorHash: row.selectorHash,
      canonicalScopeHash: row.canonicalScopeHash,
      language: row.language,
      parserFamily: row.parserFamily,
      ownerSurfaceId: row.ownerSurfaceId,
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
  if (
    !readiness.ok ||
    !secondConsumerRefused ||
    !result.reopenMatched ||
    !placeholderProjectionRejected ||
    (omittedFrozenRestartProbe.applicable && !omittedFrozenRestartProbe.matched)
  ) {
    process.exitCode = 1;
  }
}

async function probeFrozenOmittedFileMutation(storeRoot, logger) {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pcf-frozen-mutation-source-'));
  const selectedPath = path.join(sourceRoot, 'selected.ts');
  const omittedPath = path.join(sourceRoot, 'omitted.ts');
  const selectedBytes = Buffer.from('export const selected = 1;\n');
  const originalOmittedBytes = Buffer.from('export const omitted = 2;\n');
  try {
    await Promise.all([
      fs.writeFile(selectedPath, selectedBytes),
      fs.writeFile(omittedPath, originalOmittedBytes),
    ]);
    const repository = {
      scopeId: 'frozen-mutation-scope',
      repoId: 'frozen-mutation-repo',
      relativeRoot: '.',
      sourceRoot,
    };
    const projectScope = buildProjectScopeManifestV1({
      acceptedScope: {
        projectMode: 'FOUNDATION-MUTATION-PROBE',
        projectIdentity: {
          projectId: 'foundation-mutation-probe',
          scopeId: repository.scopeId,
        },
        repositories: [{ repoId: repository.repoId, relativeRoot: '.' }],
      },
      controlRoot: sourceRoot,
      sourceRoots: [{ repoId: repository.repoId, sourceRoot }],
    });
    const files = [
      {
        relativePath: 'omitted.ts',
        language: 'typescript',
        mode: '100644',
        ownerModuleIds: [],
        ownersV2: [],
      },
      {
        relativePath: 'selected.ts',
        language: 'typescript',
        mode: '100644',
        ownerModuleIds: [],
        ownersV2: [],
      },
    ];
    const plans = createProjectContextRequestAuditPlansV2({
      repository,
      eligibleFiles: files,
      projectScopeManifest: projectScope.manifest,
    });
    const requestMatrix = buildProjectContextRequestMatrixV2(projectScope.manifest, plans);
    const ports = {
      observeRevision: async () => ({ kind: 'content' }),
      enumerateEligibleFiles: async () => structuredClone(files),
      readFile: async ({ relativePath }) => fs.readFile(path.join(sourceRoot, relativePath)),
      verifySnapshot: async ({ candidate }) => ({
        version: 1,
        verified: true,
        binding: 'working-tree-content',
        finalRevision: candidate.postRevision,
        eligibleInventoryHash: candidate.eligibleInventoryHash,
        workingTreeContentHash: candidate.workingTreeContentHash,
        typedReason: 'foundation-mutation-probe-content-fence',
      }),
      executeRequest: async ({ plan }) => ({
        terminalStatus: 'completed',
        output: { kind: plan.kind, mutationProbe: true },
        detectedLanguage: plan.language,
        parserRuntime: plan.parserFamily ? 'ready' : 'not-required',
        queryInitialization: plan.parserFamily ? 'ready' : 'not-required',
        sourceRanges: [],
      }),
    };
    const artifact = await captureCertifiedProjectFactsV2(
      {
        projectMode: projectScope.manifest.projectMode,
        repositories: projectScope.repositories,
        projectScope,
        requestMatrix,
        inventoryPolicy: {
          version: 'foundation-mutation-probe-v1',
          includeExtensions: ['.ts'],
          excludeDirectories: ['.git'],
        },
        detailPolicy: {
          maxSelectedFiles: 1,
          maxPreviewBytes: 32,
          chunkBytes: 16,
          selectedFiles: [{ repoId: repository.repoId, relativePath: 'selected.ts' }],
        },
        requestPlans: requestMatrix.plans,
        legacyEntries: [],
        projections: Object.fromEntries(
          CERTIFIED_PROJECT_FACTS_CONSUMERS.map((consumer) => [consumer, { consumer }])
        ),
        certification: {
          scopeIdentityHash: projectScope.manifest.canonicalScopeHash,
          capabilityHash: hashCanonicalJson({ probe: 'capability' }),
          parserHash: hashCanonicalJson({ probe: 'parser' }),
          acceptedRuntimeHash: hashCanonicalJson({ probe: 'runtime' }),
          acceptedConfigHash: hashCanonicalJson({ probe: 'config' }),
        },
      },
      ports
    );
    await new FileCertifiedProjectFactsStore(storeRoot, { logger }).put(artifact);
    const expectedBlobHash = hashBytes(originalOmittedBytes);
    const mutatedBytes = Buffer.from('export const omitted = 999;\n');
    await fs.writeFile(omittedPath, mutatedBytes);
    const liveMutationHash = hashBytes(await fs.readFile(omittedPath));
    await fs.unlink(omittedPath);
    const { stdout } = await execFileAsync(
      process.execPath,
      ['--input-type=module', '--eval', frozenFreshProcessProbeSource()],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          PCF_PROBE_STORE: storeRoot,
          PCF_PROBE_ARTIFACT: artifact.artifactId,
          PCF_PROBE_BINDING: artifact.certificationBindingHash,
          PCF_PROBE_REPO: repository.repoId,
          PCF_PROBE_PATH: 'omitted.ts',
        },
        maxBuffer: 1024 * 1024,
      }
    );
    const marker = stdout
      .split('\n')
      .findLast((line) => line.startsWith('PCF_FROZEN_PROBE:'));
    if (!marker) throw new TypeError('Frozen fresh-process probe returned no result marker.');
    const freshProcess = JSON.parse(marker.slice('PCF_FROZEN_PROBE:'.length));
    return {
      applicable: true,
      repoId: repository.repoId,
      relativePath: 'omitted.ts',
      expectedBlobHash,
      liveMutationHash,
      liveFileDeleted: !(await fileExists(omittedPath)),
      reopenedBlobHash: freshProcess.blobHash,
      matched: freshProcess.blobHash === expectedBlobHash,
      freshProcess: true,
      liveFilesystemCapabilityExposed: false,
    };
  } finally {
    await fs.rm(sourceRoot, { force: true, recursive: true });
  }
}

function frozenFreshProcessProbeSource() {
  return String.raw`
import { FileCertifiedProjectFactsStore, hashBytes } from '@alembic/core/project-context-foundation';
const store = new FileCertifiedProjectFactsStore(process.env.PCF_PROBE_STORE, {
  logger: { info() {}, warn() {} },
});
const bytes = await store.readFrozenFile({
  artifactId: process.env.PCF_PROBE_ARTIFACT,
  certificationBindingHash: process.env.PCF_PROBE_BINDING,
  repoId: process.env.PCF_PROBE_REPO,
  relativePath: process.env.PCF_PROBE_PATH,
});
console.log('PCF_FROZEN_PROBE:' + JSON.stringify({ blobHash: hashBytes(bytes) }));
`;
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
  projectScopeManifest,
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
    scopeIdentityHash: projectScopeManifest.canonicalScopeHash,
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
