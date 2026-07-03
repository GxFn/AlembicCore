#!/usr/bin/env node
/**
 * lint-ring-direction — recipe-pipeline 四环方向门禁(W8,2026-07-03)。
 *
 * 对两宿主(Alembic 主体/AlembicPlugin)的 lib/recipe-pipeline/{plan,generate,curate,sustain}
 * 扫描环间 import(相对路径+#recipe-pipeline/* 别名两形态),按方向公理把门:
 *   - plan 是纯上游环:禁 import 其他任何环(它只吃 Core 契约与仓内事实层);
 *   - curate 是纯门禁环:禁 import 其他任何环(它只委托 Core validateAgainst);
 *   - generate↔sustain 是纠缠执行双环(rescan 属 Generate 执行但触发 Sustain 机制),
 *     双向放行——这是实扫接受的领域现实(2026-07-03 基线:主体 g→p 2/s→g 4;
 *     Plugin g→p 4/g→c 1/g→s 4/s→g 1),不是理想主义矩阵。
 *
 * 用法(仿 lint-retired-symbols 跨仓消费模式):
 *   node ../AlembicCore/scripts/lint-ring-direction.mjs <targetRepoRoot>
 * 环内部相对引用与对环外(根件 contracts/vector、事实层、Core 包)引用不归本门禁。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const RINGS = ['plan', 'generate', 'curate', 'sustain'];
// 方向矩阵:from -> 允许到达的环集合
const ALLOWED = {
  plan: new Set(),
  curate: new Set(),
  generate: new Set(['plan', 'curate', 'sustain']),
  sustain: new Set(['generate', 'plan']),
};

const targetRoot = process.argv[2];
if (!targetRoot) {
  console.error('usage: lint-ring-direction.mjs <targetRepoRoot>');
  process.exit(2);
}
const pipelineRoot = path.join(targetRoot, 'lib', 'recipe-pipeline');

const violations = [];

function ringOfResolved(resolvedPath) {
  const rel = path.relative(pipelineRoot, resolvedPath);
  if (rel.startsWith('..')) {
    return null;
  }
  const seg = rel.split(path.sep)[0];
  return RINGS.includes(seg) ? seg : null;
}

function scanFile(filePath, fromRing) {
  const content = readFileSync(filePath, 'utf8');
  const dir = path.dirname(filePath);
  const specRe = /(?:from\s+|import\s+|import\()'([^']+)'/g;
  for (const m of content.matchAll(specRe)) {
    const spec = m[1];
    let toRing = null;
    if (spec.startsWith('.')) {
      toRing = ringOfResolved(path.normalize(path.join(dir, spec)));
    } else if (spec.includes('#recipe-pipeline/')) {
      const seg = spec.split('#recipe-pipeline/')[1].split('/')[0];
      toRing = RINGS.includes(seg) ? seg : null;
    }
    if (toRing && toRing !== fromRing && !ALLOWED[fromRing].has(toRing)) {
      violations.push(
        `${path.relative(targetRoot, filePath)}: ring edge ${fromRing} -> ${toRing} (${spec}) violates the ring-direction axiom`
      );
    }
  }
}

function walk(dir, fromRing) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, fromRing);
    } else if (/\.ts$/.test(entry)) {
      scanFile(full, fromRing);
    }
  }
}

for (const ring of RINGS) {
  walk(path.join(pipelineRoot, ring), ring);
}

if (violations.length > 0) {
  console.error(`✗ ring-direction violations (${violations.length}):`);
  for (const v of violations.slice(0, 40)) {
    console.error(`  ${v}`);
  }
  console.error(
    'Fix: plan/curate must stay pure (Core contracts + repo fact layers only); route the dependency through generate/sustain or sink the shared piece to Core.'
  );
  process.exit(1);
}
console.log('✓ ring direction clean (plan/curate pure; generate<->sustain entangled pair allowed)');
