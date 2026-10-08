import { describe, expect, it } from 'vitest';

import type {
  ProjectContextPresenterInput,
  ProjectContextRef,
  ProjectMap,
  RepoContext,
} from '../src/domain/project-context/index.js';
import {
  buildProjectContextMissionBriefing,
  type DimensionDef,
} from '../src/host-agent-workflows.js';

/**
 * 简报的每一段读哪一份 ProjectContext 事实。
 * 这些用例直接给出 repo / map 两份事实，看简报里对应的段是不是原样反映了它们。
 */

const PROJECT = { projectRoot: '/fixture/app', displayName: 'App' };
const dimensions: DimensionDef[] = [
  { id: 'architecture', label: 'Architecture', guide: 'Find architectural boundaries' },
];
const session = { toJSON: () => ({ id: 'briefing-facts' }) };

function ref(
  kind: ProjectContextRef['kind'],
  id: string,
  label: string,
  metadata?: ProjectContextRef['metadata']
): ProjectContextRef {
  return {
    id,
    kind,
    label,
    scope: { projectRoot: PROJECT.projectRoot, repoId: 'app' },
    ...(metadata ? { metadata } : {}),
  };
}

function target(name: string, kind: string, fileCount: number) {
  return { name, kind, refs: [ref('path', `pc:path:${name}`, name, { fileCount })] };
}

function mapModule(name: string, ownedFileCount = 1) {
  return {
    id: `module:app:${name}`,
    name,
    ownedFileCount,
    ref: ref('module', `module:app:${name}`, name),
  };
}

function makeRepo(overrides: Partial<RepoContext>): RepoContext {
  return {
    repo: { id: 'app', name: 'App', root: '.' },
    languages: [{ language: 'swift', fileCount: 20 }],
    buildSystems: [],
    packageSystems: [],
    targets: [],
    localPackages: [],
    sourceRoots: [],
    entrypoints: [],
    commands: [],
    topAreas: [],
    configFiles: [],
    nextRefs: [],
    ...overrides,
  };
}

function makeMap(overrides: Partial<ProjectMap>): ProjectMap {
  return {
    repo: { id: 'app', name: 'App', root: '.' },
    modules: [],
    layers: [],
    dependencySummary: { edgeCount: 0, notes: [] },
    cycles: [],
    hotspots: [],
    majorFlows: [],
    externalDependencyHotspots: [],
    nextRefs: [],
    ...overrides,
  };
}

function makeInput(
  facts: Partial<Pick<ProjectContextPresenterInput, 'repo' | 'map' | 'files'>>
): ProjectContextPresenterInput {
  return {
    project: PROJECT,
    envelopes: [],
    refs: [],
    files: [],
    warnings: [],
    unavailable: [],
    modules: [],
    moduleLayers: [],
    fileFlows: [],
    fileSymbols: [],
    sourceSlices: [],
    anchorRanges: [],
    ...facts,
  };
}

function build(input: ProjectContextPresenterInput) {
  return buildProjectContextMissionBriefing({
    projectContext: input,
    activeDimensions: dimensions,
    session,
  }) as unknown as {
    architectureOverview: {
      style: string;
      externalDeps: { name: string; role: string }[];
      keyInsights: string[];
    } | null;
    technologyStack: { name: string; role: string; usedBy: string[] }[] | null;
    dependencyGraph: {
      nodes: { id: string; label: string; fileCount?: number; dependentCount?: number }[];
      edges: { from: string; to: string; type?: string; relationCount?: number }[];
    } | null;
    dimensions: {
      id: string;
      evidenceStarters?: Record<string, { hint: string; data: unknown }>;
    }[];
    mustCoverModules: {
      totalLocalPackages: number;
      modules: { name: string; fileCount: number; keyFiles: string[] }[];
    } | null;
    panorama: { couplingHotspots: { module: string; fanIn: number; fanOut: number }[] } | null;
    projectMeta: { fileCount?: number };
    targets: { name: string; fileCount?: number }[];
  };
}

/** SPM 形状的声明图：一个包、三个目标、一个远程包；带"包含"关系、重复边与自指边。 */
function makeSwiftPackageFacts(): Pick<ProjectContextPresenterInput, 'repo' | 'map'> {
  const feature = mapModule('Feature', 6);
  const core = mapModule('Core', 4);
  return {
    repo: makeRepo({
      targets: [target('Feature', 'target', 6), target('Core', 'target', 4)],
      localPackages: [{ name: 'App', path: '.' }],
      dependencyGraph: {
        source: 'spm',
        nodes: [
          { id: 'App', label: 'App', type: 'package' },
          { id: 'Feature', label: 'Feature', type: 'target' },
          { id: 'Core', label: 'Core', type: 'target' },
          { id: 'Networking', label: 'Networking', type: 'target' },
          { id: 'RxSwift', label: 'RxSwift', type: 'remote' },
        ],
        edges: [
          { from: 'App', to: 'Feature', type: 'contains' },
          { from: 'App', to: 'Core', type: 'contains' },
          { from: 'App', to: 'RxSwift', type: 'depends_on' },
          { from: 'Feature', to: 'Core', type: 'depends_on' },
          { from: 'Feature', to: 'Core', type: 'depends_on' },
          { from: 'Feature', to: 'Networking', type: 'depends_on' },
          { from: 'Feature', to: 'RxSwift', type: 'depends_on' },
          { from: 'Networking', to: 'Core', type: 'depends_on' },
          { from: 'Core', to: 'Core', type: 'depends_on' },
        ],
      },
    }),
    map: makeMap({
      // 宿主只把 Feature 与 Core 当种子：Networking 是项目自己的模块，却被 map 记成了"外部依赖"。
      modules: [feature, core],
      majorFlows: [
        {
          refs: [],
          summary: 'Feature -> Core via imports (5 relations)',
          from: { id: feature.id, name: 'Feature' },
          to: { id: core.id, name: 'Core' },
          relationKind: 'imports',
          relationCount: 5,
        },
      ],
      externalDependencyHotspots: [
        { name: 'Foundation', refs: [], usedBy: { id: core.id, name: 'Core' } },
        { name: 'Foundation', refs: [], usedBy: { id: feature.id, name: 'Feature' } },
        { name: 'Networking', refs: [], usedBy: { id: feature.id, name: 'Feature' } },
        { name: 'RxSwift', refs: [], usedBy: { id: feature.id, name: 'Feature' } },
        { name: 'Core', refs: [], usedBy: { id: core.id, name: 'Core' } },
      ],
    }),
  };
}

describe('ProjectContext facts behind the Mission Briefing', () => {
  it('presents the dependency graph the manifest declares', () => {
    const briefing = build(makeInput(makeSwiftPackageFacts()));

    expect(briefing.dependencyGraph?.nodes).toEqual([
      { id: 'App', label: 'App', dependentCount: 0 },
      { id: 'Feature', label: 'Feature', fileCount: 6, dependentCount: 0 },
      { id: 'Core', label: 'Core', fileCount: 4, dependentCount: 2 },
      { id: 'Networking', label: 'Networking', dependentCount: 1 },
      { id: 'RxSwift', label: 'RxSwift', dependentCount: 2 },
    ]);
    // "包含"是归属不是依赖；重复声明的边与自指的边各只留有意义的一条 / 不留。
    expect(briefing.dependencyGraph?.edges).toEqual([
      { from: 'App', to: 'RxSwift', type: 'depends_on' },
      { from: 'Feature', to: 'Core', type: 'depends_on' },
      { from: 'Feature', to: 'Networking', type: 'depends_on' },
      { from: 'Feature', to: 'RxSwift', type: 'depends_on' },
      { from: 'Networking', to: 'Core', type: 'depends_on' },
    ]);
    expect(briefing.dimensions[0]?.evidenceStarters?.dependencyOverview).toMatchObject({
      data: {
        totalModules: 5,
        totalEdges: 5,
        topModules: ['Core', 'RxSwift', 'Networking', 'App', 'Feature'],
      },
    });
  });

  it('keeps the project own modules out of the external dependencies', () => {
    const briefing = build(makeInput(makeSwiftPackageFacts()));

    // Networking、Core 是项目自己的模块，不是外部依赖；Foundation 被 import 但清单没有声明。
    expect(briefing.architectureOverview?.externalDeps).toEqual([
      {
        name: 'Foundation',
        role: 'not declared in the manifest (platform SDK or transitive dependency)',
      },
      { name: 'RxSwift', role: 'Reactive programming (ReactiveX)' },
    ]);
    expect(briefing.technologyStack).toEqual([
      {
        name: 'Foundation',
        role: 'not declared in the manifest (platform SDK or transitive dependency)',
        usedBy: ['Core', 'Feature'],
      },
      { name: 'RxSwift', role: 'Reactive programming (ReactiveX)', usedBy: ['App', 'Feature'] },
    ]);
  });

  it('uses observed module imports when the manifest declares only external packages', () => {
    const api = mapModule('api', 3);
    const domain = mapModule('domain', 2);
    const briefing = build(
      makeInput({
        repo: makeRepo({
          languages: [{ language: 'typescript', fileCount: 5 }],
          targets: [target('pkg', 'library', 5)],
          localPackages: [{ name: 'pkg', path: '.' }],
          dependencyGraph: {
            source: 'node',
            nodes: [{ id: 'pkg' }],
            edges: [
              { from: 'pkg', to: 'drizzle-orm', type: 'depends_on' },
              { from: 'pkg', to: 'vitest', type: 'dev_depends_on' },
            ],
          },
        }),
        map: makeMap({
          modules: [api, domain],
          majorFlows: [
            {
              refs: [],
              summary: 'api -> domain via imports (3 relations)',
              from: { id: api.id, name: 'api' },
              to: { id: domain.id, name: 'domain' },
              relationKind: 'imports',
              relationCount: 3,
            },
            {
              refs: [],
              summary: 'api -> domain via calls (2 relations)',
              from: { id: api.id, name: 'api' },
              to: { id: domain.id, name: 'domain' },
              relationKind: 'calls',
              relationCount: 2,
            },
          ],
          externalDependencyHotspots: [
            { name: 'drizzle-orm/sqlite-core', refs: [], usedBy: { id: api.id, name: 'api' } },
            { name: 'node:fs/promises', refs: [], usedBy: { id: api.id, name: 'api' } },
            { name: 'node:fs', refs: [], usedBy: { id: domain.id, name: 'domain' } },
            // 项目自己的路径别名，以及没找到文件的相对路径 import，都不是外部依赖。
            { name: '#shared/logging.js', refs: [], usedBy: { id: api.id, name: 'api' } },
            { name: '@/components/Button', refs: [], usedBy: { id: api.id, name: 'api' } },
            {
              name: './missing.js',
              category: 'unmatched',
              refs: [],
              usedBy: { id: api.id, name: 'api' },
            },
          ],
        }),
      })
    );

    // 单包项目的清单说不出内部结构，内部依赖取 import 里观察到的；两种关系是两条边，
    // 但依赖 domain 的模块只有 api 一个。
    expect(briefing.dependencyGraph).toEqual({
      nodes: [
        { id: api.id, label: 'api', fileCount: 3, dependentCount: 0 },
        { id: domain.id, label: 'domain', fileCount: 2, dependentCount: 1 },
      ],
      edges: [
        { from: api.id, to: domain.id, type: 'imports', relationCount: 3 },
        { from: api.id, to: domain.id, type: 'calls', relationCount: 2 },
      ],
    });
    // 带子路径的 import 并到所属的包名下；主项目自己不是"本地子包"。
    expect(briefing.technologyStack).toEqual([
      { name: 'drizzle-orm', role: 'third-party dependency', usedBy: ['api', 'pkg'] },
      { name: 'node:fs', role: 'Node.js built-in module', usedBy: ['api', 'domain'] },
      { name: 'vitest', role: 'Vite-native testing', usedBy: ['pkg'] },
    ]);
    expect(briefing.mustCoverModules).toBeNull();
    expect(briefing.architectureOverview).toMatchObject({
      keyInsights: [],
      style: 'Monolithic application',
    });
    expect(briefing.targets).toEqual([expect.objectContaining({ name: 'pkg', fileCount: 5 })]);
    expect(briefing.projectMeta.fileCount).toBe(5);
  });

  it('labels undeclared imports as plain external dependencies when no manifest graph exists', () => {
    const app = mapModule('app', 2);
    const briefing = build(
      makeInput({
        repo: makeRepo({ targets: [target('app', 'target', 2)] }),
        map: makeMap({
          modules: [app],
          externalDependencyHotspots: [
            { name: 'UIKit', refs: [], usedBy: { id: app.id, name: 'app' } },
          ],
        }),
      })
    );

    expect(briefing.architectureOverview?.externalDeps).toEqual([
      { name: 'UIKit', role: 'third-party dependency' },
    ]);
  });

  it('counts local package files from the repo module partition', () => {
    const briefing = build(
      makeInput({
        repo: makeRepo({
          targets: [target('Kit', 'target', 7), target('KitTests', 'testTarget', 3)],
          localPackages: [
            { name: 'App', path: '.' },
            { name: 'Kit', path: 'Packages/Kit' },
          ],
          modules: [
            { name: 'Kit', path: 'Packages/Kit/Sources/Kit', kind: 'target', fileCount: 7 },
            { name: 'KitTests', path: 'Packages/Kit/Tests/KitTests', kind: 'target', fileCount: 3 },
            { name: 'Sources', path: 'Sources', kind: 'root', fileCount: 10 },
            // 名字相近但不在包目录里的模块不算进去。
            { name: 'KitExtras', path: 'Packages/KitExtras', kind: 'target', fileCount: 5 },
          ],
        }),
      })
    );

    expect(briefing.mustCoverModules).toMatchObject({
      totalLocalPackages: 1,
      modules: [{ name: 'Kit', fileCount: 10, keyFiles: [] }],
    });
    expect(briefing.architectureOverview?.keyInsights).toContain(
      '1 local packages provide 50% of the codebase (10/20 files)'
    );
  });

  it("picks only code files as a local package's key files", () => {
    const briefing = build(
      makeInput({
        files: [
          { filePath: 'Packages/Kit/.github/workflows/ci.yml', language: 'yaml' },
          { filePath: 'Packages/Kit/Package.swift', language: 'swift' },
          { filePath: 'Packages/Kit/README.md', language: 'markdown' },
          { filePath: 'Packages/Kit/Sources/Kit/Client.swift', language: 'swift' },
          { filePath: 'Packages/Kit/Sources/Kit/Model.swift', language: 'swift' },
        ],
        repo: makeRepo({
          localPackages: [
            { name: 'App', path: '.' },
            { name: 'Kit', path: 'Packages/Kit' },
          ],
        }),
      })
    );

    expect(briefing.mustCoverModules?.modules).toEqual([
      expect.objectContaining({
        name: 'Kit',
        keyFiles: ['Packages/Kit/Sources/Kit/Client.swift', 'Packages/Kit/Sources/Kit/Model.swift'],
      }),
    ]);
  });

  it('reports coupling as module counts and skips modules nothing depends on', () => {
    const hub = mapModule('Hub');
    const leaf = mapModule('Leaf');
    const briefing = build(
      makeInput({
        map: makeMap({
          modules: [hub, leaf],
          hotspots: [
            {
              ref: hub.ref,
              score: 40,
              reason: 'fan-in:9 fan-out:1 relations:28 external:2',
              fanIn: 6,
              fanOut: 1,
              externalFanOut: 2,
              relationCount: 28,
            },
            // 只用到外部依赖、与项目里别的模块没有依赖的模块，不是耦合热点。
            {
              ref: leaf.ref,
              score: 3,
              reason: 'fan-in:0 fan-out:0 relations:1 external:2',
              fanIn: 0,
              fanOut: 0,
              externalFanOut: 2,
              relationCount: 1,
            },
          ],
        }),
      })
    );

    expect(briefing.panorama?.couplingHotspots).toEqual([{ module: 'Hub', fanIn: 6, fanOut: 1 }]);
    expect(briefing.dimensions[0]?.evidenceStarters?.couplingHotspots).toMatchObject({
      data: ['Hub (fanIn=6, fanOut=1)'],
    });
  });
});
