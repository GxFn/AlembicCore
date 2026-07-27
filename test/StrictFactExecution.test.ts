import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertCodeFactGenerationManifestV1,
  createAstFactQueryBackendV1,
  createAstFactQueryFamilyV1,
  createConfigFactQueryBackendV1,
  createConfigFactQueryFamilyV1,
  createProjectContextFactQueryBackendV1,
  createProjectContextFactQueryFamilyV1,
  createStrictAstFactQueryPackV1,
  createStrictEvidenceLedgerSnapshotV1,
  createStrictFactBackendRegistryV1,
  createStrictFactDirectWitnessBindingV1,
  createStrictFactSubjectBindingV1,
  createStrictFactWitnessAuthorityV1,
  executeStrictFactScheduleV1,
  type StrictFactQueryBackendV1,
} from '../src/host-agent-workflows.js';
import {
  buildFactQueryCatalogSnapshot,
  type CertifiedPlanningFactsV1,
  type FactHarvestObligationV1,
  type FactQueryFamilyV1,
  type MiningWorkScheduleV1,
} from '../src/plans.js';
import {
  buildProjectContextRequestMatrixV2,
  buildProjectScopeManifestV1,
  CERTIFIED_PROJECT_FACTS_CONSUMERS,
  captureCertifiedProjectFactsV2,
  createProjectContextRequestAuditPlansV2,
  hashBytes,
  hashCanonicalJson,
  type ProjectContextFoundationCaptureInputV2,
  type ProjectContextFoundationFileDescriptor,
  type ProjectContextFoundationHostPorts,
} from '../src/projectContextFoundation.js';
import { readCertifiedProjectFactsFrozenFile } from '../src/service/project-context/foundation/frozen.js';
import { createProjectContextFileRef } from '../src/service/project-context/shared/sourceSlice-fileSymbols/contracts.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

describe('strict frozen-fact execution', () => {
  it('accepts direct witnesses only when full-file and declared range content match frozen bytes', async () => {
    const artifact = await createStrictArtifact([
      {
        language: 'typescript',
        relativePath: 'src/index.ts',
        content: 'export const alpha = 1;\nexport const beta = 2;\nexport const gamma = 3;\n',
      },
    ]);
    const file = artifact.facts.inventory.files[0]!;
    const frozenContent = Buffer.from(readCertifiedProjectFactsFrozenFile(artifact, file)).toString(
      'utf8'
    );

    const fullFile = createDirectWitnessInput(artifact, {
      content: frozenContent,
    });
    const fullFileWithDeclaredRange = createDirectWitnessInput(artifact, {
      content: frozenContent,
      range: { start: 1, end: 4 },
    });
    const ranged = createDirectWitnessInput(artifact, {
      content: 'export const beta = 2;',
      range: { start: 2, end: 2 },
    });

    expect(() => createStrictFactDirectWitnessBindingV1(fullFile)).not.toThrow();
    expect(() => createStrictFactDirectWitnessBindingV1(fullFileWithDeclaredRange)).not.toThrow();
    expect(() => createStrictFactDirectWitnessBindingV1(ranged)).not.toThrow();
  });

  it('rejects a self-consistent forged full-file direct witness', async () => {
    const artifact = await createStrictArtifact([
      {
        language: 'typescript',
        relativePath: 'src/index.ts',
        content: 'export const accepted = 1;\n',
      },
    ]);
    const forged = createDirectWitnessInput(artifact, {
      content: 'export const forged = 1;\n',
    });

    expect(() => createStrictFactDirectWitnessBindingV1(forged)).toThrow(
      'STRICT_FACT_WITNESS_AUTHORITY_INVALID'
    );
  });

  it('rejects direct witness content that is misaligned with its declared frozen line range', async () => {
    const artifact = await createStrictArtifact([
      {
        language: 'typescript',
        relativePath: 'src/index.ts',
        content: 'export const alpha = 1;\nexport const beta = 2;\nexport const gamma = 3;\n',
      },
    ]);
    const misaligned = createDirectWitnessInput(artifact, {
      content: 'export const gamma = 3;',
      range: { start: 2, end: 2 },
    });

    expect(() => createStrictFactDirectWitnessBindingV1(misaligned)).toThrow(
      'STRICT_FACT_WITNESS_AUTHORITY_INVALID'
    );
  });

  it('executes a real AST backend over every frozen subject file and binds direct witnesses', async () => {
    const artifact = await createStrictArtifact();
    const family = factFamily();
    const result = await executeStrictFactScheduleV1({
      artifact,
      planningFacts: planningFacts(artifact),
      catalog: buildFactQueryCatalogSnapshot([family]),
      schedule: scheduleFor(family),
      subjectBindings: subjectBindings(artifact),
      witnessBindings: witnessBindings(artifact),
      witnessAuthority: witnessAuthority(artifact),
      registry: createStrictFactBackendRegistryV1([
        createAstFactQueryBackendV1({ family, queryPack: AST_QUERY_PACK }),
      ]),
    });

    expect(() => assertCodeFactGenerationManifestV1(result)).not.toThrow();
    expect(result.manifest.verdict).toBe('passed');
    expect(result.manifest.factCount).toBe(2);
    expect(result.receipts).toEqual([
      expect.objectContaining({
        disposition: 'matched',
        expectedFileCount: 2,
        inspectedFileCount: 2,
        continuation: null,
        truncated: false,
        outputHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }),
    ]);
    expect(result.facts).toHaveLength(2);
    const acceptedProjectContextRefIds = witnessBindings(artifact)
      .map((binding) => binding.projectContextRef.id)
      .sort();
    expect(result.facts.map((fact) => fact.canonicalSubjectRef).sort()).toEqual(
      acceptedProjectContextRefIds
    );
    expect(result.facts.every((fact) => fact.primaryScale === 'file')).toBe(true);
    expect(
      result.facts.every(
        (fact) =>
          fact.witnesses[0]?.kind === 'direct' &&
          fact.witnesses[0].projectContextRefId === fact.canonicalSubjectRef &&
          fact.witnesses[0].projectContextRefHash ===
            witnessBindings(artifact).find(
              (binding) => binding.projectContextRef.id === fact.canonicalSubjectRef
            )?.projectContextRefHash
      )
    ).toBe(true);
    expect(
      result.facts
        .map((fact) => ({
          path: fact.witnesses[0]?.kind === 'direct' ? fact.witnesses[0].anchor.relativePath : null,
          revision: fact.sourceRevisionVectorHash,
        }))
        .sort((left, right) => String(left.path).localeCompare(String(right.path)))
    ).toEqual([
      { path: 'src/index.ts', revision: artifact.sourceVectorHash },
      { path: 'src/worker.ts', revision: artifact.sourceVectorHash },
    ]);
  });

  it('fails closed when the loaded catalog family has no executable backend', async () => {
    const artifact = await createStrictArtifact();
    const family = factFamily();
    const result = await executeStrictFactScheduleV1({
      artifact,
      planningFacts: planningFacts(artifact),
      catalog: buildFactQueryCatalogSnapshot([family]),
      schedule: scheduleFor(family),
      subjectBindings: subjectBindings(artifact),
      witnessBindings: witnessBindings(artifact),
      witnessAuthority: witnessAuthority(artifact),
      registry: createStrictFactBackendRegistryV1([]),
    });

    expect(result.facts).toEqual([]);
    expect(result.manifest.verdict).toBe('failed');
    expect(result.receipts[0]).toMatchObject({
      disposition: 'failed',
      expectedFileCount: 2,
      inspectedFileCount: 0,
      reasonCode: 'FACT_QUERY_BACKEND_UNAVAILABLE',
      truncated: false,
    });
  });

  it('inspects the complete denominator and discards partial facts after a backend failure', async () => {
    const artifact = await createStrictArtifact();
    const family = factFamily();
    const result = await executeStrictFactScheduleV1({
      artifact,
      planningFacts: planningFacts(artifact),
      catalog: buildFactQueryCatalogSnapshot([family]),
      schedule: scheduleFor(family),
      subjectBindings: subjectBindings(artifact),
      witnessBindings: witnessBindings(artifact).slice(0, 1),
      witnessAuthority: witnessAuthority(artifact),
      registry: createStrictFactBackendRegistryV1([
        createAstFactQueryBackendV1({ family, queryPack: AST_QUERY_PACK }),
      ]),
    });

    expect(result.receipts[0]?.fileExecutions.map((row) => row.relativePath)).toEqual([
      'src/index.ts',
      'src/worker.ts',
    ]);
    expect(result.facts).toEqual([]);
    expect(result.receipts[0]).toMatchObject({
      disposition: 'failed',
      expectedFileCount: 2,
      inspectedFileCount: 2,
      reasonCode: 'FACT_WITNESS_BINDING_UNAVAILABLE',
      truncated: false,
    });
    expect(result.receipts[0]?.fileExecutions[0]).toMatchObject({
      stagedFactIds: expect.any(Array),
      emittedFactIds: [],
      discardedFactIds: expect.any(Array),
    });
  });

  it('fails closed when the Evidence Ledger or ProjectContext authority cannot resolve a witness', async () => {
    const artifact = await createStrictArtifact();
    const family = factFamily();
    const result = await executeStrictFactScheduleV1({
      artifact,
      planningFacts: planningFacts(artifact),
      catalog: buildFactQueryCatalogSnapshot([family]),
      schedule: scheduleFor(family),
      subjectBindings: subjectBindings(artifact),
      witnessBindings: witnessBindings(artifact),
      witnessAuthority: witnessAuthority(artifact, 1),
      registry: createStrictFactBackendRegistryV1([
        createAstFactQueryBackendV1({ family, queryPack: AST_QUERY_PACK }),
      ]),
    });

    expect(result.facts).toEqual([]);
    expect(result.manifest.verdict).toBe('failed');
    expect(result.receipts[0]).toMatchObject({
      disposition: 'failed',
      reasonCode: 'FACT_WITNESS_AUTHORITY_UNRESOLVED',
      inspectedFileCount: 2,
    });
  });

  it('executes certified ProjectContext outcomes through the closed backend registry', async () => {
    const artifact = await createStrictArtifact([
      {
        language: 'typescript',
        relativePath: 'src/index.ts',
        content: 'export const alpha = 1;\n',
      },
    ]);
    const family = createProjectContextFactQueryFamilyV1({
      familyId: 'module-dependency',
      supportedScales: ['file'],
    });
    const result = await executeStrictFactScheduleV1({
      artifact,
      planningFacts: planningFacts(artifact),
      catalog: buildFactQueryCatalogSnapshot([family]),
      schedule: scheduleFor(family),
      subjectBindings: subjectBindings(artifact),
      witnessBindings: witnessBindings(artifact),
      witnessAuthority: witnessAuthority(artifact),
      registry: createStrictFactBackendRegistryV1([
        createProjectContextFactQueryBackendV1({
          family,
        }),
      ]),
    });

    expect(result.manifest.verdict).toBe('passed');
    expect(result.facts.length).toBeGreaterThanOrEqual(1);
    expect(result.facts.every((fact) => fact.witnesses[0]?.kind === 'direct')).toBe(true);
  });

  it('executes the existing strict config parser over a frozen project.json', async () => {
    const artifact = await createStrictArtifact([
      {
        content: '{"name":"core","sourceRoot":"src","projectType":"library","targets":{}}',
        language: 'json',
        relativePath: 'project.json',
      },
    ]);
    const family = createConfigFactQueryFamilyV1({
      familyId: 'config-declaration',
      supportedScales: ['file'],
      parser: 'nx-project-json',
    });
    const result = await executeStrictFactScheduleV1({
      artifact,
      planningFacts: planningFacts(artifact),
      catalog: buildFactQueryCatalogSnapshot([family]),
      schedule: scheduleFor(family),
      subjectBindings: subjectBindings(artifact),
      witnessBindings: witnessBindings(artifact),
      witnessAuthority: witnessAuthority(artifact),
      registry: createStrictFactBackendRegistryV1([
        createConfigFactQueryBackendV1({
          family,
          parser: 'nx-project-json',
        }),
      ]),
    });

    expect(result.manifest.verdict).toBe('passed');
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.value).toMatchObject({
      backend: 'strict-config-fact-backend-v1',
      parser: 'nx-project-json',
    });
  });

  it('turns a real config parser exception into a terminal failed receipt', async () => {
    const artifact = await createStrictArtifact([
      { content: '{"name":', language: 'json', relativePath: 'project.json' },
    ]);
    const family = createConfigFactQueryFamilyV1({
      familyId: 'config-declaration',
      supportedScales: ['file'],
      parser: 'nx-project-json',
    });
    const result = await executeStrictFactScheduleV1({
      artifact,
      planningFacts: planningFacts(artifact),
      catalog: buildFactQueryCatalogSnapshot([family]),
      schedule: scheduleFor(family),
      subjectBindings: subjectBindings(artifact),
      witnessBindings: witnessBindings(artifact),
      witnessAuthority: witnessAuthority(artifact),
      registry: createStrictFactBackendRegistryV1([
        createConfigFactQueryBackendV1({
          family,
          parser: 'nx-project-json',
        }),
      ]),
    });

    expect(result.facts).toEqual([]);
    expect(result.manifest.verdict).toBe('failed');
    expect(result.receipts[0]).toMatchObject({
      disposition: 'failed',
      expectedFileCount: 1,
      inspectedFileCount: 1,
      reasonCode: 'CONFIG_PARSE_FAILED',
    });
  });

  it('emits one derived parent with replayable premises for a higher-scale obligation', async () => {
    const artifact = await createStrictArtifact();
    const family = factFamily({ supportedScales: ['file', 'repository'] });
    const result = await executeStrictFactScheduleV1({
      artifact,
      planningFacts: planningFacts(artifact),
      catalog: buildFactQueryCatalogSnapshot([family]),
      schedule: scheduleForScales(family, ['file', 'repository']),
      subjectBindings: subjectBindings(artifact),
      witnessBindings: witnessBindings(artifact),
      witnessAuthority: witnessAuthority(artifact),
      registry: createStrictFactBackendRegistryV1([
        createAstFactQueryBackendV1({ family, queryPack: AST_QUERY_PACK }),
      ]),
    });

    expect(result.manifest.verdict).toBe('passed');
    expect(result.manifest.harvestCount).toBe(1);
    expect(result.receipts).toHaveLength(2);
    expect(new Set(result.receipts.map((receipt) => receipt.harvestReceiptHash)).size).toBe(1);
    expect(result.facts.filter((fact) => fact.kind === 'direct')).toHaveLength(2);
    expect(result.facts.filter((fact) => fact.kind === 'derived')).toEqual([
      expect.objectContaining({
        premiseFactIds: result.facts
          .filter((fact) => fact.kind === 'direct')
          .map((fact) => fact.factId)
          .sort(),
      }),
    ]);
  });

  it('reports an unsupported AST language as unknown instead of a complete empty match', async () => {
    const artifact = await createStrictArtifact([
      {
        language: 'text',
        relativePath: 'docs/opaque.data',
        content: 'not a supported AST language\n',
      },
    ]);
    const family = factFamily();
    const result = await executeStrictFactScheduleV1({
      artifact,
      planningFacts: planningFacts(artifact),
      catalog: buildFactQueryCatalogSnapshot([family]),
      schedule: scheduleFor(family),
      subjectBindings: subjectBindings(artifact),
      witnessBindings: witnessBindings(artifact),
      witnessAuthority: witnessAuthority(artifact),
      registry: createStrictFactBackendRegistryV1([
        createAstFactQueryBackendV1({ family, queryPack: AST_QUERY_PACK }),
      ]),
    });

    expect(result.manifest.verdict).toBe('failed');
    expect(result.receipts[0]).toMatchObject({
      disposition: 'unknown',
      reasonCode: 'AST_LANGUAGE_UNSUPPORTED',
      expectedFileCount: 1,
      inspectedFileCount: 1,
    });
  });

  it('rejects an empty/misbound subject denominator and a raw self-declared backend', async () => {
    const artifact = await createStrictArtifact();
    const family = factFamily();
    expect(() =>
      createStrictFactSubjectBindingV1({
        artifact,
        planningFacts: planningFacts(artifact),
        selector: { kind: 'repository', repoId: 'missing' },
      })
    ).toThrow('STRICT_FACT_SUBJECT_AUTHORITY_INVALID');
    expect(() =>
      createStrictFactSubjectBindingV1({
        artifact,
        planningFacts: {
          ...planningFacts(artifact),
          sourceRevisionVectorHash: hashCanonicalJson('unaccepted-revision'),
        },
        selector: { kind: 'repository', repoId: 'core' },
      })
    ).toThrow('STRICT_FACT_PLANNING_AUTHORITY_INVALID');

    const rawBackend: StrictFactQueryBackendV1 = {
      ...family,
      executeFile: async ({ file }) => ({
        status: 'complete',
        reasonCode: 'SELF_DECLARED',
        facts: [],
        inspectedBlobHash: file.blobHash,
        truncated: false,
        continuation: null,
      }),
    };
    expect(() => createStrictFactBackendRegistryV1([rawBackend])).toThrow(
      'STRICT_FACT_BACKEND_REGISTRY_INVALID'
    );

    const trustedBackend = createAstFactQueryBackendV1({
      family,
      queryPack: AST_QUERY_PACK,
    });
    const spreadForgedBackend: StrictFactQueryBackendV1 = {
      ...trustedBackend,
      executeFile: rawBackend.executeFile,
    };
    expect(() => createStrictFactBackendRegistryV1([spreadForgedBackend])).toThrow(
      'STRICT_FACT_BACKEND_REGISTRY_INVALID'
    );

    await expect(
      executeStrictFactScheduleV1({
        artifact,
        planningFacts: planningFacts(artifact),
        catalog: buildFactQueryCatalogSnapshot([family]),
        schedule: scheduleFor(family),
        subjectBindings: subjectBindings(artifact),
        witnessBindings: witnessBindings(artifact),
        witnessAuthority: {
          authorityHash: hashCanonicalJson('self-echo'),
          resolveEvidenceEntry: async () => witnessBindings(artifact)[0]?.evidenceEntry ?? null,
          resolveProjectContextRef: async () =>
            witnessBindings(artifact)[0]?.projectContextRef ?? null,
        },
        registry: createStrictFactBackendRegistryV1([trustedBackend]),
      })
    ).rejects.toThrow('STRICT_FACT_EXECUTION_AUTHORITY_DRIFT');
  });
});

const AST_QUERY_PACK = createStrictAstFactQueryPackV1({
  familyId: 'syntax-idiom',
  queryId: 'typescript-declarations',
  queryVersion: '1',
  extractorId: 'declarations-v1',
});

function createDirectWitnessInput(
  artifact: Awaited<ReturnType<typeof createStrictArtifact>>,
  evidence: {
    readonly content: string;
    readonly range?: { readonly start: number; readonly end: number };
  }
) {
  const file = artifact.facts.inventory.files[0]!;
  const evidenceEntry = {
    id: 'E-1',
    sessionId: 'strict-fact-direct-witness-test',
    dimensionId: 'strict-fact-execution',
    tool: 'code.read' as const,
    callId: 'call-1',
    file: file.relativePath,
    ...(evidence.range ? { range: { ...evidence.range } } : {}),
    content: evidence.content,
    contentHash: hashBytes(Buffer.from(evidence.content)),
    capturedAt: 1,
  };
  return {
    artifact,
    repoId: file.repoId,
    relativePath: file.relativePath,
    evidenceEntry,
    evidenceLedgerSnapshot: createStrictEvidenceLedgerSnapshotV1([evidenceEntry]),
    projectContextRef: createProjectContextFileRef({
      projectRoot: '/certified/strict-fact-test',
      repoId: file.repoId,
      filePath: file.relativePath,
      hash: file.blobSha256,
    }),
  };
}

function subjectBindings(artifact: Awaited<ReturnType<typeof createStrictArtifact>>) {
  return [
    createStrictFactSubjectBindingV1({
      artifact,
      planningFacts: planningFacts(artifact),
      selector: { kind: 'repository', repoId: 'core' },
    }),
  ];
}

function witnessMaterial(artifact: Awaited<ReturnType<typeof createStrictArtifact>>) {
  const entries = artifact.facts.inventory.files.map((file, index) => {
    const content = Buffer.from(readCertifiedProjectFactsFrozenFile(artifact, file)).toString(
      'utf8'
    );
    return {
      id: `E-${index + 1}`,
      sessionId: 'strict-fact-test-session',
      dimensionId: 'strict-fact-execution',
      tool: 'code.read' as const,
      callId: `call-${index + 1}`,
      file: file.relativePath,
      content,
      contentHash: hashBytes(Buffer.from(content)),
      capturedAt: index + 1,
    };
  });
  const evidenceLedgerSnapshot = createStrictEvidenceLedgerSnapshotV1(entries);
  const projectContextRefs = artifact.facts.inventory.files.map((file) =>
    createProjectContextFileRef({
      projectRoot: '/certified/strict-fact-test',
      repoId: file.repoId,
      filePath: file.relativePath,
      hash: file.blobSha256,
    })
  );
  const bindings = artifact.facts.inventory.files.map((file, index) =>
    createStrictFactDirectWitnessBindingV1({
      artifact,
      repoId: file.repoId,
      relativePath: file.relativePath,
      evidenceEntry: entries[index]!,
      evidenceLedgerSnapshot,
      projectContextRef: projectContextRefs[index]!,
    })
  );
  return { bindings, entries, evidenceLedgerSnapshot, projectContextRefs };
}

function witnessBindings(artifact: Awaited<ReturnType<typeof createStrictArtifact>>) {
  return witnessMaterial(artifact).bindings;
}

function witnessAuthority(
  artifact: Awaited<ReturnType<typeof createStrictArtifact>>,
  entryLimit?: number
) {
  const material = witnessMaterial(artifact);
  const evidenceLedgerSnapshot =
    entryLimit === undefined
      ? material.evidenceLedgerSnapshot
      : createStrictEvidenceLedgerSnapshotV1(material.entries.slice(0, entryLimit));
  return createStrictFactWitnessAuthorityV1({
    artifact,
    evidenceLedgerSnapshot,
    projectContextRefs: material.projectContextRefs,
  });
}

function planningFacts(
  artifact: Awaited<ReturnType<typeof createStrictArtifact>>
): CertifiedPlanningFactsV1 {
  return {
    schemaVersion: 1,
    factsHash: artifact.factsContentHash,
    sourceRevisionVectorHash: artifact.sourceVectorHash,
    sourceArtifactHash: artifact.certificationBindingHash,
    modules: [
      {
        moduleId: 'core',
        scopeId: 'repo:core',
        relativePath: '.',
        moduleClass: 'production-library',
        ownedProductionFileCount: artifact.facts.inventory.files.length,
        languages: [...new Set(artifact.facts.inventory.files.map((file) => file.language))],
        frameworks: [],
        roles: ['library'],
        entrypointRefs: [],
        publicSurfaceRefs: [],
        crossRepoEdgeRefs: [],
        boundaryRefs: [],
        ownership: {
          origin: 'certified-project-facts',
          confidence: 1,
          evidenceRefs: ['artifact:inventory'],
        },
      },
    ],
  };
}

function factFamily(overrides: Partial<FactQueryFamilyV1> = {}): FactQueryFamilyV1 {
  return createAstFactQueryFamilyV1({
    queryPack: AST_QUERY_PACK,
    supportedScales: overrides.supportedScales ?? ['file'],
  });
}

function scheduleFor(
  family: FactQueryFamilyV1,
  analysisScale: FactHarvestObligationV1['analysisScale'] = 'file'
): MiningWorkScheduleV1 {
  return scheduleForScales(family, [analysisScale]);
}

function scheduleForScales(
  family: FactQueryFamilyV1,
  analysisScales: readonly FactHarvestObligationV1['analysisScale'][]
): MiningWorkScheduleV1 {
  const obligations: FactHarvestObligationV1[] = analysisScales.map((analysisScale) => {
    const semantic = {
      factFamilyId: family.id,
      capabilityId: family.capabilityId,
      canonicalSubjectRef: 'repo:core',
      analysisScale,
      denominator: 'complete-frozen-subject' as const,
    };
    return {
      obligationId: `fact:${hashCanonicalJson(semantic).slice(7, 31)}`,
      ...semantic,
      source: 'required-universe',
    };
  });
  const factHarvestScheduleHash = hashCanonicalJson(obligations);
  const lensBindings: MiningWorkScheduleV1['lensBindings'] = [];
  const lensBindingsHash = hashCanonicalJson(lensBindings);
  return {
    schemaVersion: 1,
    factHarvestObligations: obligations,
    lensBindings,
    factHarvestScheduleHash,
    lensBindingsHash,
    baselineScheduleHash: hashCanonicalJson({ factHarvestScheduleHash, lensBindingsHash }),
  };
}

async function createStrictArtifact(
  sourceFiles: Array<{ relativePath: string; language: string; content: string }> = [
    {
      language: 'typescript',
      relativePath: 'src/index.ts',
      content: 'export class Alpha {}\n',
    },
    {
      language: 'typescript',
      relativePath: 'src/worker.ts',
      content: 'export class Worker {}\n',
    },
  ]
) {
  const controlRoot = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'strict-fact-execution-'))
  );
  roots.push(controlRoot);
  const files: ProjectContextFoundationFileDescriptor[] = sourceFiles.map((file) => ({
    language: file.language,
    mode: '100644',
    ownerModuleIds: [],
    ownersV2: [],
    relativePath: file.relativePath,
  }));
  const contents = new Map(
    sourceFiles.map((file) => [file.relativePath, Buffer.from(file.content)] as const)
  );
  const repository = {
    relativeRoot: '.',
    repoId: 'core',
    scopeId: 'repo:core',
    sourceRoot: controlRoot,
  };
  const projectScope = buildProjectScopeManifestV1({
    acceptedScope: {
      projectIdentity: { projectId: 'strict-fact-project', scopeId: 'repo:core' },
      projectMode: 'SINGLE',
      repositories: [{ relativeRoot: '.', repoId: 'core' }],
    },
    controlRoot,
    sourceRoots: [{ repoId: 'core', sourceRoot: controlRoot }],
  });
  const requestMatrix = buildProjectContextRequestMatrixV2(
    projectScope.manifest,
    createProjectContextRequestAuditPlansV2({
      repository,
      eligibleFiles: files,
      projectScopeManifest: projectScope.manifest,
    })
  );
  const input: ProjectContextFoundationCaptureInputV2 = {
    projectMode: 'SINGLE',
    repositories: [repository],
    inventoryPolicy: {
      excludeDirectories: ['node_modules', '.git'],
      includeExtensions: [...new Set(sourceFiles.map((file) => path.extname(file.relativePath)))],
      version: 'strict-fact-test-policy-v1',
    },
    detailPolicy: {
      chunkBytes: 128,
      maxPreviewBytes: 128,
      maxSelectedFiles: sourceFiles.length,
    },
    requestPlans: requestMatrix.plans,
    legacyEntries: [],
    projections: Object.fromEntries(
      CERTIFIED_PROJECT_FACTS_CONSUMERS.map((consumer) => [consumer, { consumer }])
    ) as ProjectContextFoundationCaptureInputV2['projections'],
    certification: {
      acceptedConfigHash: hashCanonicalJson({ config: 1 }),
      acceptedRuntimeHash: hashCanonicalJson({ runtime: 1 }),
      capabilityHash: hashCanonicalJson({ capability: 1 }),
      parserHash: hashCanonicalJson({ parser: 1 }),
      scopeIdentityHash: projectScope.manifest.canonicalScopeHash,
    },
    projectScope,
    requestMatrix,
  };
  const ports: ProjectContextFoundationHostPorts = {
    enumerateEligibleFiles: async () => files,
    executeRequest: async ({ plan }) => {
      const selector = plan.selector as { filePath?: string };
      return {
        detectedLanguage: selector.filePath ? 'typescript' : undefined,
        output: { kind: plan.kind, selector: plan.selector },
        parserRuntime: selector.filePath ? 'ready' : 'not-required',
        queryInitialization: selector.filePath ? 'ready' : 'not-required',
        sourceRanges: selector.filePath
          ? [
              {
                repoId: plan.repoId,
                relativePath: selector.filePath,
                startLine: 1,
                endLine: 1,
              },
            ]
          : [],
        terminalStatus: 'completed',
      };
    },
    observeRevision: async () => ({
      kind: 'git',
      dirty: false,
      commitId: 'a'.repeat(40),
      treeId: 'b'.repeat(40),
    }),
    readFile: async ({ relativePath }) => {
      const content = contents.get(relativePath);
      if (!content) {
        throw new Error(`Unexpected file read: ${relativePath}`);
      }
      return content;
    },
    verifySnapshot: async ({ candidate }) => ({
      version: 1,
      verified: true,
      binding: 'git-tree',
      finalRevision: candidate.postRevision,
      eligibleInventoryHash: candidate.eligibleInventoryHash,
      workingTreeContentHash: candidate.workingTreeContentHash,
      treeId:
        candidate.postRevision.kind === 'git'
          ? (candidate.postRevision.treeId ?? undefined)
          : undefined,
      typedReason: 'strict-fact-test-snapshot-binding',
    }),
  };
  return captureCertifiedProjectFactsV2(input, ports);
}
