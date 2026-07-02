#!/usr/bin/env node
/**
 * lint-retired-symbols — S4 概念层重命名的旧词回流门禁(批5)。
 *
 * 扫描目标仓的 ts/tsx/mjs 源码,发现 config/retired-symbols.json 中的退役符号
 * (bootstrap→generate、projectIndex 消灭、EvolutionGateway→ProposalGateway 等
 * 137+29 个旧名)即失败——防止重命名后的旧词经复制粘贴/旧分支合并回流。
 *
 * 用法(仿 lint-consumer-core-imports 的跨仓消费模式):
 *   node ../AlembicCore/scripts/lint-retired-symbols.mjs <targetRepoRoot> [--dirs lib,src,bin,test]
 * 白名单:config 的 allowlistPathSubstrings(RG9 shim/兼容壳/migrations/反向守卫测试)。
 * wire 冻结值(表名/事件名/状态值)不归本门禁——它们是合法保留串,见 docs/wire-contract.md。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(
  readFileSync(path.join(scriptDir, '..', 'config', 'retired-symbols.json'), 'utf8')
);

const targetRoot = process.argv[2];
if (!targetRoot) {
  console.error('usage: lint-retired-symbols.mjs <targetRepoRoot> [--dirs lib,src,bin,test]');
  process.exit(2);
}
const dirsArg = process.argv.find((a) => a.startsWith('--dirs'));
const scanDirs = (dirsArg ? dirsArg.split('=')[1] : 'src,lib,bin,test').split(',');

const EXCLUDE_DIRS = new Set(['node_modules', 'dist', 'vendor', 'generated', '.git']);
const patterns = config.retiredSymbols.map((s) => ({
  name: s,
  re: new RegExp(`\\b${s}\\b`),
}));

const violations = [];
function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry)) {
      continue;
    }
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
    } else if (/\.(ts|tsx|mjs)$/.test(entry)) {
      const rel = path.relative(targetRoot, full);
      if (config.allowlistPathSubstrings.some((sub) => rel.includes(sub))) {
        continue;
      }
      const content = readFileSync(full, 'utf8');
      for (const { name, re } of patterns) {
        if (re.test(content)) {
          violations.push(`${rel}: retired symbol "${name}"`);
        }
      }
    }
  }
}

for (const d of scanDirs) {
  walk(path.join(targetRoot, d));
}

if (violations.length > 0) {
  console.error(`✗ retired-symbol violations (${violations.length}):`);
  for (const v of violations.slice(0, 40)) {
    console.error(`  ${v}`);
  }
  process.exit(1);
}
console.log('✓ no retired symbols found');
