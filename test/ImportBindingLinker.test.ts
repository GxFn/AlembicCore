import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPlugins } from '../src/core/ast/index.js';
import { readFileSyntaxEvidence } from '../src/core/facts/fileSyntaxEvidence.js';
import {
  type ImportBoundTarget,
  linkImportBoundCallSites,
  MODULE_SOURCE_EXTENSIONS,
  type ModuleGraphAccess,
  moduleSourceCandidates,
  relativeModuleBase,
  resolveExportedDeclaration,
} from '../src/core/linking/index.js';

/** 内存里的小项目：文件事实来自真实 AST，模块解析只看这组文件名。 */
function project(files: Record<string, string>) {
  const evidence = new Map(
    Object.entries(files).map(([filePath, text]) => [
      filePath,
      readFileSyntaxEvidence({ text, filePath, lineCount: text.split('\n').length }, true),
    ])
  );
  const access: ModuleGraphAccess = {
    async declarations(filePath) {
      const facts = evidence.get(filePath);
      return facts
        ? {
            symbols: facts.symbols.symbols,
            exports: facts.exports,
            defaultExportNames: facts.defaultExportNames,
          }
        : undefined;
    },
    async resolveModule(importerFile, specifier) {
      const base = relativeModuleBase(importerFile, specifier);
      return base === undefined
        ? undefined
        : moduleSourceCandidates(base, MODULE_SOURCE_EXTENSIONS).find((candidate) =>
            evidence.has(candidate)
          );
    },
  };
  return {
    access,
    async link(filePath: string): Promise<string[]> {
      const flow = evidence.get(filePath)?.flow;
      if (!flow) {
        throw new Error(`no flow facts for ${filePath}`);
      }
      const targets = await linkImportBoundCallSites({
        filePath,
        imports: flow.imports,
        callSites: flow.callSites,
        access,
      });
      // 调用点列表的顺序是提取层的去重顺序，不是源码顺序；断言只关心目标集合。
      return targets
        .map((target) => describeTarget(flow.callSites[target.index].callee, target))
        .sort();
    },
  };
}

function describeTarget(callee: string, target: ImportBoundTarget): string {
  const name = target.symbol.qualifiedName ?? target.symbol.name;
  return `${callee} -> ${target.filePath}#${name} (${target.strategy}${target.viaReexport ? ', re-export' : ''})`;
}

describe('import-binding linker', () => {
  beforeAll(async () => {
    await loadPlugins();
  });

  it('links named, default and namespace imports to their declarations', async () => {
    const fixture = project({
      'src/app.ts': [
        "import run, { helper as aliased } from './lib.js';",
        "import * as ns from './lib.js';",
        'export function main() { aliased(); run(); ns.helper(); }',
      ].join('\n'),
      'src/lib.ts': ['export function helper() {}', 'export default function actual() {}'].join(
        '\n'
      ),
    });

    expect(await fixture.link('src/app.ts')).toEqual([
      'aliased -> src/lib.ts#helper (named-import)',
      'helper -> src/lib.ts#helper (namespace-member)',
      'run -> src/lib.ts#actual (default-import)',
    ]);
  });

  it('follows aliased and star re-exports through barrels', async () => {
    const fixture = project({
      'src/app.ts': [
        "import { sum, clamp, deep } from './barrel';",
        'export function main() { sum(); clamp(); deep(); }',
      ].join('\n'),
      'src/barrel.ts': ["export { add as sum } from './math';", "export * from './util';"].join(
        '\n'
      ),
      'src/math.ts': 'export function add() {}',
      'src/util.ts': "export function clamp() {}\nexport * from './nested/index';",
      'src/nested/index.ts': 'export function deep() {}',
    });

    expect(await fixture.link('src/app.ts')).toEqual([
      'clamp -> src/util.ts#clamp (named-import, re-export)',
      'deep -> src/nested/index.ts#deep (named-import, re-export)',
      'sum -> src/math.ts#add (named-import, re-export)',
    ]);
  });

  it('links static members and instantiation of an imported class', async () => {
    const fixture = project({
      'src/app.ts': [
        "import { Calculator } from './calc';",
        'export function main() { Calculator.create(); return new Calculator(); }',
      ].join('\n'),
      'src/calc.ts': 'export class Calculator { static create() {} run() {} }',
    });

    expect(await fixture.link('src/app.ts')).toEqual([
      'Calculator -> src/calc.ts#Calculator (named-import)',
      'create -> src/calc.ts#Calculator.create (imported-member)',
    ]);
  });

  it('ignores type-only bindings, shadowed names and non-relative specifiers', async () => {
    const fixture = project({
      'src/app.ts': [
        "import type { helper as typeOnly } from './lib';",
        "import { type helper as inlineType, helper } from './lib';",
        "import { external } from 'some-package';",
        "import { aliased } from '@/lib';",
        'export function shadowed(helper: () => void) { helper(); }',
        'export function main() { typeOnly(); inlineType(); external(); aliased(); }',
      ].join('\n'),
      'src/lib.ts': 'export function helper() {}\nexport function aliased() {}',
    });

    expect(await fixture.link('src/app.ts')).toEqual([]);
  });

  it('refuses to guess between ambiguous declarations', async () => {
    const fixture = project({
      'src/app.ts': [
        "import { twice, starred } from './barrel';",
        'export function main() { twice(); starred(); }',
      ].join('\n'),
      'src/barrel.ts': ["export * from './a';", "export * from './b';"].join('\n'),
      // 同一文件里同名的类与函数：不是函数重载，不能挑一个。
      'src/a.ts': 'export function starred() {}\nexport class twice {}\nexport function twice() {}',
      // 两个 `export *` 都提供 starred：目标不唯一。
      'src/b.ts': 'export function starred() {}',
    });

    expect(await fixture.link('src/app.ts')).toEqual([]);
  });

  it('terminates on re-export cycles and missing modules', async () => {
    const fixture = project({
      'src/app.ts': [
        "import { loop } from './a';",
        "import { gone } from './missing';",
        'export function main() { loop(); gone(); }',
      ].join('\n'),
      'src/a.ts': "export * from './b';",
      'src/b.ts': "export * from './a';",
    });

    expect(await fixture.link('src/app.ts')).toEqual([]);
  });

  it('resolves a default export that names a local declaration or forwards another module', async () => {
    const fixture = project({
      'src/local.ts': 'function build() {}\nexport default build;',
      'src/forward.ts': "export { default } from './local';",
      'src/anonymous.ts': 'export default function () {}',
    });

    await expect(
      resolveExportedDeclaration(fixture.access, 'src/local.ts', 'default')
    ).resolves.toMatchObject({ filePath: 'src/local.ts', symbol: { name: 'build' } });
    await expect(
      resolveExportedDeclaration(fixture.access, 'src/forward.ts', 'default')
    ).resolves.toMatchObject({
      filePath: 'src/local.ts',
      symbol: { name: 'build' },
      viaReexport: true,
    });
    // 匿名 default 没有可指向的声明。
    await expect(
      resolveExportedDeclaration(fixture.access, 'src/anonymous.ts', 'default')
    ).resolves.toBeUndefined();
  });
});

describe('module target candidates', () => {
  it('maps emitted JavaScript specifiers to TypeScript sources after the real file', () => {
    expect(moduleSourceCandidates('src/util.js', MODULE_SOURCE_EXTENSIONS)).toEqual([
      'src/util.js',
      'src/util.ts',
      'src/util.tsx',
    ]);
    expect(moduleSourceCandidates('src/util', ['.ts', '.tsx'])).toEqual([
      'src/util.ts',
      'src/util.tsx',
      path.posix.join('src/util', 'index.ts'),
      path.posix.join('src/util', 'index.tsx'),
    ]);
  });

  it('only treats relative specifiers inside the project as relative modules', () => {
    expect(relativeModuleBase('src/app.ts', './lib.js')).toBe('src/lib.js');
    expect(relativeModuleBase('src/feature/app.ts', '../shared/x')).toBe('src/shared/x');
    expect(relativeModuleBase('src/app.ts', 'react')).toBeUndefined();
    expect(relativeModuleBase('src/app.ts', '@/lib')).toBeUndefined();
    expect(relativeModuleBase('app.ts', '../outside')).toBeUndefined();
  });
});
