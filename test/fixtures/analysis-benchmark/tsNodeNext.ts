import type { AnalysisBenchmarkFixture } from './types.js';

/**
 * TypeScript + NodeNext 写法：import 说明符带 `.js`，真实文件是 `.ts`。
 * 覆盖具名、default、namespace、别名 re-export、星号 re-export、导入类的静态成员与实例化，
 * 以及两类不能解析成项目内目标的情况（参数遮蔽、标准库方法）。
 */
export const tsNodeNextFixture: AnalysisBenchmarkFixture = {
  name: 'ts-nodenext',
  language: 'typescript',
  files: {
    'package.json': '{ "name": "ts-nodenext-fixture", "type": "module" }\n',
    'src/math.ts': `export function add(a: number, b: number): number {
  return a + b;
}

export default function multiply(a: number, b: number): number {
  return a * b;
}

export class Calculator {
  static create(): Calculator {
    return new Calculator();
  }

  run(value: number): number {
    return this.double(value); // @math.thisDouble
  }

  double(value: number): number {
    return add(value, value); // @math.localAdd
  }
}
`,
    'src/util.ts': `export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max); // @util.mathMin
}

export function describe(value: number): string {
  return String(value); // @util.string
}
`,
    'src/barrel.ts': `export { add as sum } from './math.js';
export * from './util.js';
`,
    'src/app.ts': `import { clamp, sum } from './barrel.js';
import multiply, { add, Calculator } from './math.js';
import * as util from './util.js';

export function total(values: number[]): number {
  let result = 0;
  for (const value of values) {
    result = add(result, value); // @app.add
  }
  const bounded = clamp(result, 0, 100); // @app.clamp
  return sum(bounded, 1); // @app.sum
}

export function scale(value: number): number {
  return multiply(value, 2); // @app.multiply
}

export function build(): number {
  const created = Calculator.create(); // @app.create
  const other = new Calculator(); // @app.new
  const first = other.run(2); // @app.otherRun
  const second = created.run(1); // @app.factoryRun
  return first + second + Number(util.describe(3)); // @app.describe
}

export function shadowed(add: (a: number, b: number) => number): number {
  return add(1, 2); // @app.shadowedAdd
}

export function listed(values: number[]): string {
  return values.map((value) => String(value)).join(','); // @app.map
}
`,
  },
  expected: [
    {
      kind: 'calls',
      at: 'math.thisDouble',
      toFile: 'src/math.ts',
      toSymbol: 'Calculator.double',
      via: 'lexical',
    },
    { kind: 'calls', at: 'math.localAdd', toFile: 'src/math.ts', toSymbol: 'add', via: 'lexical' },
    { kind: 'calls', at: 'app.add', toFile: 'src/math.ts', toSymbol: 'add', via: 'import-binding' },
    {
      kind: 'calls',
      at: 'app.clamp',
      toFile: 'src/util.ts',
      toSymbol: 'clamp',
      via: 'import-binding',
    },
    { kind: 'calls', at: 'app.sum', toFile: 'src/math.ts', toSymbol: 'add', via: 'import-binding' },
    {
      kind: 'calls',
      at: 'app.multiply',
      toFile: 'src/math.ts',
      toSymbol: 'multiply',
      via: 'import-binding',
    },
    {
      kind: 'calls',
      at: 'app.create',
      toFile: 'src/math.ts',
      toSymbol: 'Calculator.create',
      via: 'import-binding',
    },
    {
      kind: 'instantiates',
      at: 'app.new',
      toFile: 'src/math.ts',
      toSymbol: 'Calculator',
      via: 'import-binding',
    },
    {
      kind: 'calls',
      at: 'app.describe',
      toFile: 'src/util.ts',
      toSymbol: 'describe',
      via: 'import-binding',
    },
    {
      kind: 'calls',
      at: 'app.otherRun',
      toFile: 'src/math.ts',
      toSymbol: 'Calculator.run',
      via: 'external',
    },
    {
      kind: 'calls',
      at: 'app.factoryRun',
      toFile: 'src/math.ts',
      toSymbol: 'Calculator.run',
      via: 'future',
    },
  ],
  mustNot: [
    { at: 'app.shadowedAdd', reason: '参数 add 遮蔽了同名 import，调用的是参数' },
    { at: 'app.map', reason: 'Array.prototype.map 与 String 都不是项目内符号' },
    { at: 'util.mathMin', reason: 'Math.min / Math.max 是运行时内建' },
    { at: 'util.string', reason: 'String 是运行时内建' },
  ],
};
