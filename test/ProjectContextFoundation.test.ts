import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildSourceRevisionVectorV1,
  CERTIFIED_PROJECT_FACTS_CONSUMERS,
  CertifiedProjectFactsConsumerPort,
  captureCertifiedProjectFacts,
  createProjectContextConsumerLineageReceipt,
  createProjectContextDependencyOwnershipV1,
  createProjectContextRequestAuditPlans,
  deserializeCertifiedProjectFactsArtifact,
  evaluateCertifiedProjectFactsReadiness,
  FileCertifiedProjectFactsStore,
  hashBytes,
  hashCanonicalJson,
  NodeProjectContextFoundationHostPorts,
  type ProjectContextFoundationCaptureInput,
  type ProjectContextFoundationHostPorts,
  type ProjectContextRequestAuditPlan,
  ProjectFactsLeaseConflictError,
  serializeCertifiedProjectFactsArtifact,
  verifyCertifiedProjectFactsArtifact,
} from '../src/projectContextFoundation.js';

const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);

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
        ['src/index.ts', 2],
        ['src/worker.ts', 2],
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

  it('re-reads add, modify, and delete changes through one host port instance', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-facts-inventory-refresh-'));
    temporaryRoots.push(root);
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'src/index.ts'), 'export const first = 1;\n');
    const repository = {
      relativeRoot: '.',
      repoId: 'refresh',
      scopeId: 'refresh-scope',
      sourceRoot: root,
    };
    const policy = {
      excludeDirectories: ['node_modules', '.git'],
      includeExtensions: ['.ts'],
      version: 'refresh-test-v1',
    };
    const ports = new NodeProjectContextFoundationHostPorts({
      execute: async () => undefined,
    } as never);

    expect(
      (await ports.enumerateEligibleFiles({ repository, policy })).map((file) => file.relativePath)
    ).toEqual(['src/index.ts']);
    await fs.writeFile(path.join(root, 'src/worker.ts'), 'export const second = 2;\n');
    expect(
      (await ports.enumerateEligibleFiles({ repository, policy })).map((file) => file.relativePath)
    ).toEqual(['src/index.ts', 'src/worker.ts']);
    await fs.writeFile(path.join(root, 'src/index.ts'), 'export const first = 2;\n');
    expect(
      Buffer.from(await ports.readFile({ repository, relativePath: 'src/index.ts' })).toString()
    ).toBe('export const first = 2;\n');
    await fs.unlink(path.join(root, 'src/worker.ts'));
    expect(
      (await ports.enumerateEligibleFiles({ repository, policy })).map((file) => file.relativePath)
    ).toEqual(['src/index.ts']);
  });

  it('rejects one project-relative file assigned to overlapping repositories', async () => {
    const input = createCaptureInput();
    input.repositories = [
      { ...input.repositories[0]!, relativeRoot: '.', repoId: 'root' },
      { ...input.repositories[0]!, relativeRoot: 'Packages/A', repoId: 'package-a' },
    ];
    input.requestPlans = input.repositories.flatMap((repository) =>
      createRequestPlans(repository.repoId)
    );
    const basePorts = createHostPorts();
    const ports: ProjectContextFoundationHostPorts = {
      ...basePorts,
      enumerateEligibleFiles: async ({ repository }) =>
        repository.repoId === 'root'
          ? [
              {
                language: 'typescript',
                mode: '100644',
                relativePath: 'Packages/A/src/index.ts',
              },
            ]
          : [{ language: 'typescript', mode: '100644', relativePath: 'src/index.ts' }],
      readFile: async () => Buffer.from('export const overlap = true;\n'),
    };

    await expect(captureCertifiedProjectFacts(input, ports)).rejects.toThrow(
      /assigns .*Packages\/A\/src\/index\.ts to multiple repositories/i
    );

    const valid = await captureCertifiedProjectFacts(createCaptureInput(), createHostPorts());
    const corrupt = structuredClone(valid);
    corrupt.facts.inventory.repositories.push({
      ...corrupt.facts.inventory.repositories[0]!,
      relativeRoot: 'src',
      repoId: 'nested',
    });
    corrupt.facts.inventory.files.push({
      ...corrupt.facts.inventory.files.find((file) => file.relativePath === 'src/index.ts')!,
      relativePath: 'index.ts',
      repoId: 'nested',
    });
    corrupt.facts.inventory.fileCount += 1;
    expect(
      evaluateCertifiedProjectFactsReadiness(corrupt, { expectedRepoIds: ['core', 'nested'] })
        .errors
    ).toEqual(
      expect.arrayContaining([expect.stringContaining('Cross-repository inventory overlap')])
    );
  });

  it('creates complete module audit seeds instead of selecting one eligible file', () => {
    const plans = createProjectContextRequestAuditPlans({
      repository: {
        relativeRoot: '.',
        repoId: 'core',
        scopeId: 'mr-alembic',
        sourceRoot: '/virtual/workspace',
      },
      eligibleFiles: [
        {
          language: 'typescript',
          mode: '100644',
          ownerModuleIds: ['path:src'],
          relativePath: 'src/index.ts',
        },
        {
          language: 'typescript',
          mode: '100644',
          ownerModuleIds: ['path:test'],
          relativePath: 'test/index.test.ts',
        },
      ],
    });
    const modulePlans = plans.filter((plan) => plan.kind === 'module');
    const mapPlan = plans.find((plan) => plan.kind === 'map');

    expect(modulePlans).toHaveLength(2);
    expect(modulePlans.map((plan) => plan.selector)).toEqual([
      expect.objectContaining({ modulePath: 'src', ownedFiles: ['src/index.ts'] }),
      expect.objectContaining({ modulePath: 'test', ownedFiles: ['test/index.test.ts'] }),
    ]);
    expect(mapPlan?.selector).toEqual(
      expect.objectContaining({
        moduleSeeds: expect.arrayContaining([
          expect.objectContaining({ modulePath: 'src' }),
          expect.objectContaining({ modulePath: 'test' }),
        ]),
      })
    );
    expect(plans.find((plan) => plan.kind === 'space')?.selector).toEqual(
      expect.objectContaining({
        sourceFolders: [expect.objectContaining({ path: '.', repositoryId: 'core' })],
      })
    );
  });

  it('derives real Swift target ownership without promoting docs or config into modules', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-facts-swift-owners-'));
    temporaryRoots.push(root);
    for (const relativePath of [
      'BiliDili/App.swift',
      'Sources/Core/ServiceKit/Service.swift',
      'Sources/Features/Home/Home.swift',
      'Packages/AOXUIKit/Sources/AOXUIKit/UIKit.swift',
      'Tests/HomeTests/HomeTests.swift',
      'docs/example.swift',
    ]) {
      await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
      await fs.writeFile(path.join(root, relativePath), `// ${relativePath}\n`);
    }
    const repository = {
      relativeRoot: '.',
      repoId: 'bilidili-root',
      scopeId: 'sp-bilidili',
      sourceRoot: root,
    };
    const ports = new NodeProjectContextFoundationHostPorts({
      execute: async () => undefined,
    } as never);
    const eligibleFiles = await ports.enumerateEligibleFiles({
      repository,
      policy: {
        excludeDirectories: ['.git'],
        includeExtensions: ['.swift'],
        version: 'swift-owner-test-v1',
      },
    });
    const moduleNames = createProjectContextRequestAuditPlans({ repository, eligibleFiles })
      .filter((plan) => plan.kind === 'module')
      .map((plan) => (plan.selector as { moduleName?: string }).moduleName)
      .sort();

    expect(moduleNames).toEqual(['AOXUIKit', 'BiliDili', 'Home', 'HomeTests', 'ServiceKit']);
    expect(moduleNames).not.toContain('docs');
  });

  it('requires every module audit seed to conserve its full inventory ownership', async () => {
    const descriptors = [
      {
        language: 'typescript',
        mode: '100644',
        ownerModuleIds: ['module:src'],
        relativePath: 'src/index.ts',
      },
      {
        language: 'typescript',
        mode: '100644',
        ownerModuleIds: ['module:src'],
        relativePath: 'src/worker.ts',
      },
    ];
    const input = createCaptureInput();
    input.requestPlans = createProjectContextRequestAuditPlans({
      repository: input.repositories[0]!,
      eligibleFiles: descriptors,
    });
    const basePorts = createHostPorts();
    const complete = await captureCertifiedProjectFacts(input, {
      ...basePorts,
      enumerateEligibleFiles: async () => descriptors,
    });
    expect(complete.readiness.verdict).toBe('passed');

    const incompleteInput = createCaptureInput();
    incompleteInput.requestPlans = input.requestPlans.map((plan) =>
      plan.kind === 'module' && plan.applicability === 'applicable'
        ? {
            ...plan,
            selector: {
              ...(plan.selector as Record<string, unknown>),
              ownedFiles: ['src/index.ts'],
            },
          }
        : plan
    );
    const incomplete = await captureCertifiedProjectFacts(incompleteInput, {
      ...basePorts,
      enumerateEligibleFiles: async () => descriptors,
    });
    expect(incomplete.readiness).toMatchObject({
      verdict: 'failed',
      errors: expect.arrayContaining(['module-owner-coverage:core/module']),
    });
  });

  it('fails closed for add, delete, modify, clean-to-dirty, and dirty-content capture drift', async () => {
    const scenarios = [
      {
        name: 'add',
        mutate: (files: Map<string, Buffer>) =>
          files.set('src/added.ts', Buffer.from('export const added = true;\n')),
        revision: 'content',
      },
      {
        name: 'delete',
        mutate: (files: Map<string, Buffer>) => files.delete('src/worker.ts'),
        revision: 'content',
      },
      {
        name: 'modify',
        mutate: (files: Map<string, Buffer>) =>
          files.set('src/worker.ts', Buffer.from('export const beta = 3;\n')),
        revision: 'content',
      },
      {
        name: 'clean-to-dirty',
        mutate: (files: Map<string, Buffer>) =>
          files.set('src/index.ts', Buffer.from('export const alpha = 2;\n')),
        revision: 'clean-to-dirty',
      },
      {
        name: 'dirty-content',
        mutate: (files: Map<string, Buffer>) =>
          files.set('src/index.ts', Buffer.from('export const alpha = 4;\n')),
        revision: 'dirty',
      },
    ] as const;

    for (const scenario of scenarios) {
      const input = createCaptureInput();
      const basePorts = createHostPorts();
      const files = new Map<string, Buffer>([
        ['src/index.ts', Buffer.from('export const alpha = 1;\n')],
        ['src/worker.ts', Buffer.from('export const beta = 2;\n')],
      ]);
      let changed = false;
      const ports: ProjectContextFoundationHostPorts = {
        ...basePorts,
        enumerateEligibleFiles: async () =>
          [...files.keys()].sort().map((relativePath) => ({
            language: 'typescript',
            mode: '100644',
            relativePath,
          })),
        executeRequest: async (request) => {
          if (!changed) {
            scenario.mutate(files);
            changed = true;
          }
          return basePorts.executeRequest(request);
        },
        observeRevision: async () =>
          scenario.revision === 'content'
            ? { kind: 'content' }
            : {
                commitId: 'a'.repeat(40),
                dirty: scenario.revision === 'dirty' || changed,
                kind: 'git',
                treeId: 'b'.repeat(40),
              },
        readFile: async ({ relativePath }) => {
          const content = files.get(relativePath);
          if (!content) {
            throw new Error(`Missing ${scenario.name} fixture file: ${relativePath}`);
          }
          return content;
        },
      };
      await expect(captureCertifiedProjectFacts(input, ports), scenario.name).rejects.toThrow(
        /source state changed during certified capture/i
      );
    }
  });

  it('rejects a clean revision fence whose reads return the same dirty bytes in both rounds', async () => {
    const input = createCaptureInput();
    const basePorts = createHostPorts();
    const { verifySnapshot: _verifySnapshot, ...unverifiedBasePorts } = basePorts;
    const clean = Buffer.from('export const value = "clean";\n');
    const dirty = Buffer.from('export const value = "dirty";\n');
    let workingTree = clean;

    const ports: ProjectContextFoundationHostPorts = {
      ...unverifiedBasePorts,
      enumerateEligibleFiles: async () => {
        workingTree = clean;
        return [{ language: 'typescript', mode: '100644', relativePath: 'src/index.ts' }];
      },
      observeRevision: async () => ({
        commitId: 'a'.repeat(40),
        dirty: false,
        kind: 'git',
        treeId: 'b'.repeat(40),
      }),
      readFile: async () => {
        workingTree = dirty;
        return workingTree;
      },
    };

    await expect(captureCertifiedProjectFacts(input, ports)).rejects.toMatchObject({
      code: 'PROJECT_CONTEXT_SOURCE_STATE_DRIFT',
    });
    expect(workingTree).toEqual(dirty);
  });

  it('rejects a verifier that turns clean outer fences into an observed dirty final state', async () => {
    const input = createCaptureInput();
    const basePorts = createHostPorts();
    const dirty = Buffer.from('export const value = "dirty";\n');
    const ports: ProjectContextFoundationHostPorts = {
      ...basePorts,
      enumerateEligibleFiles: async () => [
        { language: 'typescript', mode: '100644', relativePath: 'src/index.ts' },
      ],
      observeRevision: async () => ({
        commitId: 'a'.repeat(40),
        dirty: false,
        kind: 'git',
        treeId: 'b'.repeat(40),
      }),
      readFile: async () => dirty,
      verifySnapshot: async ({ candidate }) => ({
        version: 1,
        verified: true,
        binding: 'working-tree-content',
        finalRevision: {
          commitId: 'a'.repeat(40),
          dirty: true,
          kind: 'git',
          treeId: 'b'.repeat(40),
        },
        eligibleInventoryHash: candidate.eligibleInventoryHash,
        workingTreeContentHash: candidate.workingTreeContentHash,
        typedReason: 'terminal-observation-is-dirty',
      }),
    };

    await expect(captureCertifiedProjectFacts(input, ports)).rejects.toMatchObject({
      code: 'PROJECT_CONTEXT_SOURCE_STATE_DRIFT',
    });
  });

  it('isolates captured inventory and detail bytes from a mutating snapshot verifier', async () => {
    const basePorts = createHostPorts();
    const artifact = await captureCertifiedProjectFacts(createCaptureInput(), {
      ...basePorts,
      verifySnapshot: async (request) => {
        const candidateFile = request.candidate.files[0]!;
        candidateFile.content.fill(0x78);
        (candidateFile.file.ownerModuleIds as string[]).push('module:forged');
        (request.candidate.preRevision as { dirty?: boolean }).dirty = true;
        return basePorts.verifySnapshot!(request);
      },
    });

    const selected = artifact.facts.detail.selections[0]!;
    const inventory = artifact.facts.inventory.files.find(
      (file) => file.repoId === selected.repoId && file.relativePath === selected.relativePath
    )!;
    expect(selected.fullContentHash).toBe(inventory.blobSha256);
    expect(inventory.ownerModuleIds).not.toContain('module:forged');
    expect(Buffer.from(selected.previewBase64, 'base64').toString('utf8')).toBe('expor');
    expect(() => verifyCertifiedProjectFactsArtifact(artifact)).not.toThrow();
  });

  it('rejects re-signed detail planes whose chunk order or preview diverges from inventory', async () => {
    const artifact = await captureCertifiedProjectFacts(createCaptureInput(), createHostPorts());
    const reordered = structuredClone(artifact);
    reordered.facts.detail.selections[0]!.fullChunkRefs.reverse();
    resignArtifactForIntegrityTest(reordered);
    expect(() => verifyCertifiedProjectFactsArtifact(reordered)).toThrow(
      /detail content does not match inventory/i
    );

    const forgedPreview = structuredClone(artifact);
    forgedPreview.facts.detail.selections[0]!.previewBase64 =
      Buffer.from('xxxxx').toString('base64');
    resignArtifactForIntegrityTest(forgedPreview);
    expect(() => verifyCertifiedProjectFactsArtifact(forgedPreview)).toThrow(
      /detail preview does not match full content/i
    );
  });

  it('closes each read interval against add, delete, and modify before the post fence', async () => {
    for (const scenario of ['add', 'delete', 'modify'] as const) {
      const input = createCaptureInput();
      const basePorts = createHostPorts();
      const files = new Map([['src/index.ts', Buffer.from('export const value = 1;\n')]]);
      let changed = false;
      let verifierCalled = false;
      const ports: ProjectContextFoundationHostPorts = {
        ...basePorts,
        enumerateEligibleFiles: async () =>
          [...files.keys()].map((relativePath) => ({
            language: 'typescript',
            mode: '100644',
            relativePath,
          })),
        observeRevision: async () => ({
          commitId: 'a'.repeat(40),
          dirty: changed,
          kind: 'git',
          treeId: 'b'.repeat(40),
        }),
        readFile: async ({ relativePath }) => {
          const captured = files.get(relativePath);
          if (!captured) {
            throw new Error(`missing ${relativePath}`);
          }
          if (scenario === 'add') {
            files.set('src/added.ts', Buffer.from('export {};\n'));
          }
          if (scenario === 'delete') {
            files.delete(relativePath);
          }
          if (scenario === 'modify') {
            files.set(relativePath, Buffer.from('export const value = 2;\n'));
          }
          changed = true;
          return captured;
        },
        verifySnapshot: async (request) => {
          verifierCalled = true;
          return basePorts.verifySnapshot!(request);
        },
      };

      await expect(captureCertifiedProjectFacts(input, ports), scenario).rejects.toMatchObject({
        code: 'PROJECT_CONTEXT_SOURCE_STATE_DRIFT',
      });
      expect(verifierCalled, scenario).toBe(false);
    }
  });

  it('rejects transient clean-to-dirty-to-clean bytes that do not match the declared Git tree', async () => {
    const root = await createTemporaryGitRepository();
    const repository = {
      relativeRoot: '.',
      repoId: 'core',
      scopeId: 'mr-alembic',
      sourceRoot: root,
    };
    const input = createCaptureInput();
    input.repositories = [repository];
    const clean = await fs.readFile(path.join(root, 'src/index.ts'));
    const dirty = Buffer.from('export const value = "dirty";\n');
    const nodePorts = new NodeProjectContextFoundationHostPorts({ execute() {} } as never);
    const requestPorts = createHostPorts();
    const ports: ProjectContextFoundationHostPorts = {
      enumerateEligibleFiles: (request) => nodePorts.enumerateEligibleFiles(request),
      executeRequest: (request) => requestPorts.executeRequest(request),
      observeRevision: (request) => nodePorts.observeRevision(request),
      readFile: async (request) => {
        await fs.writeFile(path.join(root, request.relativePath), dirty);
        const captured = await nodePorts.readFile(request);
        await fs.writeFile(path.join(root, request.relativePath), clean);
        return captured;
      },
      verifySnapshot: (request) => nodePorts.verifySnapshot(request),
    };

    await expect(captureCertifiedProjectFacts(input, ports)).rejects.toMatchObject({
      code: 'PROJECT_CONTEXT_SOURCE_STATE_DRIFT',
    });
    expect(await fs.readFile(path.join(root, 'src/index.ts'))).toEqual(clean);
    expect((await execFileAsync('git', ['-C', root, 'status', '--porcelain'])).stdout).toBe('');
  });

  it('binds a stable dirty Git snapshot to its terminal full-content hash', async () => {
    const root = await createTemporaryGitRepository();
    await fs.writeFile(path.join(root, 'src/index.ts'), 'export const value = "dirty";\n');
    const repository = {
      relativeRoot: '.',
      repoId: 'core',
      scopeId: 'mr-alembic',
      sourceRoot: root,
    };
    const nodePorts = new NodeProjectContextFoundationHostPorts({ execute() {} } as never);
    const descriptors = await nodePorts.enumerateEligibleFiles({
      repository,
      policy: createCaptureInput().inventoryPolicy,
    });
    const input = createCaptureInput();
    input.repositories = [repository];
    input.requestPlans = createProjectContextRequestAuditPlans({
      repository,
      eligibleFiles: descriptors,
    });
    const requestPorts = createHostPorts();
    const ports: ProjectContextFoundationHostPorts = {
      enumerateEligibleFiles: (request) => nodePorts.enumerateEligibleFiles(request),
      executeRequest: (request) => requestPorts.executeRequest(request),
      observeRevision: (request) => nodePorts.observeRevision(request),
      readFile: (request) => nodePorts.readFile(request),
      verifySnapshot: (request) => nodePorts.verifySnapshot(request),
    };

    const artifact = await captureCertifiedProjectFacts(input, ports);

    expect(artifact.manifest.sourceRevisionVector.entries[0]?.revision).toMatchObject({
      kind: 'git-dirty',
      workingTreeContentHash: expect.stringMatching(/^sha256:/),
    });
    expect(artifact.readiness.verdict).toBe('passed');
  });

  it('promotes stable eligible ignored content to a content-bound dirty revision', async () => {
    const root = await createTemporaryGitRepository();
    await fs.writeFile(path.join(root, '.gitignore'), '.generated/\n');
    await execFileAsync('git', ['-C', root, 'add', '.gitignore']);
    await execFileAsync('git', ['-C', root, 'commit', '--quiet', '-m', 'ignore generated']);
    await fs.mkdir(path.join(root, '.generated'), { recursive: true });
    await fs.writeFile(path.join(root, '.generated/stable.ts'), 'export const stable = true;\n');
    expect((await execFileAsync('git', ['-C', root, 'status', '--porcelain'])).stdout).toBe('');
    const repository = {
      relativeRoot: '.',
      repoId: 'core',
      scopeId: 'mr-alembic',
      sourceRoot: root,
    };
    const nodePorts = new NodeProjectContextFoundationHostPorts({ execute() {} } as never);
    const descriptors = await nodePorts.enumerateEligibleFiles({
      repository,
      policy: createCaptureInput().inventoryPolicy,
    });
    const input = createCaptureInput();
    input.repositories = [repository];
    input.requestPlans = createProjectContextRequestAuditPlans({
      repository,
      eligibleFiles: descriptors,
    });
    const requestPorts = createHostPorts();
    const ports: ProjectContextFoundationHostPorts = {
      enumerateEligibleFiles: (request) => nodePorts.enumerateEligibleFiles(request),
      executeRequest: (request) => requestPorts.executeRequest(request),
      observeRevision: (request) => nodePorts.observeRevision(request),
      readFile: (request) => nodePorts.readFile(request),
      verifySnapshot: (request) => nodePorts.verifySnapshot(request),
    };

    const artifact = await captureCertifiedProjectFacts(input, ports);

    expect(artifact.facts.inventory.files.map((file) => file.relativePath)).toContain(
      '.generated/stable.ts'
    );
    expect(artifact.manifest.sourceRevisionVector.entries[0]?.revision).toMatchObject({
      kind: 'git-dirty',
      workingTreeContentHash: expect.stringMatching(/^sha256:/),
    });
  });

  it('keeps legacy content hosts compatible through two matching complete candidates', async () => {
    const basePorts = createHostPorts();
    const { verifySnapshot: _verifySnapshot, ...legacyPorts } = basePorts;
    const artifact = await captureCertifiedProjectFacts(createCaptureInput(), {
      ...legacyPorts,
      observeRevision: async () => ({ kind: 'content' }),
    });

    expect(artifact.manifest.sourceRevisionVector.entries[0]?.revision).toMatchObject({
      kind: 'content',
      workingTreeContentHash: expect.stringMatching(/^sha256:/),
    });
    expect(artifact.readiness.verdict).toBe('passed');
  });

  it('preserves cancellation from read, post-fence, and snapshot-verifier stages', async () => {
    for (const stage of ['read', 'post-fence', 'verifier'] as const) {
      const controller = new AbortController();
      const reason = new Error(`cancel-${stage}`);
      const basePorts = createHostPorts();
      let observationCount = 0;
      const ports: ProjectContextFoundationHostPorts = {
        ...basePorts,
        observeRevision: async (request) => {
          observationCount += 1;
          if (stage === 'post-fence' && observationCount === 2) {
            controller.abort(reason);
            throw reason;
          }
          return basePorts.observeRevision(request);
        },
        readFile: async (request) => {
          if (stage === 'read') {
            controller.abort(reason);
            throw reason;
          }
          return basePorts.readFile(request);
        },
        verifySnapshot: async (request) => {
          if (stage === 'verifier') {
            controller.abort(reason);
            throw reason;
          }
          return basePorts.verifySnapshot!(request);
        },
      };

      await expect(
        captureCertifiedProjectFacts({ ...createCaptureInput(), signal: controller.signal }, ports),
        stage
      ).rejects.toBe(reason);
    }
  });

  it('does not let non-empty request errors pass strict readiness', async () => {
    const basePorts = createHostPorts();
    const artifact = await captureCertifiedProjectFacts(createCaptureInput(), {
      ...basePorts,
      executeRequest: async (request) => ({
        ...(await basePorts.executeRequest(request)),
        errors: [
          {
            classification: 'confirmed-defect',
            code: 'query-unavailable',
            message: 'internal module was not covered',
            retryable: false,
            severity: 'error',
            typedReason: 'internal-owned-module-was-not-resolved',
          },
        ],
      }),
    });

    expect(artifact.readiness.verdict).toBe('failed');
    expect(evaluateCertifiedProjectFactsReadiness(artifact, { expectedRepoIds: ['core'] }).ok).toBe(
      false
    );

    const untyped = await captureCertifiedProjectFacts(createCaptureInput(), {
      ...basePorts,
      executeRequest: async (request) => ({
        ...(await basePorts.executeRequest(request)),
        errors: ['untyped-error'] as never,
      }),
    });
    expect(untyped.readiness.verdict).toBe('failed');
    expect(
      untyped.facts.requestOutcomes.every((row) =>
        row.errors.every(
          (error) =>
            error.classification === 'confirmed-defect' && error.code === 'execution-failed'
        )
      )
    ).toBe(true);
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
      errors: [
        expect.objectContaining({ code: 'execution-failed', message: 'repo-handler-failed' }),
      ],
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

  it('classifies declared internal, approved sibling, and external diagnostics explicitly', async () => {
    const approvedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-facts-diagnostics-'));
    temporaryRoots.push(approvedRoot);
    const repositoryRoot = path.join(approvedRoot, 'Core');
    const siblingRoot = path.join(approvedRoot, 'Sibling');
    await fs.mkdir(repositoryRoot, { recursive: true });
    await fs.mkdir(siblingRoot, { recursive: true });
    const projectContext = {
      execute: async () => ({
        contractVersion: 1,
        data: { modules: [] },
        errors: [
          {
            code: 'query-unavailable',
            message: 'map external dependency is not owned by module seeds: src',
            retryable: false,
            severity: 'warning',
          },
          {
            code: 'query-unavailable',
            message: 'map external dependency is not owned by module seeds: ../Sibling/dist/api.js',
            retryable: false,
            severity: 'warning',
          },
          {
            code: 'query-unavailable',
            message: 'map external dependency is not owned by module seeds: AOXFoundationKit',
            retryable: false,
            severity: 'warning',
          },
          {
            code: 'query-unavailable',
            message: 'map external dependency is not owned by module seeds: node:fs',
            retryable: false,
            severity: 'warning',
          },
        ],
        project: { projectRoot: repositoryRoot },
        queryLevel: 'map',
        refs: [],
      }),
    } as never;
    const repository = {
      relativeRoot: 'Core',
      repoId: 'core',
      scopeId: 'mr-alembic',
      sourceRoot: repositoryRoot,
    };
    const plan = createProjectContextRequestAuditPlans({
      repository,
      eligibleFiles: [
        {
          language: 'typescript',
          mode: '100644',
          ownerModuleIds: ['module:src'],
          relativePath: 'src/index.ts',
        },
      ],
    }).find((candidate) => candidate.kind === 'map')!;
    const ports = new NodeProjectContextFoundationHostPorts(projectContext, {
      portableRoots: [
        {
          portableId: 'sibling',
          sourceRoot: siblingRoot,
          moduleAliases: ['AOXFoundationKit'],
        },
      ],
    });
    const result = await ports.executeRequest({ repository, plan });

    expect(result.terminalStatus).toBe('failed');
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classification: 'confirmed-defect',
          typedReason: 'declared-internal-module-remained-unresolved',
        }),
        expect.objectContaining({ classification: 'advisory', relatedRepoId: 'sibling' }),
        expect.objectContaining({ classification: 'expected-external' }),
      ])
    );
    expect(result.errors.find((error) => error.message.includes('AOXFoundationKit'))).toMatchObject(
      { classification: 'advisory', relatedRepoId: 'sibling' }
    );
  });

  it('binds package ownership to module seeds and reconciles graph dependency output', async () => {
    const approvedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-facts-ownership-'));
    temporaryRoots.push(approvedRoot);
    const coreRoot = path.join(approvedRoot, 'Core');
    const agentRoot = path.join(approvedRoot, 'Agent');
    await fs.mkdir(coreRoot, { recursive: true });
    await fs.mkdir(agentRoot, { recursive: true });
    const evidenceHash = hashCanonicalJson({ packageJson: 1 });
    const ownership = createProjectContextDependencyOwnershipV1([
      {
        repoId: 'core',
        ownerModuleId: 'module:src',
        ownerPackageName: '@alembic/core',
        source: 'package-name',
        pattern: '@alembic/core',
        provenance: { relativePath: 'package.json', contentHash: evidenceHash },
      },
      {
        repoId: 'core',
        ownerModuleId: 'module:src',
        ownerPackageName: '@alembic/core',
        source: 'package-export',
        pattern: '@alembic/core/project-context',
        provenance: { relativePath: 'package.json', contentHash: evidenceHash },
      },
      {
        repoId: 'core',
        ownerModuleId: 'module:src',
        ownerPackageName: '@alembic/core',
        source: 'package-import',
        pattern: '#shared/*',
        targetPatterns: ['src/shared/*'],
        provenance: { relativePath: 'package.json', contentHash: evidenceHash },
      },
      {
        repoId: 'agent',
        ownerModuleId: 'module:src',
        ownerPackageName: '@alembic/agent',
        source: 'package-import',
        pattern: '#shared/*',
        targetPatterns: ['src/shared/*'],
        provenance: { relativePath: 'package.json', contentHash: evidenceHash },
      },
      {
        repoId: 'agent',
        ownerModuleId: 'module:src',
        ownerPackageName: '@alembic/agent',
        source: 'package-export',
        pattern: '@alembic/agent/*',
        provenance: { relativePath: 'package.json', contentHash: evidenceHash },
      },
    ]);
    const dependencyNames = [
      '@alembic/core/project-context',
      '#shared/value.js',
      '@alembic/agent/runtime',
      '@alembic/core/private',
      'node:fs',
    ];
    const projectContext = {
      execute: async () => ({
        contractVersion: 1,
        data: {
          dependencySummary: { edgeCount: 0, notes: ['external-dependencies:5'] },
          externalDependencyHotspots: dependencyNames.map((name) => ({ name, refs: [] })),
          modules: [],
        },
        errors: dependencyNames.map((dependencyName) => ({
          code: 'query-unavailable',
          message: `map external dependency is not owned by module seeds: ${dependencyName}`,
          retryable: false,
          severity: 'warning',
        })),
        project: { projectRoot: coreRoot },
        queryLevel: 'map',
        refs: [],
      }),
    } as never;
    const repository = {
      relativeRoot: 'Core',
      repoId: 'core',
      scopeId: 'mr-alembic',
      sourceRoot: coreRoot,
    };
    const plan = createProjectContextRequestAuditPlans({
      repository,
      dependencyOwnership: ownership,
      eligibleFiles: [
        {
          language: 'typescript',
          mode: '100644',
          ownerModuleIds: ['module:src'],
          relativePath: 'src/index.ts',
        },
        {
          language: 'typescript',
          mode: '100644',
          ownerModuleIds: ['module:src'],
          relativePath: 'src/shared/value.ts',
        },
      ],
    }).find((candidate) => candidate.kind === 'map')!;
    const ports = new NodeProjectContextFoundationHostPorts(projectContext, {
      dependencyOwnership: ownership,
      portableRoots: [{ portableId: 'agent', sourceRoot: agentRoot }],
    });

    const result = await ports.executeRequest({ repository, plan });
    const output = result.output as {
      data: {
        approvedSiblingDependencyHotspots: unknown[];
        dependencyOwnershipResolutions: Array<{ classification: string }>;
        externalDependencyHotspots: Array<{ name: string }>;
        internalDependencyNamespaceResolutions: unknown[];
      };
    };

    expect(JSON.stringify(plan.selector)).toContain('dependencyOwnershipBindings');
    expect(result.dependencyResolutions?.map((row) => row.classification).sort()).toEqual([
      'approved-sibling',
      'confirmed-defect',
      'expected-external',
      'internal-resolved',
      'internal-resolved',
    ]);
    expect(
      result.dependencyResolutions?.find((row) => row.dependencyName === '@alembic/agent/runtime')
    ).toMatchObject({
      classification: 'approved-sibling',
      ownerRepoId: 'agent',
      ownerModuleId: 'module:src',
    });
    expect(
      result.dependencyResolutions?.find((row) => row.dependencyName === '#shared/value.js')
    ).toMatchObject({ classification: 'internal-resolved', ownerRepoId: 'core' });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ classification: 'advisory', relatedRepoId: 'agent' }),
        expect.objectContaining({ classification: 'expected-external' }),
        expect.objectContaining({
          classification: 'confirmed-defect',
          typedReason: 'known-package-subpath-is-not-exported',
        }),
      ])
    );
    expect(output.data.externalDependencyHotspots.map((row) => row.name).sort()).toEqual([
      '@alembic/core/private',
      'node:fs',
    ]);
    expect(output.data.approvedSiblingDependencyHotspots).toHaveLength(1);
    expect(output.data.internalDependencyNamespaceResolutions).toHaveLength(2);
    expect(output.data.dependencyOwnershipResolutions).toHaveLength(3);
    expect(result.terminalStatus).toBe('failed');
  });

  it('fails capture when ownership provenance is not the certified inventory blob', async () => {
    const input = createCaptureInput();
    const descriptors = [
      {
        language: 'json',
        mode: '100644',
        ownerModuleIds: ['module:src'],
        relativePath: 'package.json',
      },
      {
        language: 'typescript',
        mode: '100644',
        ownerModuleIds: ['module:src'],
        relativePath: 'src/index.ts',
      },
      {
        language: 'typescript',
        mode: '100644',
        ownerModuleIds: ['module:src'],
        relativePath: 'src/worker.ts',
      },
    ];
    input.inventoryPolicy.includeExtensions = ['.json', '.ts'];
    input.requestPlans = createProjectContextRequestAuditPlans({
      repository: input.repositories[0]!,
      eligibleFiles: descriptors,
    });
    const packageBytes = Buffer.from('{"name":"@alembic/core"}\n');
    const basePorts = createHostPorts();
    const artifact = await captureCertifiedProjectFacts(input, {
      ...basePorts,
      enumerateEligibleFiles: async () => descriptors,
      readFile: async ({ relativePath }) =>
        relativePath === 'package.json'
          ? packageBytes
          : Buffer.from(
              relativePath === 'src/index.ts'
                ? 'export const alpha = 1;\n'
                : 'export const beta = 2;\n'
            ),
      executeRequest: async (request) => {
        const result = await basePorts.executeRequest(request);
        return request.plan.kind === 'map'
          ? {
              ...result,
              dependencyObservationCount: 1,
              dependencyGraphReconciliation: {
                approvedSiblingHotspotCount: 0,
                internalResolvedHotspotCount: 0,
                originalExternalHotspotCount: 0,
                remainingExternalHotspotCount: 0,
              },
              dependencyResolutions: [
                {
                  classification: 'internal-resolved',
                  dependencyName: '#shared/value.js',
                  importerRepoId: 'core',
                  matchedOwnershipKey: '#shared/*',
                  ownerModuleId: 'module:src',
                  ownerRepoId: 'core',
                  ownershipEvidenceHash: hashBytes(Buffer.from('not-package-json')),
                  ownershipProvenancePath: 'package.json',
                  ownershipSource: 'package-import',
                  requestKind: 'map',
                  resolvedTargets: [{ relativePath: 'src/index.ts' }],
                  typedReason: 'fixture-provenance-mismatch',
                },
              ],
            }
          : result;
      },
    });

    const mapOutcome = artifact.facts.requestOutcomes.find((row) => row.kind === 'map')!;
    expect(mapOutcome.terminalStatus).toBe('failed');
    expect(mapOutcome.errors[0]?.message).toMatch(
      /provenance is not bound to certified inventory/i
    );
    expect(artifact.readiness.verdict).toBe('failed');
  });

  it('binds the complete ownership catalog to inventory even when no diagnostic uses an entry', async () => {
    const input = createCaptureInput();
    const descriptors = [
      {
        language: 'json',
        mode: '100644',
        ownerModuleIds: ['module:src'],
        relativePath: 'package.json',
      },
      {
        language: 'typescript',
        mode: '100644',
        ownerModuleIds: ['module:src'],
        relativePath: 'src/index.ts',
      },
      {
        language: 'typescript',
        mode: '100644',
        ownerModuleIds: ['module:src'],
        relativePath: 'src/worker.ts',
      },
    ];
    const ownership = createProjectContextDependencyOwnershipV1([
      {
        repoId: 'core',
        ownerModuleId: 'module:src',
        ownerPackageName: '@alembic/core',
        source: 'package-name',
        pattern: '@alembic/core',
        provenance: {
          relativePath: 'package.json',
          contentHash: hashBytes(Buffer.from('{"name":"stale"}\n')),
        },
      },
    ]);
    input.inventoryPolicy.includeExtensions = ['.json', '.ts'];
    input.requestPlans = createProjectContextRequestAuditPlans({
      repository: input.repositories[0]!,
      eligibleFiles: descriptors,
      dependencyOwnership: ownership,
    });
    const basePorts = createHostPorts();
    const artifact = await captureCertifiedProjectFacts(input, {
      ...basePorts,
      enumerateEligibleFiles: async () => descriptors,
      readFile: async ({ relativePath }) =>
        Buffer.from(
          relativePath === 'package.json'
            ? '{"name":"@alembic/core"}\n'
            : relativePath === 'src/index.ts'
              ? 'export const alpha = 1;\n'
              : 'export const beta = 2;\n'
        ),
    });

    expect(artifact.readiness.errors).toContain(
      'dependency-ownership-catalog-provenance:core/@alembic/core'
    );
    expect(evaluateCertifiedProjectFactsReadiness(artifact, { expectedRepoIds: ['core'] }).ok).toBe(
      false
    );
  });

  it('fails readiness when original dependency observations are not conserved by resolutions', async () => {
    const basePorts = createHostPorts();
    const artifact = await captureCertifiedProjectFacts(createCaptureInput(), {
      ...basePorts,
      executeRequest: async (request) => ({
        ...(await basePorts.executeRequest(request)),
        dependencyObservationCount: request.plan.kind === 'map' ? 1 : 0,
        dependencyGraphReconciliation: {
          approvedSiblingHotspotCount: 0,
          internalResolvedHotspotCount: 0,
          originalExternalHotspotCount: 0,
          remainingExternalHotspotCount: 0,
        },
        dependencyResolutions: [],
      }),
    });

    expect(artifact.readiness.verdict).toBe('failed');
    expect(artifact.readiness.errors).toContain('dependency-observation-conservation:core/map');
  });

  it('fails readiness when map warnings and graph hotspots are not cross-conserved', async () => {
    const basePorts = createHostPorts();
    const artifact = await captureCertifiedProjectFacts(createCaptureInput(), {
      ...basePorts,
      executeRequest: async (request) => ({
        ...(await basePorts.executeRequest(request)),
        dependencyObservationCount: request.plan.kind === 'map' ? 1 : 0,
        dependencyGraphReconciliation: {
          approvedSiblingHotspotCount: 0,
          internalResolvedHotspotCount: 0,
          originalExternalHotspotCount: 0,
          remainingExternalHotspotCount: 0,
        },
        dependencyResolutions:
          request.plan.kind === 'map'
            ? [
                {
                  classification: 'expected-external',
                  dependencyName: 'node:fs',
                  importerRepoId: 'core',
                  requestKind: 'map',
                  typedReason: 'fixture-external',
                },
              ]
            : [],
      }),
    });

    expect(artifact.readiness.errors).toContain('dependency-warning-graph-alignment:core/map');
  });

  it('fails closed for a missing current owner seed and ambiguous public ownership', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-facts-ownership-defect-'));
    temporaryRoots.push(root);
    const evidenceHash = hashCanonicalJson({ packageJson: 'defect-fixture' });
    const ownership = createProjectContextDependencyOwnershipV1([
      {
        repoId: 'core',
        ownerModuleId: 'module:missing',
        ownerPackageName: '@alembic/core',
        source: 'package-name',
        pattern: '@alembic/core',
        provenance: { relativePath: 'package.json', contentHash: evidenceHash },
      },
      ...['agent', 'plugin'].map((repoId) => ({
        repoId,
        ownerModuleId: `module:${repoId}`,
        ownerPackageName: 'SharedKit',
        source: 'module-alias' as const,
        pattern: 'SharedKit',
        provenance: { relativePath: 'Package.swift', contentHash: evidenceHash },
      })),
    ]);
    const dependencies = ['@alembic/core', 'SharedKit'];
    const projectContext = {
      execute: async () => ({
        contractVersion: 1,
        data: {
          externalDependencyHotspots: dependencies.map((name) => ({ name, refs: [] })),
          modules: [],
        },
        errors: dependencies.map((dependencyName) => ({
          code: 'query-unavailable',
          message: `map external dependency is not owned by module seeds: ${dependencyName}`,
          retryable: false,
          severity: 'warning',
        })),
        project: { projectRoot: root },
        queryLevel: 'map',
        refs: [],
      }),
    } as never;
    const repository = {
      relativeRoot: '.',
      repoId: 'core',
      scopeId: 'mr-alembic',
      sourceRoot: root,
    };
    const plan = createProjectContextRequestAuditPlans({
      repository,
      dependencyOwnership: ownership,
      eligibleFiles: [
        {
          language: 'typescript',
          mode: '100644',
          ownerModuleIds: ['module:src'],
          relativePath: 'src/index.ts',
        },
      ],
    }).find((candidate) => candidate.kind === 'map')!;
    const result = await new NodeProjectContextFoundationHostPorts(projectContext, {
      dependencyOwnership: ownership,
    }).executeRequest({ repository, plan });

    expect(result.dependencyResolutions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classification: 'confirmed-defect',
          dependencyName: '@alembic/core',
          typedReason: 'certified-owner-module-is-missing-from-request-seeds',
        }),
        expect.objectContaining({
          classification: 'confirmed-defect',
          dependencyName: 'SharedKit',
          typedReason: 'dependency-ownership-is-ambiguous',
        }),
      ])
    );
    expect(result.errors?.every((error) => error.classification === 'confirmed-defect')).toBe(true);
    expect(result.terminalStatus).toBe('failed');
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

  it('replays an immutable publish interrupted after the atomic publish step', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-facts-store-crash-'));
    temporaryRoots.push(root);
    const artifact = await captureCertifiedProjectFacts(createCaptureInput(), createHostPorts());
    let injected = false;
    const crashingStore = new FileCertifiedProjectFactsStore(root, {
      logger: { info() {}, warn() {} },
      durability: {
        onStep(step: string) {
          if (!injected && step === 'immutable-after-publish') {
            injected = true;
            throw new Error('simulated-crash-after-publish');
          }
        },
      },
    } as never);

    await expect(crashingStore.put(artifact)).rejects.toThrow('simulated-crash-after-publish');
    expect(injected).toBe(true);
    const replayStore = new FileCertifiedProjectFactsStore(root, {
      logger: { info() {}, warn() {} },
    });
    await expect(replayStore.put(artifact)).resolves.toMatchObject({
      artifactId: artifact.artifactId,
    });
    await expect(
      replayStore.open(artifact.artifactId, artifact.certificationBindingHash)
    ).resolves.toEqual(artifact);
  });

  it('ignores an orphan temp after file fsync and refuses a partial immutable final', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-facts-store-partial-'));
    temporaryRoots.push(root);
    const artifact = await captureCertifiedProjectFacts(createCaptureInput(), createHostPorts());
    let injected = false;
    const crashingStore = new FileCertifiedProjectFactsStore(root, {
      logger: { info() {}, warn() {} },
      durability: {
        onStep(step) {
          if (!injected && step === 'immutable-after-temp-fsync') {
            injected = true;
            throw new Error('simulated-crash-after-temp-fsync');
          }
        },
      },
    });
    await expect(crashingStore.put(artifact)).rejects.toThrow('simulated-crash-after-temp-fsync');
    const blobEntries = await fs.readdir(path.join(root, 'blobs'));
    expect(blobEntries.some((entry) => entry.includes('.tmp-'))).toBe(true);

    const replayStore = new FileCertifiedProjectFactsStore(root, {
      logger: { info() {}, warn() {} },
    });
    await expect(replayStore.put(artifact)).resolves.toMatchObject({
      artifactId: artifact.artifactId,
    });

    const collisionRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'project-facts-store-collision-')
    );
    temporaryRoots.push(collisionRoot);
    const firstChunk = artifact.chunks[0]!;
    const partialFinal = path.join(
      collisionRoot,
      'blobs',
      firstChunk.blobHash.slice('sha256:'.length)
    );
    await fs.mkdir(path.dirname(partialFinal), { recursive: true });
    await fs.writeFile(partialFinal, 'partial-final');
    const collisionStore = new FileCertifiedProjectFactsStore(collisionRoot, {
      logger: { info() {}, warn() {} },
    });
    await expect(collisionStore.put(artifact)).rejects.toThrow(/collision/);
    await expect(fs.readFile(partialFinal, 'utf8')).resolves.toBe('partial-final');
  });

  it('replays lease acquisition and completion crashes without exposing partial JSON', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-facts-lease-crash-'));
    temporaryRoots.push(root);
    const silentLogger = { info() {}, warn() {} };
    const artifact = await captureCertifiedProjectFacts(createCaptureInput(), createHostPorts());
    const store = new FileCertifiedProjectFactsStore(root, { logger: silentLogger });
    await store.put(artifact);
    const preparation = await store.createPreparation(
      artifact.artifactId,
      artifact.certificationBindingHash
    );
    let acquireCrash = false;
    const crashingAcquire = new FileCertifiedProjectFactsStore(root, {
      logger: silentLogger,
      durability: {
        onStep(step) {
          if (!acquireCrash && step === 'lease-after-publish') {
            acquireCrash = true;
            throw new Error('simulated-lease-acquire-crash');
          }
        },
      },
    });
    await expect(
      crashingAcquire.acquireRunLease({
        preparationId: preparation.preparationId,
        runId: 'run-crash',
        expectedCertificationBindingHash: artifact.certificationBindingHash,
      })
    ).rejects.toThrow('simulated-lease-acquire-crash');
    const replay = new FileCertifiedProjectFactsStore(root, { logger: silentLogger });
    await expect(
      replay.acquireRunLease({
        preparationId: preparation.preparationId,
        runId: 'run-crash',
        expectedCertificationBindingHash: artifact.certificationBindingHash,
      })
    ).resolves.toMatchObject({ status: 'resumed' });
    await expect(
      replay.acquireRunLease({
        preparationId: preparation.preparationId,
        runId: 'other-run',
        expectedCertificationBindingHash: artifact.certificationBindingHash,
      })
    ).rejects.toBeInstanceOf(ProjectFactsLeaseConflictError);

    let completionCrash = false;
    const crashingCompletion = new FileCertifiedProjectFactsStore(root, {
      logger: silentLogger,
      durability: {
        onStep(step) {
          if (!completionCrash && step === 'replace-after-rename') {
            completionCrash = true;
            throw new Error('simulated-lease-completion-crash');
          }
        },
      },
    });
    await expect(
      crashingCompletion.completeRunLease({
        preparationId: preparation.preparationId,
        runId: 'run-crash',
        expectedCertificationBindingHash: artifact.certificationBindingHash,
      })
    ).rejects.toThrow('simulated-lease-completion-crash');
    await expect(
      replay.completeRunLease({
        preparationId: preparation.preparationId,
        runId: 'run-crash',
        expectedCertificationBindingHash: artifact.certificationBindingHash,
      })
    ).resolves.toMatchObject({ status: 'completed' });
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

function resignArtifactForIntegrityTest(
  artifact: Parameters<typeof verifyCertifiedProjectFactsArtifact>[0]
): void {
  const { detailContentHash: _detailContentHash, ...detailSemantic } = artifact.facts.detail;
  artifact.facts.detail.detailContentHash = hashCanonicalJson(detailSemantic);
  artifact.factsContentHash = hashCanonicalJson(artifact.facts);
  artifact.manifest.factsContentHash = artifact.factsContentHash;
  artifact.manifest.detailManifestHash = hashCanonicalJson(artifact.facts.detail);
  artifact.artifactId = `cpf-v1:${hashCanonicalJson(artifact.manifest).slice('sha256:'.length)}`;
  artifact.certificationBindingHash = hashCanonicalJson({
    artifactId: artifact.artifactId,
    factsContentHash: artifact.factsContentHash,
    sourceVectorHash: artifact.sourceVectorHash,
    readiness: artifact.readiness,
    ...artifact.certification,
  });
}

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
    verifySnapshot: async ({ candidate }) => ({
      version: 1,
      verified: true,
      binding:
        candidate.postRevision.kind === 'git' && !candidate.postRevision.dirty
          ? 'git-tree'
          : 'working-tree-content',
      finalRevision: candidate.postRevision,
      eligibleInventoryHash: candidate.eligibleInventoryHash,
      workingTreeContentHash: candidate.workingTreeContentHash,
      ...(candidate.postRevision.kind === 'git' && !candidate.postRevision.dirty
        ? { treeId: candidate.postRevision.treeId ?? undefined }
        : {}),
      typedReason: 'deterministic-test-snapshot-binding',
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

async function createTemporaryGitRepository(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-facts-git-snapshot-'));
  temporaryRoots.push(root);
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/index.ts'), 'export const value = "clean";\n');
  await execFileAsync('git', ['-C', root, 'init', '--quiet']);
  await execFileAsync('git', ['-C', root, 'config', 'user.email', 'pcf-test@example.invalid']);
  await execFileAsync('git', ['-C', root, 'config', 'user.name', 'PCF Test']);
  await execFileAsync('git', ['-C', root, 'add', 'src/index.ts']);
  await execFileAsync('git', ['-C', root, 'commit', '--quiet', '-m', 'fixture']);
  return root;
}
