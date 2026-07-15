import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildSourceRevisionVectorV1,
  CERTIFIED_PROJECT_FACTS_CONSUMERS,
  CertifiedProjectFactsConsumerPort,
  captureCertifiedProjectFacts,
  createProjectContextConsumerLineageReceipt,
  deserializeCertifiedProjectFactsArtifact,
  evaluateCertifiedProjectFactsReadiness,
  FileCertifiedProjectFactsStore,
  hashCanonicalJson,
  NodeProjectContextFoundationHostPorts,
  type ProjectContextFoundationCaptureInput,
  type ProjectContextFoundationHostPorts,
  type ProjectContextRequestAuditPlan,
  ProjectFactsLeaseConflictError,
  serializeCertifiedProjectFactsArtifact,
} from '../src/projectContextFoundation.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true }))
  );
});

describe('ProjectContext certified facts foundation', () => {
  it('exposes a stable isolated package subpath without changing live ProjectContext', async () => {
    const packageJson = JSON.parse(
      await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8')
    ) as { exports: Record<string, { import: string; types: string }> };

    expect(packageJson.exports['./project-context-foundation']).toEqual({
      import: './dist/projectContextFoundation.js',
      types: './dist/projectContextFoundation.d.ts',
    });
  });

  it('builds a canonical SourceRevisionVectorV1 and rejects host paths', () => {
    const vector = buildSourceRevisionVectorV1([
      {
        eligibleInventoryHash: hashCanonicalJson({ repo: 'plugin' }),
        includeExcludePolicyHash: hashCanonicalJson({ policy: 1 }),
        relativeRoot: 'AlembicPlugin',
        repoId: 'plugin',
        revision: {
          commitId: 'b'.repeat(40),
          kind: 'git-dirty',
          treeId: 'c'.repeat(40),
          workingTreeContentHash: hashCanonicalJson({ dirty: true }),
        },
        scopeId: 'mr-alembic',
      },
      {
        eligibleInventoryHash: hashCanonicalJson({ repo: 'core' }),
        includeExcludePolicyHash: hashCanonicalJson({ policy: 1 }),
        relativeRoot: 'AlembicCore',
        repoId: 'core',
        revision: {
          commitId: 'a'.repeat(40),
          kind: 'git-clean',
          treeId: 'd'.repeat(40),
        },
        scopeId: 'mr-alembic',
      },
    ]);

    expect(vector.entries.map((entry) => entry.repoId)).toEqual(['core', 'plugin']);
    expect(vector.sourceVectorHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(vector)).not.toContain(process.cwd());

    expect(() =>
      buildSourceRevisionVectorV1([
        {
          eligibleInventoryHash: hashCanonicalJson({ repo: 'core' }),
          includeExcludePolicyHash: hashCanonicalJson({ policy: 1 }),
          relativeRoot: '/private/workspace/AlembicCore',
          repoId: 'core',
          revision: {
            commitId: 'a'.repeat(40),
            kind: 'git-clean',
            treeId: 'd'.repeat(40),
          },
          scopeId: 'mr-alembic',
        },
      ])
    ).toThrow(/relativeRoot/);

    const contentVector = buildSourceRevisionVectorV1([
      {
        eligibleInventoryHash: hashCanonicalJson({ repo: 'content' }),
        includeExcludePolicyHash: hashCanonicalJson({ policy: 1 }),
        relativeRoot: '.',
        repoId: 'content',
        revision: {
          kind: 'content',
          workingTreeContentHash: hashCanonicalJson({ files: ['a.swift'] }),
        },
        scopeId: 'sp-bilidili',
      },
    ]);
    expect(contentVector.entries[0]?.revision.kind).toBe('content');
    expect(() =>
      buildSourceRevisionVectorV1([...contentVector.entries, ...contentVector.entries])
    ).toThrow(/Duplicate/);
    expect(() =>
      buildSourceRevisionVectorV1([{ ...contentVector.entries[0]!, relativeRoot: '../escape' }])
    ).toThrow(/relativeRoot/);
    expect(() =>
      buildSourceRevisionVectorV1([
        { ...contentVector.entries[0]!, relativeRoot: 'C:\\workspace\\source' },
      ])
    ).toThrow(/relativeRoot/);
    expect(() =>
      buildSourceRevisionVectorV1([{ ...contentVector.entries[0]!, relativeRoot: '~/source' }])
    ).toThrow(/relativeRoot/);
  });

  it('captures every inventory file once, bounds detail, and keeps nine request outcomes', async () => {
    const reads = new Map<string, number>();
    const input = createCaptureInput();
    const ports = createHostPorts(reads);

    const artifact = await captureCertifiedProjectFacts(input, ports);

    expect(reads).toEqual(
      new Map([
        ['src/index.ts', 1],
        ['src/worker.ts', 1],
      ])
    );
    expect(artifact.facts.inventory.files.map((file) => file.relativePath)).toEqual([
      'src/index.ts',
      'src/worker.ts',
    ]);
    expect(artifact.facts.inventory.fileCount).toBe(2);
    expect(artifact.facts.detail.decisions).toEqual([
      expect.objectContaining({ relativePath: 'src/index.ts', status: 'selected' }),
      expect.objectContaining({ relativePath: 'src/worker.ts', status: 'omitted' }),
    ]);
    expect(artifact.facts.detail.selections[0]).toMatchObject({
      previewTruncated: true,
      relativePath: 'src/index.ts',
    });
    expect(artifact.facts.detail.selections[0]?.fullChunkRefs.length).toBeGreaterThan(1);
    expect(artifact.facts.detail.continuation).toMatch(/^pcf-detail-v1:[a-f0-9]{64}$/);
    expect(artifact.facts.requestOutcomes).toHaveLength(9);
    expect(new Set(artifact.facts.requestOutcomes.map((row) => row.kind))).toEqual(
      new Set([
        'anchor-range',
        'space',
        'repo',
        'map',
        'module',
        'module-layers',
        'file-flow',
        'file-symbols',
        'source-slice',
      ])
    );
    expect(artifact.artifactId).toMatch(/^cpf-v1:[a-f0-9]{64}$/);
    expect(artifact.factsContentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(artifact.certificationBindingHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(artifact)).not.toContain('/virtual/workspace');

    const readiness = evaluateCertifiedProjectFactsReadiness(artifact, {
      expectedRepoIds: ['core'],
      requiredLegacyEntryIds: ['core-plan-raw-scanner'],
    });
    expect(readiness).toEqual({ errors: [], ok: true });
  });

  it('keeps artifact identity repeatable and separates config binding drift', async () => {
    const first = await captureCertifiedProjectFacts(createCaptureInput(), createHostPorts());
    const second = await captureCertifiedProjectFacts(createCaptureInput(), createHostPorts());
    const configDrift = await captureCertifiedProjectFacts(
      {
        ...createCaptureInput(),
        certification: {
          ...createCaptureInput().certification,
          acceptedConfigHash: hashCanonicalJson({ config: 2 }),
        },
      },
      createHostPorts()
    );
    const projectionDriftInput = createCaptureInput();
    projectionDriftInput.projections.plan = { consumer: 'plan', schemaVersion: 2 };
    const projectionDrift = await captureCertifiedProjectFacts(
      projectionDriftInput,
      createHostPorts()
    );
    const scopeDrift = await captureCertifiedProjectFacts(
      {
        ...createCaptureInput(),
        certification: {
          ...createCaptureInput().certification,
          scopeIdentityHash: hashCanonicalJson({ scope: 'different' }),
        },
      },
      createHostPorts()
    );
    const capabilityDrift = await captureCertifiedProjectFacts(
      {
        ...createCaptureInput(),
        certification: {
          ...createCaptureInput().certification,
          capabilityHash: hashCanonicalJson({ capability: 2 }),
        },
      },
      createHostPorts()
    );
    const sourceDrift = await captureCertifiedProjectFacts(createCaptureInput(), {
      ...createHostPorts(),
      observeRevision: async () => ({
        commitId: 'c'.repeat(40),
        dirty: false,
        kind: 'git',
        treeId: 'd'.repeat(40),
      }),
    });
    const factsDrift = await captureCertifiedProjectFacts(createCaptureInput(), {
      ...createHostPorts(),
      readFile: async ({ relativePath }) => Buffer.from(`changed:${relativePath}\n`),
    });

    expect(second.artifactId).toBe(first.artifactId);
    expect(second.factsContentHash).toBe(first.factsContentHash);
    expect(second.certificationBindingHash).toBe(first.certificationBindingHash);
    expect(configDrift.artifactId).toBe(first.artifactId);
    expect(configDrift.factsContentHash).toBe(first.factsContentHash);
    expect(configDrift.certificationBindingHash).not.toBe(first.certificationBindingHash);
    expect(projectionDrift.artifactId).not.toBe(first.artifactId);
    expect(projectionDrift.factsContentHash).toBe(first.factsContentHash);
    expect(projectionDrift.certificationBindingHash).not.toBe(first.certificationBindingHash);
    for (const bindingOnlyDrift of [scopeDrift, capabilityDrift]) {
      expect(bindingOnlyDrift.artifactId).toBe(first.artifactId);
      expect(bindingOnlyDrift.factsContentHash).toBe(first.factsContentHash);
      expect(bindingOnlyDrift.certificationBindingHash).not.toBe(first.certificationBindingHash);
    }
    expect(sourceDrift.sourceVectorHash).not.toBe(first.sourceVectorHash);
    expect(sourceDrift.artifactId).not.toBe(first.artifactId);
    expect(sourceDrift.certificationBindingHash).not.toBe(first.certificationBindingHash);
    expect(factsDrift.factsContentHash).not.toBe(first.factsContentHash);
    expect(factsDrift.artifactId).not.toBe(first.artifactId);

    const serialized = serializeCertifiedProjectFactsArtifact(first);
    expect(deserializeCertifiedProjectFactsArtifact(serialized)).toEqual(first);
    const corrupt = JSON.parse(serialized);
    corrupt.facts.inventory.files[0].sizeBytes += 1;
    expect(() => deserializeCertifiedProjectFactsArtifact(JSON.stringify(corrupt))).toThrow(
      /content hash/
    );
  });

  it('records cancellation, timeout, and errors honestly and blocks failed readiness storage', async () => {
    const input = createCaptureInput();
    const basePorts = createHostPorts();
    const artifact = await captureCertifiedProjectFacts(input, {
      ...basePorts,
      executeRequest: async ({ plan }) => {
        if (plan.kind === 'anchor-range') {
          return {
            terminalStatus: 'cancelled',
            output: { status: 'cancelled' },
            parserRuntime: 'ready',
            queryInitialization: 'ready',
          };
        }
        if (plan.kind === 'space') {
          return {
            terminalStatus: 'timed-out',
            output: { status: 'timed-out' },
            parserRuntime: 'not-required',
            queryInitialization: 'not-required',
          };
        }
        if (plan.kind === 'repo') {
          throw new Error('repo-handler-failed');
        }
        return basePorts.executeRequest({
          repository: input.repositories[0]!,
          plan,
        });
      },
    });

    expect(artifact.facts.requestOutcomes.find((row) => row.kind === 'anchor-range')).toMatchObject(
      { terminalStatus: 'cancelled' }
    );
    expect(artifact.facts.requestOutcomes.find((row) => row.kind === 'space')).toMatchObject({
      terminalStatus: 'timed-out',
    });
    expect(artifact.facts.requestOutcomes.find((row) => row.kind === 'repo')).toMatchObject({
      errors: ['repo-handler-failed'],
      terminalStatus: 'failed',
    });
    expect(artifact.readiness.verdict).toBe('failed');
    expect(evaluateCertifiedProjectFactsReadiness(artifact, { expectedRepoIds: ['core'] }).ok).toBe(
      false
    );

    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-facts-failed-store-'));
    temporaryRoots.push(root);
    await expect(
      new FileCertifiedProjectFactsStore(root, { logger: { info() {}, warn() {} } }).put(artifact)
    ).rejects.toThrow(/failed strict readiness/);
  });

  it('rejects host paths and volatile lineage fields from durable semantic payloads', async () => {
    const absoluteOutputPorts = createHostPorts();
    await expect(
      captureCertifiedProjectFacts(createCaptureInput(), {
        ...absoluteOutputPorts,
        executeRequest: async ({ plan }) => ({
          terminalStatus: 'completed',
          output: { kind: plan.kind, filePath: '/private/host/source.ts' },
          parserRuntime: 'ready',
          queryInitialization: 'ready',
        }),
      })
    ).rejects.toThrow(/host absolute path/);

    const projectionInput = createCaptureInput();
    projectionInput.projections.plan = {
      projectRoot: '/private/host',
      timestamp: '2026-07-15T00:00:00.000Z',
    };
    await expect(captureCertifiedProjectFacts(projectionInput, createHostPorts())).rejects.toThrow(
      /lineage field/
    );
  });

  it('projects approved sibling and project roots into stable portable identities', async () => {
    const approvedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-facts-portable-root-'));
    temporaryRoots.push(approvedRoot);
    const repositoryRoot = path.join(approvedRoot, 'Core');
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    const projectContext = {
      execute: async () => ({
        data: {
          filePath: path.join(repositoryRoot, 'src/index.ts'),
          realpath: approvedRoot,
        },
        errors: [],
        project: {
          projectRoot: repositoryRoot,
        },
        queryLevel: 'anchor-range',
        refs: [],
        schemaVersion: 1,
      }),
    } as never;
    const ports = new NodeProjectContextFoundationHostPorts(projectContext, {
      portableRoots: [{ portableId: 'approved-project-root', sourceRoot: approvedRoot }],
    });
    const plan = createRequestPlans('core')[0]!;
    const result = await ports.executeRequest({
      repository: {
        relativeRoot: 'Core',
        repoId: 'core',
        scopeId: 'mr-alembic',
        sourceRoot: repositoryRoot,
      },
      plan,
    });
    const serialized = JSON.stringify(result.output);

    expect(serialized).not.toContain(approvedRoot);
    expect(serialized).toContain('portable:approved-project-root:.');
    expect(serialized).toContain('src/index.ts');
  });

  it('attaches lineage only after artifact identity and keeps strict counters at zero', async () => {
    const artifact = await captureCertifiedProjectFacts(createCaptureInput(), createHostPorts());
    const receipt = createProjectContextConsumerLineageReceipt(
      artifact,
      CERTIFIED_PROJECT_FACTS_CONSUMERS.map((consumer) => ({
        consumer,
        directProjectContextCallCount: 0,
        entrypoint: `adapter/${consumer}`,
        projectionContentHash: artifact.manifest.projectionContentHashes[consumer],
        rawFilesystemFallbackCount: 0,
        sessionReloadStatus: 'passed' as const,
        synthesizedProjectScopeFactCount: 0,
        verdict: 'passed' as const,
      }))
    );

    expect(receipt.rows).toHaveLength(5);
    expect(receipt.rows.every((row) => row.artifactId === artifact.artifactId)).toBe(true);
    expect(receipt.rows.every((row) => row.sourceVectorHash === artifact.sourceVectorHash)).toBe(
      true
    );
    expect(
      Object.values(artifact.projections).every(
        (projection) => !JSON.stringify(projection.payload).includes(artifact.artifactId)
      )
    ).toBe(true);
  });

  it('reopens durable content-addressed artifacts and refuses a second run consumer', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-facts-store-'));
    temporaryRoots.push(root);
    const silentLogger = { info() {}, warn() {} };
    const store = new FileCertifiedProjectFactsStore(root, { logger: silentLogger });
    const artifact = await captureCertifiedProjectFacts(createCaptureInput(), createHostPorts());

    const stored = await store.put(artifact);
    const reopened = await store.open(artifact.artifactId, artifact.certificationBindingHash);
    const preparation = await store.createPreparation(
      artifact.artifactId,
      artifact.certificationBindingHash
    );
    const acquired = await store.acquireRunLease({
      preparationId: preparation.preparationId,
      runId: 'run-a',
      expectedCertificationBindingHash: artifact.certificationBindingHash,
    });
    const resumed = await store.acquireRunLease({
      preparationId: preparation.preparationId,
      runId: 'run-a',
      expectedCertificationBindingHash: artifact.certificationBindingHash,
    });

    expect(stored.artifactId).toBe(artifact.artifactId);
    expect(stored.certificationReceiptRef).toMatch(/^certification-receipts\/[a-f0-9]{64}\.json$/);
    expect(stored.artifactRef).toMatch(/^artifacts\/[a-f0-9]{64}\/artifact\.json$/);
    expect(reopened).toEqual(artifact);
    expect(preparation.preparationId).toMatch(/^prep-v1:/);
    expect(preparation.preparationId).not.toContain(artifact.artifactId);
    expect(acquired.status).toBe('acquired');
    expect(resumed.status).toBe('resumed');
    const freshStoreInstance = new FileCertifiedProjectFactsStore(root, { logger: silentLogger });
    const consumerPort = new CertifiedProjectFactsConsumerPort(freshStoreInstance);
    const binding = await consumerPort.reopen({
      preparationId: preparation.preparationId,
      runId: 'run-a',
      consumer: 'plan',
      expectedCertificationBindingHash: artifact.certificationBindingHash,
    });
    expect(binding).toMatchObject({
      artifactId: artifact.artifactId,
      consumer: 'plan',
      lease: { status: 'resumed' },
    });
    await expect(
      store.acquireRunLease({
        preparationId: preparation.preparationId,
        runId: 'run-b',
        expectedCertificationBindingHash: artifact.certificationBindingHash,
      })
    ).rejects.toBeInstanceOf(ProjectFactsLeaseConflictError);

    const configDriftInput = createCaptureInput();
    configDriftInput.certification.acceptedConfigHash = hashCanonicalJson({ config: 2 });
    const configDrift = await captureCertifiedProjectFacts(configDriftInput, createHostPorts());
    expect(configDrift.artifactId).toBe(artifact.artifactId);
    await expect(store.put(configDrift)).resolves.toMatchObject({
      artifactId: artifact.artifactId,
      certificationBindingHash: configDrift.certificationBindingHash,
    });
    await expect(
      store.open(configDrift.artifactId, configDrift.certificationBindingHash)
    ).resolves.toEqual(configDrift);
    await expect(
      store.acquireRunLease({
        preparationId: preparation.preparationId,
        runId: 'run-a',
        expectedCertificationBindingHash: configDrift.certificationBindingHash,
      })
    ).rejects.toBeInstanceOf(ProjectFactsLeaseConflictError);
    await expect(
      store.acquireRunLease({
        preparationId: preparation.preparationId,
        runId: 'run-a',
        expectedCertificationBindingHash: hashCanonicalJson({ stale: true }),
      })
    ).rejects.toBeInstanceOf(ProjectFactsLeaseConflictError);

    const consumerPortSource = await fs.readFile(
      path.join(process.cwd(), 'src/service/project-context/foundation/consumerPort.ts'),
      'utf8'
    );
    expect(consumerPortSource).not.toMatch(
      /collectPlanProjectContext|collectProjectSourceFileFacts|ProjectContextCapabilities/
    );
  });

  it('keeps inventory complete beyond the retired raw Plan 5000-file cap', async () => {
    const files = Array.from({ length: 5001 }, (_, index) => ({
      language: 'typescript',
      mode: '100644',
      relativePath: `src/f-${String(index).padStart(4, '0')}.ts`,
    }));
    const content = Buffer.from('export {};\n');
    const artifact = await captureCertifiedProjectFacts(createCaptureInput(), {
      ...createHostPorts(),
      enumerateEligibleFiles: async () => files,
      readFile: async () => content,
    });

    expect(artifact.facts.inventory.fileCount).toBe(5001);
    expect(artifact.facts.detail.selectedFileCount).toBe(1);
    expect(artifact.facts.detail.omittedFileCount).toBe(5000);
    expect(artifact.facts.detail.decisions).toHaveLength(5001);
  });
});

function createCaptureInput(): ProjectContextFoundationCaptureInput {
  return {
    certification: {
      acceptedConfigHash: hashCanonicalJson({ config: 1 }),
      acceptedRuntimeHash: hashCanonicalJson({ runtime: 1 }),
      capabilityHash: hashCanonicalJson({ capability: 1 }),
      parserHash: hashCanonicalJson({ parser: 1 }),
      scopeIdentityHash: hashCanonicalJson({ scope: 'core' }),
    },
    detailPolicy: {
      chunkBytes: 4,
      maxPreviewBytes: 5,
      maxSelectedFiles: 1,
    },
    inventoryPolicy: {
      excludeDirectories: ['node_modules', '.git'],
      includeExtensions: ['.ts'],
      version: 'pcf-test-policy-v1',
    },
    legacyEntries: [
      {
        directProjectContextCallCount: 0,
        entryId: 'core-plan-raw-scanner',
        entrypoint: 'src/service/plan/facts/collectProjectContext.ts',
        rawFilesystemFallbackCount: 0,
        reachability: 'unreachable',
        synthesizedProjectScopeFactCount: 0,
        typedReason: 'strict-consumer-uses-certified-artifact-only',
      },
    ],
    projectMode: 'MR-ALEMBIC',
    projections: Object.fromEntries(
      CERTIFIED_PROJECT_FACTS_CONSUMERS.map((consumer) => [
        consumer,
        { consumer, schemaVersion: 1 },
      ])
    ) as ProjectContextFoundationCaptureInput['projections'],
    repositories: [
      {
        relativeRoot: '.',
        repoId: 'core',
        scopeId: 'mr-alembic',
        sourceRoot: '/virtual/workspace',
      },
    ],
    requestPlans: createRequestPlans('core'),
  };
}

function createRequestPlans(repoId: string): ProjectContextRequestAuditPlan[] {
  return [
    'anchor-range',
    'space',
    'repo',
    'map',
    'module',
    'module-layers',
    'file-flow',
    'file-symbols',
    'source-slice',
  ].map((kind) => ({
    applicability: 'applicable',
    kind,
    repoId,
    scope: { repoId, sourceFolder: '.' },
    selector: { filePath: 'src/index.ts', kind },
  }));
}

function createHostPorts(
  readCounts = new Map<string, number>()
): ProjectContextFoundationHostPorts {
  const contents = new Map([
    ['src/index.ts', Buffer.from('export const alpha = 1;\n')],
    ['src/worker.ts', Buffer.from('export const beta = 2;\n')],
  ]);
  return {
    enumerateEligibleFiles: async () => [
      { language: 'typescript', mode: '100644', relativePath: 'src/worker.ts' },
      { language: 'typescript', mode: '100644', relativePath: 'src/index.ts' },
    ],
    executeRequest: async ({ plan }) => ({
      continuation: plan.kind === 'repo' ? 'repo-next' : undefined,
      detectedLanguage: ['file-flow', 'file-symbols', 'source-slice', 'anchor-range'].includes(
        plan.kind
      )
        ? 'typescript'
        : undefined,
      output: { kind: plan.kind, ok: true },
      parserRuntime: ['file-flow', 'file-symbols', 'anchor-range'].includes(plan.kind)
        ? 'ready'
        : 'not-required',
      queryInitialization: 'ready',
      sourceRanges: [
        {
          endLine: 1,
          relativePath: 'src/index.ts',
          repoId: plan.repoId,
          startLine: 1,
        },
      ],
      terminalStatus: 'completed',
    }),
    observeRevision: async () => ({
      commitId: 'a'.repeat(40),
      dirty: false,
      kind: 'git',
      treeId: 'b'.repeat(40),
    }),
    readFile: async ({ relativePath }) => {
      readCounts.set(relativePath, (readCounts.get(relativePath) ?? 0) + 1);
      const content = contents.get(relativePath);
      if (!content) {
        throw new Error(`Unexpected file read: ${relativePath}`);
      }
      return content;
    },
  };
}
