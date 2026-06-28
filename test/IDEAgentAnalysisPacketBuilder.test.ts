import { describe, expect, it } from 'vitest';

import {
  BootstrapSession,
  buildHostAgentAnalysisPacketFromProjectContext,
  buildIDEAgentAnalysisPacketFromProjectContext,
  buildMissionBriefing,
  buildProjectContextMissionBriefing,
  createHostAgentAnalysisUnitKey,
  createIDEAgentAnalysisProgressSeed,
  createIDEAgentAnalysisUnitKey,
  type DimensionDef,
} from '../src/host-agent-workflows.js';
import {
  buildHostAgentAnalysisPacketFromProjectContext as buildHostAgentPacketFromRoot,
  buildProjectContextMissionBriefing as buildProjectContextMissionBriefingFromRoot,
  buildIDEAgentAnalysisPacketFromProjectContext as buildProjectContextPacketFromRoot,
} from '../src/index.js';
import {
  buildProjectContextPresenterInput,
  type ProjectContextEnvelope,
  type ProjectContextPresenterInput,
  type ProjectContextRef,
  type ProjectContextResult,
} from '../src/project-context.js';
import { buildProjectSnapshot } from '../src/types/projectSnapshotBuilder.js';
import {
  buildHostAgentAnalysisPacket,
  buildHostAgentAnalysisPacketFromSnapshot,
  buildIDEAgentAnalysisPacket,
} from '../src/workflows/capabilities/host-agent/HostAgentAnalysisPacketBuilder.js';
import { buildIDEAgentAnalysisPacketFromSnapshot } from '../src/workflows/capabilities/host-agent/IDEAgentAnalysisPacketBuilder.js';

const dimensions: DimensionDef[] = [
  { id: 'architecture', label: 'Architecture', guide: 'Find architectural boundaries' },
  {
    id: 'event-and-data-flow',
    label: 'Event and Data Flow',
    guide: 'Find call and data flow rules',
  },
];

function makeSnapshot(overrides: Partial<Parameters<typeof buildProjectSnapshot>[0]> = {}) {
  return buildProjectSnapshot({
    projectRoot: '/fixture',
    allFiles: [
      {
        name: 'UserService.ts',
        path: '/fixture/src/UserService.ts',
        relativePath: 'src/UserService.ts',
        content: 'SECRET_SOURCE_BODY_SHOULD_NOT_LEAK',
        targetName: 'core',
        language: 'typescript',
        priority: 'high',
      },
      {
        name: 'UserRepository.ts',
        path: '/fixture/src/UserRepository.ts',
        relativePath: 'src/UserRepository.ts',
        content: 'ANOTHER_SECRET_SOURCE_BODY_SHOULD_NOT_LEAK',
        targetName: 'core',
        language: 'typescript',
      },
    ],
    allTargets: [{ name: 'core', type: 'library' }],
    discoverer: { id: 'node', displayName: 'Node' },
    langStats: { ts: 2 },
    primaryLang: 'typescript',
    astProjectSummary: {
      classes: [
        {
          name: 'UserService',
          kind: 'class',
          relativePath: 'src/UserService.ts',
          methodCount: 1,
          methods: [
            {
              name: 'loadUser',
              className: 'UserService',
              file: 'src/UserService.ts',
              line: 12,
              complexity: 2,
            },
          ],
        },
      ],
      protocols: [{ name: 'UserRepository', relativePath: 'src/UserRepository.ts' }],
      projectMetrics: { totalMethods: 1 },
    },
    astContext: null,
    codeEntityResult: { entitiesUpserted: 3, edgesCreated: 2 },
    callGraphResult: { entitiesUpserted: 3, edgesCreated: 1 },
    panoramaResult: {
      layers: [{ level: 1, name: 'Domain', modules: ['core'] }],
      couplingHotspots: [{ module: 'core', fanIn: 2, fanOut: 1 }],
    },
    depGraphData: {
      nodes: [{ id: 'core', label: 'core', fileCount: 2 }],
      edges: [{ from: 'src/UserService.ts', to: 'src/UserRepository.ts', type: 'imports' }],
    },
    depEdgesWritten: 1,
    guardAudit: {
      files: [
        {
          filePath: 'src/UserService.ts',
          violations: [
            {
              ruleId: 'boundary',
              severity: 'warning',
              message: 'Service should not import UI',
              line: 12,
            },
          ],
        },
      ],
      summary: { totalWarnings: 1, warnings: 1, totalViolations: 1 },
    },
    activeDimensions: dimensions,
    localPackageModules: [
      {
        name: 'core',
        packageName: 'core',
        fileCount: 2,
        inferredRole: 'domain',
        keyFiles: ['src/UserService.ts'],
      },
    ],
    warnings: [],
    ...overrides,
  });
}

function makeProjectContextEnvelopes(): ProjectContextEnvelope<ProjectContextResult>[] {
  const project = {
    projectRoot: '/fixture',
    displayName: 'Fixture Project',
  };
  const fileRef = {
    id: 'pc:file:src/UserService.ts',
    kind: 'file' as const,
    label: 'UserService.ts',
    scope: { projectRoot: project.projectRoot, filePath: 'src/UserService.ts', repoId: 'core' },
  };
  const symbolRef = {
    id: 'pc:symbol:UserService',
    kind: 'symbol' as const,
    label: 'UserService',
    parentRef: fileRef.id,
    scope: {
      projectRoot: project.projectRoot,
      filePath: 'src/UserService.ts',
      range: { startLine: 1, endLine: 8 },
      repoId: 'core',
    },
  };
  const repoRef = {
    id: 'pc:repo:core',
    kind: 'repo' as const,
    label: 'core',
    scope: { projectRoot: project.projectRoot, repoId: 'core' },
  };
  const moduleRef = {
    id: 'pc:module:service',
    kind: 'module' as const,
    label: 'service',
    scope: { projectRoot: project.projectRoot, sourceFolder: 'src', repoId: 'core' },
  };
  const layerRef = {
    id: 'pc:module-layer:domain',
    kind: 'module-layer' as const,
    label: 'Domain',
    scope: { projectRoot: project.projectRoot, sourceFolder: 'src', repoId: 'core' },
  };

  return [
    {
      contractVersion: 1,
      project,
      queryLevel: 'repo',
      refs: [repoRef, fileRef],
      data: {
        repo: { id: 'core', name: 'core', root: '/fixture', ref: repoRef },
        languages: [{ language: 'typescript', fileCount: 2 }],
        buildSystems: [{ kind: 'node', configRefs: [fileRef] }],
        packageSystems: [{ kind: 'npm', manifestRefs: [fileRef] }],
        targets: [{ name: 'core', kind: 'library', refs: [fileRef] }],
        localPackages: [{ name: 'core', path: 'src', ref: moduleRef }],
        sourceRoots: [{ path: 'src', role: 'source', ref: moduleRef }],
        entrypoints: [{ name: 'src/UserService.ts', kind: 'file', refs: [fileRef] }],
        commands: [],
        topAreas: [{ path: 'src', role: 'source', ref: moduleRef }],
        configFiles: [],
        nextRefs: [moduleRef],
      },
    },
    {
      contractVersion: 1,
      project,
      queryLevel: 'map',
      refs: [repoRef, moduleRef, layerRef, fileRef],
      data: {
        repo: { id: 'core', name: 'core', root: '/fixture', ref: repoRef },
        modules: [
          {
            id: 'service',
            name: 'service',
            configLayer: 'domain',
            ownedFileCount: 1,
            role: 'domain service',
            ref: moduleRef,
          },
        ],
        layers: [{ id: 'domain', name: 'Domain', order: 1, ref: layerRef }],
        dependencySummary: { edgeCount: 1, notes: ['ProjectContext relation summary'] },
        cycles: [],
        hotspots: [{ ref: moduleRef, score: 5, reason: 'public surface' }],
        majorFlows: [{ refs: [moduleRef, fileRef], summary: 'service owns user loading' }],
        externalDependencyHotspots: [],
        nextRefs: [fileRef],
      },
    },
    {
      contractVersion: 1,
      project,
      queryLevel: 'file-symbols',
      refs: [fileRef, symbolRef],
      data: {
        file: { filePath: 'src/UserService.ts', language: 'typescript', ref: fileRef },
        symbols: [
          {
            name: 'UserService',
            kind: 'class',
            filePath: 'src/UserService.ts',
            range: { startLine: 1, endLine: 8 },
            ref: symbolRef,
            exported: true,
          },
        ],
        naming: { warnings: [] },
        nextRefs: [symbolRef],
      },
    },
    {
      contractVersion: 1,
      project,
      queryLevel: 'file-flow',
      refs: [fileRef, symbolRef],
      data: {
        file: { filePath: 'src/UserService.ts', language: 'typescript', ref: fileRef },
        imports: [],
        exports: [
          {
            name: 'UserService',
            kind: 'class',
            filePath: 'src/UserService.ts',
            ref: symbolRef,
          },
        ],
        callers: [],
        callees: [],
        inflow: [],
        outflow: [],
        nextRefs: [symbolRef],
      },
    },
    {
      contractVersion: 1,
      project,
      queryLevel: 'source-slice',
      refs: [fileRef],
      data: {
        file: { filePath: 'src/UserService.ts', language: 'typescript', ref: fileRef },
        range: { startLine: 1, endLine: 8 },
        text: 'PROJECT_CONTEXT_SOURCE_BODY_SHOULD_NOT_LEAK',
        nextRefs: [symbolRef],
      },
    },
  ];
}

function makeProjectContextTargetFileCountFixture(): ProjectContextPresenterInput {
  const project = {
    projectRoot: '/fixture/bilidili',
    displayName: 'BiliDili',
  };
  const ref = (
    kind: ProjectContextRef['kind'],
    id: string,
    label: string,
    filePath?: string
  ): ProjectContextRef => ({
    id,
    kind,
    label,
    scope: {
      projectRoot: project.projectRoot,
      ...(filePath ? { filePath } : {}),
      repoId: 'bilidili',
    },
  });
  const packageRef = ref('path', 'pc:path:Package.swift', 'Package.swift', 'Package.swift');
  const legacyRef = ref('path', 'pc:path:legacy', 'LegacyBridge', 'LegacyBridge');
  const legacyHeadersRef = ref('path', 'pc:path:legacy-headers', 'LegacyHeaders', 'LegacyHeaders');
  const networkFiles = ['NetworkClient.swift', 'HTTPTransport.swift', 'RequestBuilder.swift'].map(
    (fileName) => ({
      filePath: `Packages/AOXNetworkKit/Sources/${fileName}`,
      language: 'swift',
      ref: ref(
        'file',
        `pc:file:aox-network:${fileName}`,
        fileName,
        `Packages/AOXNetworkKit/Sources/${fileName}`
      ),
    })
  );
  const foundationFiles = ['Logger.swift', 'ResultExtensions.swift'].map((fileName) => ({
    filePath: `Packages/AOXFoundationKit/Sources/${fileName}`,
    language: 'swift',
    ref: ref(
      'file',
      `pc:file:aox-foundation:${fileName}`,
      fileName,
      `Packages/AOXFoundationKit/Sources/${fileName}`
    ),
  }));

  return {
    project,
    envelopes: [],
    refs: [],
    files: [...networkFiles, ...foundationFiles],
    warnings: [],
    unavailable: [],
    repo: {
      repo: { id: 'bilidili', name: 'BiliDili', root: '/fixture/bilidili' },
      languages: [{ language: 'swift', fileCount: 5 }],
      buildSystems: [{ kind: 'spm', configRefs: [packageRef] }],
      packageSystems: [{ kind: 'spm', manifestRefs: [packageRef] }],
      targets: [
        { name: 'AOXNetworkKit', kind: 'library', refs: [packageRef] },
        { name: 'AOXFoundationKit', kind: 'library', refs: [packageRef] },
        { name: 'LegacyBridge', kind: 'library', refs: [legacyRef, legacyHeadersRef] },
      ],
      localPackages: [],
      sourceRoots: [{ path: 'Packages' }],
      entrypoints: [],
      commands: [],
      topAreas: [{ path: 'Packages/AOXNetworkKit' }, { path: 'Packages/AOXFoundationKit' }],
      configFiles: [{ path: 'Package.swift', kind: 'spm', ref: packageRef }],
      nextRefs: [],
    },
    modules: [
      {
        module: {
          id: 'aox-network',
          name: 'AOXNetworkKit',
          role: 'networking',
          ownedFileCount: networkFiles.length,
          ref: ref('module', 'pc:module:aox-network', 'AOXNetworkKit'),
        },
        ownedFiles: networkFiles,
        publicSurfaces: [],
        inflow: [],
        outflow: [],
        nextRefs: [],
      },
      {
        module: {
          id: 'aox-foundation',
          name: 'AOXFoundationKit',
          role: 'core',
          ownedFileCount: foundationFiles.length,
          ref: ref('module', 'pc:module:aox-foundation', 'AOXFoundationKit'),
        },
        ownedFiles: foundationFiles,
        publicSurfaces: [],
        inflow: [],
        outflow: [],
        nextRefs: [],
      },
    ],
    moduleLayers: [],
    fileFlows: [],
    fileSymbols: [],
    sourceSlices: [],
    anchorRanges: [],
  };
}

describe('HostAgentAnalysisPacketBuilder', () => {
  it('keeps snapshot packet builders internal while exposing new and legacy ProjectContext public entrypoints', async () => {
    const rootModule = (await import('../src/index.js')) as Record<string, unknown>;
    const hostAgentModule = (await import('../src/host-agent-workflows.js')) as Record<
      string,
      unknown
    >;

    expect(buildHostAgentAnalysisPacket).toBeInstanceOf(Function);
    expect(buildIDEAgentAnalysisPacket).toBe(buildHostAgentAnalysisPacket);
    expect(buildHostAgentAnalysisPacketFromSnapshot).toBeInstanceOf(Function);
    expect(buildIDEAgentAnalysisPacketFromSnapshot).toBe(buildHostAgentAnalysisPacketFromSnapshot);
    expect(buildHostAgentAnalysisPacketFromProjectContext).toBe(
      buildIDEAgentAnalysisPacketFromProjectContext
    );
    expect(buildHostAgentPacketFromRoot).toBe(buildProjectContextPacketFromRoot);
    expect(Object.hasOwn(rootModule, 'buildIDEAgentAnalysisPacket')).toBe(false);
    expect(Object.hasOwn(rootModule, 'buildHostAgentAnalysisPacket')).toBe(false);
    expect(Object.hasOwn(rootModule, 'buildIDEAgentAnalysisPacketFromSnapshot')).toBe(false);
    expect(Object.hasOwn(rootModule, 'buildHostAgentAnalysisPacketFromSnapshot')).toBe(false);
    expect(Object.hasOwn(hostAgentModule, 'buildIDEAgentAnalysisPacket')).toBe(false);
    expect(Object.hasOwn(hostAgentModule, 'buildHostAgentAnalysisPacket')).toBe(false);
    expect(Object.hasOwn(hostAgentModule, 'buildIDEAgentAnalysisPacketFromSnapshot')).toBe(false);
    expect(Object.hasOwn(hostAgentModule, 'buildHostAgentAnalysisPacketFromSnapshot')).toBe(false);
    expect(buildHostAgentPacketFromRoot).toBeInstanceOf(Function);
    expect(buildProjectContextPacketFromRoot).toBeInstanceOf(Function);
    expect(buildProjectContextMissionBriefingFromRoot).toBeInstanceOf(Function);
  });

  it('builds deterministic packet units without leaking source bodies', () => {
    const snapshot = makeSnapshot();
    const first = buildHostAgentAnalysisPacketFromSnapshot(snapshot, {
      generatedAt: '2026-05-31T00:00:00.000Z',
      maxUnits: 2,
    });
    const second = buildHostAgentAnalysisPacketFromSnapshot(snapshot, {
      generatedAt: '2026-05-31T00:00:00.000Z',
      maxUnits: 2,
    });

    expect(first).toStrictEqual(second);
    expect(first.meta).toMatchObject({
      compressionIndependent: true,
      builder: 'HostAgentAnalysisPacketBuilder',
      source: 'project-snapshot',
    });
    expect(first.units).toHaveLength(2);
    expect(first.units[0]).toMatchObject({
      dimensionId: 'architecture',
      completionContract: {
        mustReferenceAssignedSources: true,
        allowNoRecipeWithReason: true,
      },
    });
    expect(first.units[0]?.requiredReadSet).toContain('src/UserService.ts');
    expect(first.sourceRefs.map((ref) => ref.path)).toContain('src/UserService.ts');
    expect(first.structuralEvidenceRefs.map((ref) => ref.kind)).toEqual(
      expect.arrayContaining(['ast', 'dependency'])
    );
    expect(JSON.stringify(first)).not.toContain('SECRET_SOURCE_BODY_SHOULD_NOT_LEAK');
  });

  it('also accepts ProjectIntelligence run result shape', () => {
    const snapshot = makeSnapshot();
    const result = {
      projectRoot: snapshot.projectRoot,
      allFiles: snapshot.allFiles,
      langStats: snapshot.language.stats,
      primaryLang: snapshot.language.primaryLang,
      discoverer: snapshot.discoverer,
      allTargets: snapshot.allTargets,
      truncated: snapshot.truncated,
      astProjectSummary: snapshot.ast,
      astContext: snapshot.astContext,
      codeEntityResult: snapshot.codeEntityGraph,
      callGraphResult: snapshot.callGraph,
      depGraphData: snapshot.dependencyGraph,
      depEdgesWritten: snapshot.depEdgesWritten,
      guardAudit: snapshot.guardAudit,
      activeDimensions: snapshot.activeDimensions,
      enhancementPackInfo: snapshot.enhancementPackInfo,
      enhancementPatterns: snapshot.enhancementPatterns,
      enhancementGuardRules: snapshot.enhancementGuardRules,
      langProfile: snapshot.langProfile,
      detectedFrameworks: snapshot.detectedFrameworks,
      targetsSummary: snapshot.targetsSummary,
      localPackageModules: snapshot.localPackageModules,
      warnings: snapshot.warnings,
      report: snapshot.phaseReport,
      incrementalPlan: snapshot.incrementalPlan,
      panoramaResult: snapshot.panorama,
      isEmpty: snapshot.isEmpty,
    };

    const packet = buildHostAgentAnalysisPacket({
      result,
      options: { generatedAt: '2026-05-31T00:00:00.000Z', projectRoot: snapshot.projectRoot },
    });

    expect(packet.meta.source).toBe('project-intelligence-result');
    expect(packet.requiredReadSet).toContain('src/UserService.ts');
  });

  it('builds ProjectContext-backed packet units without ProjectSnapshot or source body leakage', () => {
    const presenterInput = buildProjectContextPresenterInput(makeProjectContextEnvelopes());
    const packet = buildHostAgentAnalysisPacketFromProjectContext({
      projectContext: presenterInput,
      dimensions,
      options: { generatedAt: '2026-06-15T00:00:00.000Z', maxUnits: 2 },
    });

    expect(packet.meta.source).toBe('project-context');
    expect(packet.requiredReadSet).toContain('core/src/UserService.ts');
    expect(packet.retrievalHints.structureTools).toContain('ProjectContext.execute');
    expect(packet.retrievalHints.structureTools).not.toContain('alembic_call_context');
    expect(packet.projectSummary.materialization).toMatchObject({
      projectContext: true,
      repo: true,
      map: true,
      fileSymbols: 1,
      sourceSlices: 1,
    });
    expect(packet.structuralEvidenceRefs.map((ref) => ref.kind)).toContain('project-context');
    expect(packet.units[0]?.structuralHints.projectContext).toEqual(
      expect.arrayContaining(['typescript files=2', 'module:service'])
    );
    expect(JSON.stringify(packet)).not.toContain('PROJECT_CONTEXT_SOURCE_BODY_SHOULD_NOT_LEAK');
  });

  it('builds Mission Briefing from ProjectContext presenter input without snapshot data', () => {
    const session = new BootstrapSession({
      projectRoot: '/fixture',
      dimensions,
    });
    const briefing = buildProjectContextMissionBriefing({
      projectContext: makeProjectContextEnvelopes(),
      activeDimensions: dimensions,
      session,
    }) as Record<string, unknown>;

    expect(briefing.meta).toMatchObject({
      projectInformationSource: 'project-context',
      projectContextEnvelopeCount: 5,
    });
    expect(briefing.projectMeta).toMatchObject({
      name: 'Fixture Project',
      primaryLanguage: 'typescript',
      projectInformationSource: 'project-context',
    });
    expect(briefing.projectContext).toMatchObject({
      source: 'project-context',
      sourceFiles: [{ filePath: 'src/UserService.ts', language: 'typescript' }],
    });
    expect(JSON.stringify(briefing)).not.toContain('PROJECT_CONTEXT_SOURCE_BODY_SHOULD_NOT_LEAK');
  });

  it('builds ProjectContext target file counts from module owned files before anchor refs', () => {
    const session = new BootstrapSession({
      projectRoot: '/fixture/bilidili',
      dimensions,
    });
    const briefing = buildProjectContextMissionBriefing({
      projectContext: makeProjectContextTargetFileCountFixture(),
      activeDimensions: dimensions,
      session,
    }) as {
      targets: { name: string; fileCount?: number }[];
      architectureOverview: {
        layers: { name: string; modules: string[]; fileCount: number }[];
        keyInsights: string[];
      } | null;
    };
    const targetsByName = new Map(briefing.targets.map((target) => [target.name, target]));

    expect(targetsByName.get('AOXNetworkKit')).toMatchObject({ fileCount: 3 });
    expect(targetsByName.get('AOXFoundationKit')).toMatchObject({ fileCount: 2 });
    expect(targetsByName.get('LegacyBridge')).toMatchObject({ fileCount: 2 });
    expect(briefing.architectureOverview?.layers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Other',
          modules: ['AOXNetworkKit', 'AOXFoundationKit', 'LegacyBridge'],
          fileCount: 7,
        }),
      ])
    );
    expect(briefing.architectureOverview?.keyInsights).toContain(
      '2 local packages provide 71% of the codebase (5/7 files)'
    );
  });

  it('keeps packet evidence independent from Mission Briefing compression', () => {
    const largeDimensions = Array.from({ length: 16 }, (_, index) => ({
      id: `dimension-${index}`,
      label: `Dimension ${index}`,
      guide: 'Large analysis guide '.repeat(30),
    }));
    const snapshot = makeSnapshot({
      activeDimensions: largeDimensions,
      astProjectSummary: {
        classes: Array.from({ length: 40 }, (_, index) => ({
          name: `LargeClass${index}`,
          kind: 'class',
          file: `src/LargeClass${index}.ts`,
          relativePath: `src/LargeClass${index}.ts`,
          methodCount: 1,
        })),
      },
    });
    const packet = buildHostAgentAnalysisPacketFromSnapshot(snapshot, {
      generatedAt: '2026-05-31T00:00:00.000Z',
      maxUnits: 3,
    });
    const session = new BootstrapSession({
      projectRoot: snapshot.projectRoot,
      dimensions: largeDimensions,
    });
    const briefing = buildMissionBriefing({
      projectMeta: {
        name: 'fixture',
        primaryLanguage: 'typescript',
        fileCount: snapshot.allFiles.length,
        projectType: 'node',
      },
      astData: snapshot.ast,
      codeEntityResult: snapshot.codeEntityGraph,
      callGraphResult: snapshot.callGraph,
      depGraphData: snapshot.dependencyGraph,
      guardAudit: snapshot.guardAudit,
      targets: snapshot.targetsSummary,
      activeDimensions: largeDimensions,
      session,
      responseBudget: { limitBytes: 600 },
    }) as {
      ast: { classes: Array<{ file?: string }> };
      dimensions: Array<{ evidenceStarters?: unknown }>;
      meta?: { compressionLevel?: string };
    };

    expect(briefing.meta?.compressionLevel).toBe('aggressive');
    expect(briefing.ast.classes[0]?.file).toBeUndefined();
    expect(briefing.dimensions[0]?.evidenceStarters).toBeUndefined();
    expect(packet.requiredReadSet.length).toBeGreaterThan(0);
    expect(packet.sourceRefs.some((ref) => ref.path.startsWith('src/'))).toBe(true);
    expect(packet.structuralEvidenceRefs.length).toBeGreaterThan(0);
  });

  it('handles legacy raw panorama shape with layers.levels, modules Map, and cycles', () => {
    const packet = buildHostAgentAnalysisPacketFromSnapshot(
      makeSnapshot({
        panoramaResult: {
          layers: {
            levels: [{ level: 2, name: 'Services', modules: ['AuthService', 'UserRepository'] }],
          },
          modules: new Map([
            ['AuthService', { name: 'AuthService', fanIn: 12, fanOut: 1 }],
            ['UserRepository', { name: 'UserRepository', fanIn: 1, fanOut: 0 }],
          ]),
          cycles: [{ modules: ['AuthService', 'UserRepository'], severity: 'warning' }],
        },
      }),
      {
        generatedAt: '2026-05-31T00:00:00.000Z',
      }
    );
    const panoramaHints = packet.units.flatMap((unit) => unit.structuralHints.panorama ?? []);

    expect(panoramaHints).toEqual(
      expect.arrayContaining([
        'L2 Services: AuthService, UserRepository',
        'AuthService fanIn=12 fanOut=1',
        'warning: AuthService -> UserRepository',
      ])
    );
  });

  it('uses sourceRef/fqn/entity/line for stable keys and keeps short aliases display-only', () => {
    const first = createHostAgentAnalysisUnitKey({
      sourceRef: 'src/a/UserService.ts:12',
      fqn: 'src/a/UserService.ts::UserService.load',
      entityType: 'method',
      line: 12,
      symbol: 'load',
    });
    const second = createIDEAgentAnalysisUnitKey({
      sourceRef: 'src/b/UserService.ts:12',
      fqn: 'src/b/UserService.ts::UserService.load',
      entityType: 'method',
      line: 12,
      symbol: 'load',
    });

    expect(first.shortAlias).toBe('load');
    expect(second.shortAlias).toBe('load');
    expect(first.key).not.toBe(second.key);
  });

  it('uses repo-qualified source refs for ProjectScope packets with duplicate short paths', () => {
    const snapshot = makeSnapshot({
      astProjectSummary: null,
      allFiles: [
        {
          name: 'index.ts',
          path: '/workspace/AlembicCore/lib/index.ts',
          relativePath: 'lib/index.ts',
          sourceIdentity: {
            absolutePath: '/workspace/AlembicCore/lib/index.ts',
            folderDisplayName: 'AlembicCore',
            folderId: 'folder-core',
            folderPath: '/workspace/AlembicCore',
            folderRelativeRoot: 'AlembicCore',
            projectScopeId: 'scope-a',
            qualifiedPath: 'AlembicCore/lib/index.ts',
            relativePath: 'lib/index.ts',
          },
          content: 'export const core = 1;',
          targetName: 'AlembicCore:core',
        },
        {
          name: 'index.ts',
          path: '/workspace/AlembicPlugin/lib/index.ts',
          relativePath: 'lib/index.ts',
          sourceIdentity: {
            absolutePath: '/workspace/AlembicPlugin/lib/index.ts',
            folderDisplayName: 'AlembicPlugin',
            folderId: 'folder-plugin',
            folderPath: '/workspace/AlembicPlugin',
            folderRelativeRoot: 'AlembicPlugin',
            projectScopeId: 'scope-a',
            qualifiedPath: 'AlembicPlugin/lib/index.ts',
            relativePath: 'lib/index.ts',
          },
          content: 'export const plugin = 1;',
          targetName: 'AlembicPlugin:plugin',
        },
      ],
      localPackageModules: [],
      depGraphData: null,
      guardAudit: null,
    });

    const packet = buildHostAgentAnalysisPacketFromSnapshot(snapshot, {
      generatedAt: '2026-06-01T00:00:00.000Z',
      maxUnits: 1,
    });
    const coreKey = createHostAgentAnalysisUnitKey({
      sourceRef: 'lib/index.ts',
      qualifiedPath: 'AlembicCore/lib/index.ts',
      folderId: 'folder-core',
      entityType: 'file',
    });
    const pluginKey = createIDEAgentAnalysisUnitKey({
      sourceRef: 'lib/index.ts',
      qualifiedPath: 'AlembicPlugin/lib/index.ts',
      folderId: 'folder-plugin',
      entityType: 'file',
    });

    expect(packet.requiredReadSet).toEqual(
      expect.arrayContaining(['AlembicCore/lib/index.ts', 'AlembicPlugin/lib/index.ts'])
    );
    expect(packet.sourceRefs.map((ref) => ref.qualifiedPath)).toEqual(
      expect.arrayContaining(['AlembicCore/lib/index.ts', 'AlembicPlugin/lib/index.ts'])
    );
    expect(coreKey.key).not.toBe(pluginKey.key);
  });

  it('surfaces degraded AST, callgraph, and dependency graph warnings', () => {
    const snapshot = makeSnapshot({
      astProjectSummary: null,
      callGraphResult: null,
      depGraphData: null,
      warnings: ['AST analysis partially failed', 'Call Graph failed on unsupported syntax'],
    });

    const packet = buildHostAgentAnalysisPacketFromSnapshot(snapshot, {
      generatedAt: '2026-05-31T00:00:00.000Z',
    });

    expect(packet.projectSummary.degraded).toEqual(
      expect.arrayContaining([
        'ast-unavailable',
        'ast-partial',
        'callgraph-unavailable',
        'depgraph-unavailable',
      ])
    );
    expect(packet.projectSummary.warnings.join('\n')).toContain('AST analysis partially failed');
    expect(packet.units[0]?.degraded).toEqual(expect.arrayContaining(['ast-unavailable']));
    expect(packet.units[0]?.warnings.join('\n')).toContain('callgraph-unavailable');
  });

  it('seeds unit progress with checkpoint linkage without choosing persistence', () => {
    const packet = buildHostAgentAnalysisPacketFromSnapshot(makeSnapshot(), {
      generatedAt: '2026-05-31T00:00:00.000Z',
    });
    const progress = createIDEAgentAnalysisProgressSeed({
      packetId: packet.packetId,
      units: packet.units,
    });

    expect(progress).toMatchObject({
      checkpointKind: 'ide-agent-analysis-unit-progress',
      totalUnits: packet.units.length,
      remainingUnitIds: packet.units.map((unit) => unit.unitId),
    });
    expect(progress.unitProgress[0]).toMatchObject({
      status: 'pending',
      submittedRecipeIds: [],
      referencedFiles: [],
      rejectedReasons: [],
      checkpoint: {
        checkpointKind: 'dimension-checkpoint',
        dimensionId: packet.units[0]?.dimensionId,
      },
    });
  });
});
