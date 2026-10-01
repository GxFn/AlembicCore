import type { AnalysisBenchmarkFixture } from './types.js';

const manifest = (value: object): string => `${JSON.stringify(value, null, 2)}\n`;

/**
 * TS monorepo：包与包之间按包名导入。四种入口写法各一个包——
 * 直接指向源码、exports 子路径、指向构建产物但有编译配置说明对应关系、指向构建产物且没有配置。
 * 前三种由自有的 import 绑定解析并有配置为证；最后一种只能按"dist 对应 src"的惯例找回源码。
 */
export const tsMonorepoFixture: AnalysisBenchmarkFixture = {
  name: 'ts-monorepo',
  language: 'typescript',
  files: {
    'package.json': manifest({ name: 'bench-monorepo', private: true, workspaces: ['packages/*'] }),
    'packages/app/package.json': manifest({
      name: '@bench/app',
      imports: { '#internal/*': './src/internal/*.ts' },
      dependencies: {
        '@bench/core': 'workspace:*',
        '@bench/tools': 'workspace:*',
        '@bench/ui': 'workspace:*',
        'left-pad': '^1.3.0',
      },
    }),
    'packages/app/src/internal/audit.ts': `export function audit(event: string): string {
  return event;
}
`,
    'packages/app/src/main.ts': `import { createStore } from '@bench/core';
import { formatMoney } from '@bench/core/format';
import { fixtureOnly } from '@bench/fixture';
import { compile } from '@bench/tools';
import { renderButton } from '@bench/ui';
import leftPad from 'left-pad';
import { audit } from '#internal/audit';

export function main(): string {
  const store = createStore(); // @main.createStore
  audit('start'); // @main.audit
  const price = formatMoney(store.total); // @main.formatMoney
  compile(price); // @main.compile
  renderButton(price); // @main.renderButton
  fixtureOnly(); // @main.fixtureOnly
  return leftPad(price, 8); // @main.leftPad
}
`,
    // 条件里有指向源码的一项；主入口经 barrel 转发到声明。
    'packages/core/package.json': manifest({
      name: '@bench/core',
      exports: {
        '.': { types: './dist/index.d.ts', source: './src/index.ts', default: './dist/index.js' },
        './format': './src/format.ts',
      },
    }),
    'packages/core/src/index.ts': `export { createStore } from './store.js';
`,
    'packages/core/src/store.ts': `export function createStore(): { total: number } {
  return { total: 0 };
}
`,
    'packages/core/src/format.ts': `export function formatMoney(value: number): string {
  return value.toFixed(2); // @format.toFixed
}
`,
    // 入口写的是构建产物；包自己的编译配置写明了产物目录与源码根。
    'packages/tools/package.json': manifest({
      name: '@bench/tools',
      main: './build/index.js',
      types: './build/index.d.ts',
    }),
    'packages/tools/tsconfig.json': manifest({
      compilerOptions: { outDir: './build', rootDir: './lib-src' },
    }),
    'packages/tools/lib-src/index.ts': `export function compile(text: string): string {
  return text;
}
`,
    // 入口写的是构建产物，没有任何配置说明源码在哪。
    'packages/ui/package.json': manifest({
      name: '@bench/ui',
      main: './dist/index.js',
      types: './dist/index.d.ts',
    }),
    'packages/ui/src/index.ts': `export function renderButton(label: string): string {
  return label;
}
`,
    // 不在 workspace 的成员模式里：清单写着同样的包名也不是这个导入的目标。
    'fixtures/sample/package.json': manifest({ name: '@bench/fixture', main: './index.ts' }),
    'fixtures/sample/index.ts': `export function fixtureOnly(): void {}
`,
  },
  expected: [
    {
      kind: 'calls',
      at: 'main.createStore',
      toFile: 'packages/core/src/store.ts',
      toSymbol: 'createStore',
      via: 'import-binding',
    },
    {
      kind: 'calls',
      at: 'main.audit',
      toFile: 'packages/app/src/internal/audit.ts',
      toSymbol: 'audit',
      via: 'import-binding',
    },
    {
      kind: 'calls',
      at: 'main.formatMoney',
      toFile: 'packages/core/src/format.ts',
      toSymbol: 'formatMoney',
      via: 'import-binding',
    },
    {
      kind: 'calls',
      at: 'main.compile',
      toFile: 'packages/tools/lib-src/index.ts',
      toSymbol: 'compile',
      via: 'import-binding',
    },
    {
      kind: 'calls',
      at: 'main.renderButton',
      toFile: 'packages/ui/src/index.ts',
      toSymbol: 'renderButton',
      via: 'convention',
    },
  ],
  mustNot: [
    { at: 'main.fixtureOnly', reason: '同名清单不在 workspace 成员里，不是这个导入的目标' },
    { at: 'main.leftPad', reason: 'left-pad 是项目外的包' },
    { at: 'format.toFixed', reason: 'Number.prototype.toFixed 不是项目内符号' },
  ],
};
