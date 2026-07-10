/**
 * Track1(2026-07-10):模块名 join——createProjectContextModuleDependencyRollups
 * 对文件级解析落空的 import specifier 按模块名二次解析。
 * BiliDili 实证背景:Swift `import AOXFoundationKit` 是模块名导入,此前全部被计成
 * external(internal-edges:0/external:82),修后真机 internal-edges=11。
 */
import { describe, expect, it } from 'vitest';
import type { ProjectContextModuleMapModule } from '../../src/service/project-context/shared/module-map/index.js';
import { createProjectContextModuleDependencyRollups } from '../../src/service/project-context/shared/module-map/index.js';

const SCOPE = { projectRoot: '/tmp/fixture', repoId: 'demo' };

function makeModule(name: string, filePath: string): ProjectContextModuleMapModule {
  return {
    layers: [],
    module: { id: `module:${name}`, name, ref: makeRef(`module:${name}`) },
    nextRefs: [],
    outflow: [],
    ownedFiles: [{ filePath, ref: makeRef(`file:${filePath}`) }],
  } as unknown as ProjectContextModuleMapModule;
}

function makeRef(id: string) {
  return { id, kind: 'module', label: id, level: 'module', scope: { ...SCOPE } };
}

/** 模块名导入形态的 unresolved 关系(fileFlow 对 Swift/ObjC 的真实产出形态)。 */
function makeNamedImport(specifier: string) {
  return {
    kind: 'imports',
    ref: { ...makeRef(`relation:${specifier}`), metadata: { specifier } },
    to: { label: specifier },
    unresolved: true,
  };
}

describe('createProjectContextModuleDependencyRollups 模块名 join(Track1)', () => {
  it('Swift 模块名导入解析成 internal 边;非模块名仍是 external', () => {
    const feed = makeModule('FeedKit', 'Packages/FeedKit/Sources/A.swift');
    const net = makeModule('NetKit', 'Packages/NetKit/Sources/B.swift');
    feed.outflow.push(
      makeNamedImport('NetKit') as never, // → internal(精确模块名)
      makeNamedImport('RxSwift') as never // → external(非本地模块)
    );

    const rollups = createProjectContextModuleDependencyRollups({
      modules: [feed, net],
      scope: SCOPE,
    });
    const internal = rollups.filter((rollup) => rollup.to !== undefined);
    const external = rollups.filter((rollup) => rollup.to === undefined);
    expect(internal).toHaveLength(1);
    expect(internal[0]?.from.name).toBe('FeedKit');
    expect(internal[0]?.to?.name).toBe('NetKit');
    expect(external.map((rollup) => rollup.externalName)).toEqual(['RxSwift']);
  });

  it('ObjC 框架头导入(Name/File.h)按首段 join;相对路径与 npm scope 不误命中', () => {
    const feed = makeModule('FeedKit', 'LocalModule/FeedKit/Classes/A.m');
    const net = makeModule('NetKit', 'LocalModule/NetKit/Classes/B.m');
    feed.outflow.push(
      makeNamedImport('NetKit/NetClient.h') as never, // → internal(首段)
      makeNamedImport('@scope/NetKit') as never // → external(scope 包不 join)
    );

    const rollups = createProjectContextModuleDependencyRollups({
      modules: [feed, net],
      scope: SCOPE,
    });
    const internal = rollups.filter((rollup) => rollup.to !== undefined);
    expect(internal).toHaveLength(1);
    expect(internal[0]?.to?.name).toBe('NetKit');
    expect(
      rollups.some((rollup) => rollup.to === undefined && rollup.externalName === '@scope/NetKit')
    ).toBe(true);
  });

  it('自引用(specifier 等于本模块名)不产生自环 internal 边', () => {
    const feed = makeModule('FeedKit', 'Packages/FeedKit/Sources/A.swift');
    feed.outflow.push(makeNamedImport('FeedKit') as never);

    const rollups = createProjectContextModuleDependencyRollups({
      modules: [feed],
      scope: SCOPE,
    });
    expect(rollups.filter((rollup) => rollup.to !== undefined)).toHaveLength(0);
  });
});
