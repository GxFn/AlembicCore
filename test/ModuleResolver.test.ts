import { describe, expect, it } from 'vitest';
import {
  MODULE_SOURCE_EXTENSIONS,
  type ModuleResolution,
  packageEntryBases,
  parsePackageManifest,
  parseWorkspaceGlobs,
  resolveModuleSpecifier,
  resolveSubpathTargets,
  splitPackageSpecifier,
} from '../src/core/linking/index.js';
import { createInventoryModuleAccess } from '../src/service/source-graph/SourceGraphModuleAccess.js';

/** 内存里的项目：键是项目相对路径。解析只能看到这些文件。 */
function project(files: Record<string, string | object>) {
  const texts = Object.fromEntries(
    Object.entries(files).map(([file, content]) => [
      file,
      typeof content === 'string' ? content : JSON.stringify(content),
    ])
  );
  const consulted = new Set<string>();
  const access = createInventoryModuleAccess({
    knownPaths: new Set(Object.keys(texts)),
    readText: async (filePath) => texts[filePath],
    consulted,
  });
  return {
    consulted,
    resolve(importerFile: string, specifier: string, conventions = true) {
      return resolveModuleSpecifier(access, importerFile, specifier, {
        extensions: MODULE_SOURCE_EXTENSIONS,
        conventions,
      });
    },
  };
}

const found = (filePath: string, via: string, conventional = false): ModuleResolution =>
  ({ status: 'found', filePath, via, conventional }) as ModuleResolution;

describe('package specifiers and manifests', () => {
  it('splits a package specifier into name and subpath', () => {
    expect(splitPackageSpecifier('lodash')).toEqual({ name: 'lodash', subpath: '.' });
    expect(splitPackageSpecifier('lodash/fp/get')).toEqual({ name: 'lodash', subpath: './fp/get' });
    expect(splitPackageSpecifier('@demo/lib')).toEqual({ name: '@demo/lib', subpath: '.' });
    expect(splitPackageSpecifier('@demo/lib/deep/x')).toEqual({
      name: '@demo/lib',
      subpath: './deep/x',
    });
    for (const notAPackage of ['./a', '../a', '/abs', '#internal', 'node:fs', '@demo', '']) {
      expect(splitPackageSpecifier(notAPackage)).toBeUndefined();
    }
  });

  it('reads entry fields, dependency specs and workspace patterns from a manifest', () => {
    const manifest = parsePackageManifest(
      JSON.stringify({
        name: '@demo/app',
        main: 'dist/index.js',
        module: 'dist/index.mjs',
        types: 'dist/index.d.ts',
        source: 'src/index.ts',
        dependencies: { '@demo/lib': 'workspace:*' },
        devDependencies: { '@demo/tools': 'file:../tools', '@demo/lib': '1.0.0' },
        workspaces: { packages: ['packages/*'] },
      })
    );
    expect(manifest).toMatchObject({
      name: '@demo/app',
      // 越接近源码越靠前。
      entryFields: ['src/index.ts', 'dist/index.d.ts', 'dist/index.mjs', 'dist/index.js'],
      // 同名依赖取先声明的那一处。
      dependencies: { '@demo/lib': 'workspace:*', '@demo/tools': 'file:../tools' },
      workspaces: ['packages/*'],
    });
    expect(parsePackageManifest('not json')).toBeUndefined();
    expect(parsePackageManifest('[]')).toBeUndefined();

    expect(parseWorkspaceGlobs('package.json', '{"workspaces":["apps/*","packages/*"]}')).toEqual([
      'apps/*',
      'packages/*',
    ]);
    expect(
      parseWorkspaceGlobs('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - '!**/test/**'\n")
    ).toEqual(['packages/*', '!**/test/**']);
    expect(parseWorkspaceGlobs('lerna.json', '{"packages":["modules/*"]}')).toEqual(['modules/*']);
    expect(parseWorkspaceGlobs('pnpm-workspace.yaml', 'packages: [unclosed')).toEqual([]);
  });

  it('lists every target of an exports subpath, source-pointing conditions first', () => {
    const exports = {
      '.': {
        require: './dist/index.cjs',
        import: { types: './dist/index.d.ts', default: './dist/index.mjs' },
        '@demo/source': './src/index.ts',
      },
      './features/*': './dist/features/*.js',
      './features/internal/*': null,
      './legacy/': './lib/legacy/',
      './package.json': './package.json',
    };
    expect(resolveSubpathTargets(exports, '.')).toEqual([
      './src/index.ts',
      './dist/index.d.ts',
      './dist/index.mjs',
      './dist/index.cjs',
    ]);
    expect(resolveSubpathTargets(exports, './features/login')).toEqual([
      './dist/features/login.js',
    ]);
    // 更具体的模式优先；它被显式置空时没有目标，不退回到更宽的模式。
    expect(resolveSubpathTargets(exports, './features/internal/secret')).toEqual([]);
    expect(resolveSubpathTargets(exports, './legacy/util.js')).toEqual(['./lib/legacy/util.js']);
    expect(resolveSubpathTargets(exports, './missing')).toEqual([]);

    // 整个 exports 是主入口的简写时，子路径没有导出。
    expect(resolveSubpathTargets('./index.js', '.')).toEqual(['./index.js']);
    expect(resolveSubpathTargets('./index.js', './deep')).toEqual([]);
    expect(resolveSubpathTargets({ import: './esm.js', require: './cjs.js' }, '.')).toEqual([
      './esm.js',
      './cjs.js',
    ]);
    // imports 的目标可以是别的包，那不是包内文件。
    expect(
      resolveSubpathTargets(
        { '#dep': { node: 'dep-node-native', default: './dep-polyfill.js' } },
        '#dep'
      )
    ).toEqual(['./dep-polyfill.js']);
  });

  it('maps a declared entry back to source by build layout, then by convention', () => {
    const bases = (
      target: string,
      options: Partial<Parameters<typeof packageEntryBases>[0]> = {}
    ) =>
      packageEntryBases({
        packageDirectory: 'packages/lib',
        target,
        conventions: true,
        ...options,
      }).map((entry) => `${entry.base} (${entry.proof})`);

    expect(bases('./src/index.ts')).toEqual(['packages/lib/src/index.ts (declared)']);
    // 只放构建产物的目录：目标不能是它本身。
    expect(bases('./dist/index.js')).toEqual([
      'packages/lib/src/index.js (convention)',
      'packages/lib/index.js (convention)',
    ]);
    expect(bases('./dist/index.js', { conventions: false })).toEqual([]);
    // lib 可能就是源码：先试换回的源码，再试它本身。
    expect(bases('./lib/util/a.js')).toEqual([
      'packages/lib/src/util/a.js (convention)',
      'packages/lib/util/a.js (convention)',
      'packages/lib/lib/util/a.js (declared)',
    ]);
    // 编译配置给出的对应关系是证明，排在惯例之前。
    expect(
      bases('./build/main/index.js', {
        layout: { outDir: 'packages/lib/build', rootDir: 'packages/lib/sources' },
      })
    ).toEqual([
      'packages/lib/sources/main/index.js (build-layout)',
      'packages/lib/src/main/index.js (convention)',
      'packages/lib/main/index.js (convention)',
    ]);
    // 声明文件对应同名源码；多层产物目录一并去掉，产物里自带的 src 不重复。
    expect(bases('./dist/esm/index.d.ts')).toEqual([
      'packages/lib/src/index (convention)',
      'packages/lib/index (convention)',
    ]);
    expect(bases('./dist/src/index.js')).toEqual(['packages/lib/src/index.js (convention)']);
    expect(bases('./types/api.d.ts')).toEqual([
      'packages/lib/types/api (declared)',
      'packages/lib/types/api.d.ts (declared)',
    ]);
    expect(bases('../outside/index.js')).toEqual([]);
    expect(
      packageEntryBases({ packageDirectory: '', target: 'main.js', conventions: true })
    ).toEqual([{ base: 'main.js', proof: 'declared' }]);
  });
});

describe('module specifier resolution', () => {
  const workspace = {
    'package.json': { name: 'root', private: true, workspaces: ['packages/*', 'apps/**'] },
    'packages/app/package.json': { name: '@demo/app', dependencies: { '@demo/lib': '*' } },
    'packages/app/src/main.ts': '',
    'packages/lib/package.json': { name: '@demo/lib', main: 'src/index.ts' },
    'packages/lib/src/index.ts': '',
    'packages/lib/src/deep.ts': '',
  };

  it('resolves relative specifiers and reports why the others have no target', async () => {
    const { resolve } = project({
      'src/index.ts': '',
      'src/app.ts': '',
      'src/lib.ts': '',
      'src/dir/index.ts': '',
      'src/dir/leaf.ts': '',
    });

    expect(await resolve('src/app.ts', './lib.js')).toEqual(found('src/lib.ts', 'relative'));
    expect(await resolve('src/dir/leaf.ts', '../lib')).toEqual(found('src/lib.ts', 'relative'));
    // 目录说明符落到它的 index；`.` 与 `..` 也是相对路径。
    expect(await resolve('src/app.ts', './dir')).toEqual(found('src/dir/index.ts', 'relative'));
    expect(await resolve('src/dir/leaf.ts', '.')).toEqual(found('src/dir/index.ts', 'relative'));
    expect(await resolve('src/dir/leaf.ts', '..')).toEqual(found('src/index.ts', 'relative'));
    expect(await resolve('src/app.ts', './missing')).toEqual({ status: 'not-found' });
    expect(await resolve('src/app.ts', '../../outside')).toEqual({ status: 'outside-scope' });
    expect(await resolve('src/app.ts', 'react')).toEqual({ status: 'external' });
    expect(await resolve('src/app.ts', 'node:fs')).toEqual({ status: 'external' });
    expect(await resolve('src/app.ts', '/etc/passwd')).toEqual({ status: 'external' });
  });

  it('resolves a workspace package through its declared entry and direct subpaths', async () => {
    const { resolve, consulted } = project(workspace);

    expect(await resolve('packages/app/src/main.ts', '@demo/lib')).toEqual(
      found('packages/lib/src/index.ts', 'package-entry')
    );
    // 没有 exports 时子路径就是包目录下的路径。
    expect(await resolve('packages/app/src/main.ts', '@demo/lib/src/deep')).toEqual(
      found('packages/lib/src/deep.ts', 'package-entry')
    );
    expect(await resolve('packages/app/src/main.ts', '@demo/missing')).toEqual({
      status: 'external',
    });
    // 读过的清单都登记在案：它们变了，链接结果就可能变。
    expect([...consulted].sort()).toEqual([
      'package.json',
      'packages/app/package.json',
      'packages/lib/package.json',
    ]);
  });

  it('follows exports subpaths and refuses subpaths the package does not export', async () => {
    const { resolve } = project({
      ...workspace,
      'packages/lib/package.json': {
        name: '@demo/lib',
        exports: {
          '.': './src/index.ts',
          './deep': './src/deep.ts',
          './features/*': './src/features/*.ts',
        },
      },
      'packages/lib/src/features/login.ts': '',
    });

    expect(await resolve('packages/app/src/main.ts', '@demo/lib/deep')).toEqual(
      found('packages/lib/src/deep.ts', 'package-entry')
    );
    expect(await resolve('packages/app/src/main.ts', '@demo/lib/features/login')).toEqual(
      found('packages/lib/src/features/login.ts', 'package-entry')
    );
    expect(await resolve('packages/app/src/main.ts', '@demo/lib/src/deep')).toEqual({
      status: 'external',
    });
  });

  it('maps an entry in build output back to source: by tsconfig as proof, by convention as a guess', async () => {
    const built = {
      ...workspace,
      'packages/lib/package.json': {
        name: '@demo/lib',
        main: './dist/index.js',
        types: './dist/index.d.ts',
      },
    };
    const byConvention = project(built);
    expect(await byConvention.resolve('packages/app/src/main.ts', '@demo/lib')).toEqual(
      found('packages/lib/src/index.ts', 'package-entry', true)
    );
    // 不允许按惯例猜的调用方得不到目标。
    expect(await byConvention.resolve('packages/app/src/main.ts', '@demo/lib', false)).toEqual({
      status: 'external',
    });

    const byConfig = project({
      ...built,
      'packages/lib/tsconfig.json': { extends: '../../tsconfig.base.json' },
      'tsconfig.base.json':
        '{ "compilerOptions": { "outDir": "./packages/lib/dist", "rootDir": "./packages/lib/src" } }',
    });
    for (const conventions of [true, false]) {
      expect(await byConfig.resolve('packages/app/src/main.ts', '@demo/lib', conventions)).toEqual(
        found('packages/lib/src/index.ts', 'package-entry')
      );
    }

    // 惯例先命中，但清单另有一个字段明确指向同一个文件：以明确的为准。
    const declaredToo = project({
      ...workspace,
      'packages/lib/package.json': {
        name: '@demo/lib',
        types: './dist/index.d.ts',
        source: './src/index.ts',
      },
    });
    expect(await declaredToo.resolve('packages/app/src/main.ts', '@demo/lib')).toEqual(
      found('packages/lib/src/index.ts', 'package-entry')
    );
  });

  it('treats lib as source when there is nothing to map it back to', async () => {
    const { resolve } = project({
      'package.json': { name: 'root', workspaces: ['packages/*'] },
      'packages/app/package.json': { name: '@demo/app' },
      'packages/app/src/main.ts': '',
      'packages/lib/package.json': { name: '@demo/lib', main: 'lib/index.js' },
      'packages/lib/lib/index.js': '',
    });
    expect(await resolve('packages/app/src/main.ts', '@demo/lib')).toEqual(
      found('packages/lib/lib/index.js', 'package-entry')
    );
  });

  it('finds workspace members from pnpm and nested patterns, honouring exclusions', async () => {
    const { resolve } = project({
      'pnpm-workspace.yaml': "packages:\n  - 'libs/**'\n  - '!libs/**/fixtures/**'\n",
      'package.json': { name: 'root' },
      'apps/web/package.json': { name: 'web' },
      'apps/web/src/main.ts': '',
      'libs/ui/button/package.json': { name: '@demo/button', main: 'index.ts' },
      'libs/ui/button/index.ts': '',
      // 被排除的目录里即使有同名清单也不是成员。
      'libs/ui/fixtures/fake/package.json': { name: '@demo/button', main: 'index.ts' },
      'libs/ui/fixtures/fake/index.ts': '',
      // 没被任何模式覆盖的清单不是成员。
      'tools/package.json': { name: '@demo/tools', main: 'index.ts' },
      'tools/index.ts': '',
    });

    expect(await resolve('apps/web/src/main.ts', '@demo/button')).toEqual(
      found('libs/ui/button/index.ts', 'package-entry')
    );
    expect(await resolve('apps/web/src/main.ts', '@demo/tools')).toEqual({ status: 'external' });
  });

  it('does not pick between two workspace members with the same name', async () => {
    const { resolve } = project({
      ...workspace,
      'packages/lib-copy/package.json': { name: '@demo/lib', main: 'src/index.ts' },
      'packages/lib-copy/src/index.ts': '',
    });
    expect(await resolve('packages/app/src/main.ts', '@demo/lib')).toEqual({ status: 'external' });
  });

  it('resolves file: dependencies, the package itself, and its private # imports', async () => {
    const { resolve } = project({
      'app/package.json': {
        name: 'app',
        dependencies: { shared: 'file:../shared', escaped: 'link:../../elsewhere' },
        exports: { './public': './src/public.ts' },
        imports: {
          '#internal/*': './src/internal/*.ts',
          '#config': { default: './src/config.ts' },
        },
      },
      'app/src/main.ts': '',
      'app/src/public.ts': '',
      'app/src/config.ts': '',
      'app/src/internal/db.ts': '',
      'shared/package.json': { name: 'shared-lib', main: 'index.js' },
      'shared/index.ts': '',
    });

    // 依赖名可以与目标清单里的名字不同：file: 指的是目录。
    expect(await resolve('app/src/main.ts', 'shared')).toEqual(
      found('shared/index.ts', 'package-entry')
    );
    expect(await resolve('app/src/main.ts', 'escaped')).toEqual({ status: 'external' });
    expect(await resolve('app/src/main.ts', 'app/public')).toEqual(
      found('app/src/public.ts', 'package-entry')
    );
    expect(await resolve('app/src/main.ts', '#internal/db')).toEqual(
      found('app/src/internal/db.ts', 'package-import')
    );
    expect(await resolve('app/src/main.ts', '#config')).toEqual(
      found('app/src/config.ts', 'package-import')
    );
    expect(await resolve('app/src/main.ts', '#unknown')).toEqual({ status: 'external' });
  });

  it('prefers a path alias over a package of the same name', async () => {
    const { resolve } = project({
      ...workspace,
      'packages/app/tsconfig.json': {
        compilerOptions: { paths: { '@demo/lib': ['./src/local-lib.ts'] } },
      },
      'packages/app/src/local-lib.ts': '',
    });
    expect(await resolve('packages/app/src/main.ts', '@demo/lib')).toEqual(
      found('packages/app/src/local-lib.ts', 'path-alias')
    );
  });
});
