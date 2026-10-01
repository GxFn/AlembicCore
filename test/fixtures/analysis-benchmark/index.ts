import fs from 'node:fs/promises';
import path from 'node:path';
import { objcAppFixture } from './objcApp.js';
import { swiftAppFixture } from './swiftApp.js';
import { tsNodeNextFixture } from './tsNodeNext.js';
import { tsxBundlerFixture } from './tsxBundler.js';
import type {
  AnalysisBenchmarkFixture,
  BenchmarkLinkSource,
  BenchmarkRelationKind,
} from './types.js';

export type {
  AnalysisBenchmarkFixture,
  BenchmarkExpectation,
  BenchmarkLinkSource,
  BenchmarkMustNot,
  BenchmarkRelationKind,
} from './types.js';

/** 四种主要语言各一个夹具；顺序即报告顺序。 */
export const ANALYSIS_BENCHMARK_FIXTURES: readonly AnalysisBenchmarkFixture[] = [
  tsNodeNextFixture,
  tsxBundlerFixture,
  swiftAppFixture,
  objcAppFixture,
];

/** 引擎实际给出的一条已解析关系；未解析的调用点不进入这里。 */
export interface ObservedRelation {
  kind: BenchmarkRelationKind;
  fromFile: string;
  /** 调用点所在行（1 起）。 */
  line: number;
  toFile: string;
  /** 目标符号名；可带容器（`Type.member`），也可只有成员名。 */
  toSymbol: string;
  toQualifiedName?: string;
}

export interface BenchmarkScore {
  /** 每类链接来源的 [命中, 期望总数]。 */
  found: Record<BenchmarkLinkSource, [number, number]>;
  /** 未命中的期望，按 `标记 -> 目标` 列出，便于定位。 */
  missing: string[];
  /** 出现在禁止行上的已解析关系。 */
  violations: string[];
}

interface MarkerLocation {
  file: string;
  line: number;
}

const MARKER = /\/\/ @([\w.]+)\s*$/;

/** 把夹具写到给定目录；调用方负责创建与清理临时根。 */
export async function materializeBenchmarkFixture(
  fixture: AnalysisBenchmarkFixture,
  projectRoot: string
): Promise<void> {
  for (const [file, source] of Object.entries(fixture.files)) {
    const target = path.join(projectRoot, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, source);
  }
}

/** 标记必须全局唯一；重复或缺失说明夹具写错了，直接抛错而不是算作引擎未命中。 */
export function locateBenchmarkMarkers(
  fixture: AnalysisBenchmarkFixture
): Map<string, MarkerLocation> {
  const markers = new Map<string, MarkerLocation>();
  for (const [file, source] of Object.entries(fixture.files)) {
    source.split('\n').forEach((text, index) => {
      const id = MARKER.exec(text)?.[1];
      if (!id) {
        return;
      }
      if (markers.has(id)) {
        throw new Error(`Benchmark fixture ${fixture.name} repeats marker @${id}.`);
      }
      markers.set(id, { file, line: index + 1 });
    });
  }
  for (const id of [...fixture.expected, ...fixture.mustNot].map((item) => item.at)) {
    if (!markers.has(id)) {
      throw new Error(`Benchmark fixture ${fixture.name} references missing marker @${id}.`);
    }
  }
  return markers;
}

/**
 * 目标符号按"成员名 + 可选容器"比较：引擎可以只报成员名，也可以报 `Type.member`；
 * 报了容器就必须与期望一致，不能把同名方法算到别的类型头上。
 */
function matchesSymbol(observed: ObservedRelation, expected: string): boolean {
  const candidates = [observed.toSymbol, observed.toQualifiedName].flatMap((value) =>
    value ? [value.replaceAll('::', '.')] : []
  );
  const member = expected.includes('.') ? expected.slice(expected.indexOf('.') + 1) : expected;
  return candidates.some((value) => value === expected || value === member);
}

export function scoreBenchmarkFixture(
  fixture: AnalysisBenchmarkFixture,
  observed: readonly ObservedRelation[]
): BenchmarkScore {
  const markers = locateBenchmarkMarkers(fixture);
  const score: BenchmarkScore = {
    found: { lexical: [0, 0], 'import-binding': [0, 0], external: [0, 0], future: [0, 0] },
    missing: [],
    violations: [],
  };
  for (const expected of fixture.expected) {
    const site = markers.get(expected.at)!;
    const tally = score.found[expected.via];
    tally[1] += 1;
    const hit = observed.some(
      (relation) =>
        // file-flow 把 `new T()` 也报成 calls；实例化期望接受指向该类型的 calls。
        (relation.kind === expected.kind ||
          (expected.kind === 'instantiates' && relation.kind === 'calls')) &&
        relation.fromFile === site.file &&
        relation.line === site.line &&
        relation.toFile === expected.toFile &&
        matchesSymbol(relation, expected.toSymbol)
    );
    if (hit) {
      tally[0] += 1;
    } else {
      score.missing.push(`@${expected.at} -> ${expected.toFile}#${expected.toSymbol}`);
    }
  }
  for (const forbidden of fixture.mustNot) {
    const site = markers.get(forbidden.at)!;
    for (const relation of observed) {
      if (relation.fromFile === site.file && relation.line === site.line) {
        score.violations.push(
          `@${forbidden.at} resolved to ${relation.toFile}#${relation.toSymbol} (${forbidden.reason})`
        );
      }
    }
  }
  return score;
}
