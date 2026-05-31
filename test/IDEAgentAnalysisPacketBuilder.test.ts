import { describe, expect, it } from 'vitest';

import {
  BootstrapSession,
  buildIDEAgentAnalysisPacket,
  buildIDEAgentAnalysisPacketFromSnapshot,
  buildMissionBriefing,
  createIDEAgentAnalysisProgressSeed,
  createIDEAgentAnalysisUnitKey,
  type DimensionDef,
} from '../src/host-agent-workflows.js';
import {
  buildIDEAgentAnalysisPacket as buildPacketFromRoot,
  ProjectIntelligenceCapability,
} from '../src/index.js';
import {
  buildIDEAgentAnalysisPacketFromSnapshot as buildPacketFromProjectIntelligence,
  buildProjectSnapshot,
} from '../src/project-intelligence.js';

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

describe('IDEAgentAnalysisPacketBuilder', () => {
  it('is exported by stable public Core entrypoints', () => {
    expect(ProjectIntelligenceCapability.run).toBeInstanceOf(Function);
    expect(buildIDEAgentAnalysisPacket).toBeInstanceOf(Function);
    expect(buildPacketFromRoot).toBeInstanceOf(Function);
    expect(buildPacketFromProjectIntelligence).toBeInstanceOf(Function);
  });

  it('builds deterministic packet units without leaking source bodies', () => {
    const snapshot = makeSnapshot();
    const first = buildIDEAgentAnalysisPacketFromSnapshot(snapshot, {
      generatedAt: '2026-05-31T00:00:00.000Z',
      maxUnits: 2,
    });
    const second = buildIDEAgentAnalysisPacketFromSnapshot(snapshot, {
      generatedAt: '2026-05-31T00:00:00.000Z',
      maxUnits: 2,
    });

    expect(first).toStrictEqual(second);
    expect(first.meta).toMatchObject({
      compressionIndependent: true,
      builder: 'IDEAgentAnalysisPacketBuilder',
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

    const packet = buildIDEAgentAnalysisPacket({
      result,
      options: { generatedAt: '2026-05-31T00:00:00.000Z', projectRoot: snapshot.projectRoot },
    });

    expect(packet.meta.source).toBe('project-intelligence-result');
    expect(packet.requiredReadSet).toContain('src/UserService.ts');
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
    const packet = buildIDEAgentAnalysisPacketFromSnapshot(snapshot, {
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

  it('handles raw PanoramaService shape with layers.levels, modules Map, and cycles', () => {
    const packet = buildIDEAgentAnalysisPacketFromSnapshot(
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
    const first = createIDEAgentAnalysisUnitKey({
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

  it('surfaces degraded AST, callgraph, and dependency graph warnings', () => {
    const snapshot = makeSnapshot({
      astProjectSummary: null,
      callGraphResult: null,
      depGraphData: null,
      warnings: ['AST analysis partially failed', 'Call Graph failed on unsupported syntax'],
    });

    const packet = buildIDEAgentAnalysisPacketFromSnapshot(snapshot, {
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
    const packet = buildIDEAgentAnalysisPacketFromSnapshot(makeSnapshot(), {
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
