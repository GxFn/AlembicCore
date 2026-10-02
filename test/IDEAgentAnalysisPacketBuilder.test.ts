import { describe, expect, it } from 'vitest';

import {
  buildHostAgentAnalysisPacketFromProjectContext,
  buildIDEAgentAnalysisPacketFromProjectContext,
  buildMissionBriefing,
  buildProjectContextMissionBriefing,
  createHostAgentAnalysisUnitKey,
  createIDEAgentAnalysisProgressSeed,
  createIDEAgentAnalysisUnitKey,
  type DimensionDef,
  GenerateSession,
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

const dimensions: DimensionDef[] = [
  { id: 'architecture', label: 'Architecture', guide: 'Find architectural boundaries' },
  {
    id: 'event-and-data-flow',
    label: 'Event and Data Flow',
    guide: 'Find call and data flow rules',
  },
];

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
  it('exposes only the ProjectContext packet entrypoints, under new and legacy names', async () => {
    const rootModule = (await import('../src/index.js')) as Record<string, unknown>;
    const hostAgentModule = (await import('../src/host-agent-workflows.js')) as Record<
      string,
      unknown
    >;
    const builderModule = (await import(
      '../src/workflows/surfaces/host-agent/briefing/HostAgentAnalysisPacketBuilder.js'
    )) as Record<string, unknown>;

    // 基于项目快照的分析包入口已删除：连实现文件都不再有它们。
    expect(Object.hasOwn(builderModule, 'buildHostAgentAnalysisPacket')).toBe(false);
    expect(Object.hasOwn(builderModule, 'buildHostAgentAnalysisPacketFromSnapshot')).toBe(false);
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
    const session = new GenerateSession({
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

  it('preserves ProjectContext panorama layers, hotspots, and cycles in the public briefing', () => {
    const projectContext = buildProjectContextPresenterInput(makeProjectContextEnvelopes());
    projectContext.map!.cycles = [
      {
        refs: [projectContext.map!.modules[0].ref!, projectContext.map!.layers[0].ref!],
        summary: 'service-domain cycle',
      },
    ];
    const briefing = buildProjectContextMissionBriefing({
      projectContext,
      activeDimensions: dimensions,
      session: { toJSON: () => ({ id: 'panorama-session' }) },
    });

    expect(briefing.panorama).toEqual({
      layers: [{ level: 1, name: 'Domain', modules: ['service'] }],
      couplingHotspots: [{ module: 'service', fanIn: 5, fanOut: 0 }],
      cyclicDependencies: [{ cycle: ['service', 'Domain'], severity: 'service-domain cycle' }],
      knowledgeGaps: [],
    });
  });

  it('keeps legacy raw panorama projection compatible with normalized snapshot input', () => {
    const layers = [{ level: 1, name: 'Domain', modules: ['service'] }];
    const couplingHotspots = [{ module: 'service', fanIn: 12, fanOut: 2 }];
    const cyclicDependencies = [{ cycle: ['service', 'storage'], severity: 'warning' }];
    const build = (panoramaResult: Record<string, unknown>) =>
      buildMissionBriefing({
        projectMeta: { primaryLanguage: 'typescript' },
        activeDimensions: dimensions,
        session: { toJSON: () => ({ id: 'panorama-session' }) },
        panoramaResult,
      }).panorama;

    const legacy = build({
      layers: { levels: layers },
      modules: new Map([['service', { name: 'service', fanIn: 12, fanOut: 2 }]]),
      cycles: cyclicDependencies,
    });
    expect(legacy).toEqual({ layers, couplingHotspots, cyclicDependencies, knowledgeGaps: [] });
    expect(build({ layers, couplingHotspots, cyclicDependencies })).toEqual(legacy);
  });

  it('uses repository language totals without adding overlapping sampled files', () => {
    const projectContext = buildProjectContextPresenterInput(makeProjectContextEnvelopes());
    projectContext.files.push(
      { filePath: 'scripts/one.py', language: 'python' },
      { filePath: 'scripts/two.py', language: 'python' }
    );
    const build = () =>
      buildProjectContextMissionBriefing({
        projectContext,
        activeDimensions: dimensions,
        session: { toJSON: () => ({ id: 'language-session' }) },
      });

    expect(build().languageStats).toEqual({ python: 2, typescript: 2 });
    projectContext.repo = undefined;
    expect(build().languageStats).toEqual({ python: 2, typescript: 1 });
  });

  it('builds ProjectContext target file counts from module owned files before anchor refs', () => {
    const session = new GenerateSession({
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
    const projectContext = buildProjectContextPresenterInput(makeProjectContextEnvelopes());
    const packet = buildHostAgentAnalysisPacketFromProjectContext({
      projectContext,
      dimensions: largeDimensions,
      options: { generatedAt: '2026-05-31T00:00:00.000Z', maxUnits: 3 },
    });
    const session = new GenerateSession({
      projectRoot: '/fixture',
      dimensions: largeDimensions,
    });
    const briefing = buildProjectContextMissionBriefing({
      projectContext,
      activeDimensions: largeDimensions,
      session,
      responseBudget: { limitBytes: 600 },
    }) as {
      dimensions: Array<{ evidenceStarters?: unknown }>;
      meta?: { compressionLevel?: string };
    };

    // 简报被压到最狠的一档，证据启发被去掉；分析包不走这套压缩，读集与证据引用都还在。
    expect(briefing.meta?.compressionLevel).toBe('aggressive');
    expect(briefing.dimensions[0]?.evidenceStarters).toBeUndefined();
    expect(packet.units).toHaveLength(3);
    expect(packet.requiredReadSet.length).toBeGreaterThan(0);
    expect(packet.sourceRefs.some((ref) => ref.path.includes('src/'))).toBe(true);
    expect(packet.structuralEvidenceRefs.length).toBeGreaterThan(0);
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

  it('keeps unit keys distinct for the same short path in two ProjectScope folders', () => {
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

    expect(coreKey.key).not.toBe(pluginKey.key);
  });

  it('seeds unit progress with checkpoint linkage without choosing persistence', () => {
    const packet = buildHostAgentAnalysisPacketFromProjectContext({
      projectContext: makeProjectContextEnvelopes(),
      dimensions,
      options: { generatedAt: '2026-05-31T00:00:00.000Z' },
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
