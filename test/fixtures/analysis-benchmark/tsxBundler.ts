import type { AnalysisBenchmarkFixture } from './types.js';

/**
 * TSX + bundler 写法：相对导入不带扩展名，另有 tsconfig paths 别名。
 * 相对导入归自有的 import 绑定解析；`@/` 别名需要读 tsconfig，归外部索引器补位。
 */
export const tsxBundlerFixture: AnalysisBenchmarkFixture = {
  name: 'tsx-bundler',
  language: 'tsx',
  files: {
    'package.json': '{ "name": "tsx-bundler-fixture", "private": true }\n',
    'tsconfig.json': `{
  "compilerOptions": {
    "baseUrl": ".",
    "jsx": "react-jsx",
    "paths": { "@/*": ["src/*"] }
  }
}
`,
    'src/hooks/useCounter.ts': `export function useCounter(initial: number): { value: number } {
  return { value: initial };
}
`,
    'src/lib/format.ts': `export function formatCount(value: number): string {
  return '#' + value.toFixed(0); // @format.toFixed
}

export function parseCount(text: string): number {
  return Number(text.slice(1));
}
`,
    'src/components/Badge.tsx': `import { formatCount } from '../lib/format';

export function Badge(props: { value: number }) {
  const label = formatCount(props.value); // @badge.format
  return <span>{label}</span>;
}
`,
    'src/App.tsx': `import { useCounter } from '@/hooks/useCounter';
import { Badge } from './components/Badge';
import { parseCount } from './lib/format';

export function App() {
  const counter = useCounter(parseCount('#1')); // @app.useCounter
  const doubled = [counter.value].map((value) => value * 2); // @app.map
  return <Badge value={doubled[0]} />; // @app.badge
}
`,
  },
  expected: [
    {
      kind: 'calls',
      at: 'badge.format',
      toFile: 'src/lib/format.ts',
      toSymbol: 'formatCount',
      via: 'import-binding',
    },
    {
      kind: 'calls',
      at: 'app.useCounter',
      toFile: 'src/lib/format.ts',
      toSymbol: 'parseCount',
      via: 'import-binding',
    },
    {
      kind: 'calls',
      at: 'app.badge',
      toFile: 'src/components/Badge.tsx',
      toSymbol: 'Badge',
      via: 'import-binding',
    },
    {
      kind: 'calls',
      at: 'app.useCounter',
      toFile: 'src/hooks/useCounter.ts',
      toSymbol: 'useCounter',
      via: 'external',
    },
  ],
  mustNot: [
    { at: 'app.map', reason: 'Array.prototype.map 不是项目内符号' },
    { at: 'format.toFixed', reason: 'Number.prototype.toFixed 不是项目内符号' },
  ],
};
