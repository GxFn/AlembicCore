/**
 * maint-fix-core — getFileDiff / assessFileImpact 可选 revisionRange 两路单测
 *
 * 验收1 默认零回归：不传 revisionRange → 仍 `git diff HEAD`（工作树）；未提交改动可见、已提交后为空
 *   （committed→propose 漏报的 BUG 根因）。
 * 验收2 commit-range：改动已提交、工作树为空时，传 revisionRange='HEAD~1..HEAD' →
 *   getFileDiff / assessFileImpact 仍取得到 committed 改动并得非空 impact（修复 committed→propose）。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assessFileImpact } from '../../src/service/evolution/ContentImpactAnalyzer.js';
import { getFileDiff } from '../../src/shared/diffParser.js';
import type { RecipeTokens } from '../../src/shared/recipeTokens.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

// 建一个可提交的隔离临时 git 仓（不依赖全局 git config / gpg 签名）。
function setupRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'alembic-core-range-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@alembic.local']);
  git(root, ['config', 'user.name', 'Alembic Test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  return root;
}

function writeFile(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

const REL = 'src/widget.ts';

describe('maint-fix-core — diffParser.getFileDiff revisionRange', () => {
  it('验收1 默认零回归：不传 revisionRange → 工作树 `git diff HEAD`（未提交可见、已提交为空）', () => {
    const root = setupRepo();
    try {
      writeFile(root, REL, 'export function makeWidget() { return 1; }\n');
      git(root, ['add', '-A']);
      git(root, ['commit', '-q', '-m', 'baseline']);

      // 工作树有未提交改动 → 默认路径取得到（行为与改前一致）
      writeFile(root, REL, 'export function makeWidgetAsync() { return 2; }\n');
      const wt = getFileDiff(root, REL);
      expect(wt).not.toBeNull();
      expect(wt).toContain('makeWidgetAsync');

      // 提交后工作树干净 → 默认路径为空（committed→propose BUG 根因，零回归保留此语义）
      git(root, ['add', '-A']);
      git(root, ['commit', '-q', '-m', 'rename to async']);
      expect(getFileDiff(root, REL)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('验收2 commit-range：改动已提交、工作树空时，revisionRange 仍取得到 diff', () => {
    const root = setupRepo();
    try {
      writeFile(root, REL, 'export function makeWidget() {}\n');
      git(root, ['add', '-A']);
      git(root, ['commit', '-q', '-m', 'baseline']);
      writeFile(root, REL, 'export function makeWidgetAsync() {}\n');
      git(root, ['add', '-A']);
      git(root, ['commit', '-q', '-m', 'change']);

      // 默认工作树为空（commit 后）
      expect(getFileDiff(root, REL)).toBeNull();
      // commit-range 取得到改动
      const ranged = getFileDiff(root, REL, 'HEAD~1..HEAD');
      expect(ranged).not.toBeNull();
      expect(ranged).toContain('makeWidgetAsync');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('maint-fix-core — ContentImpactAnalyzer.assessFileImpact revisionRange', () => {
  const recipeTokens: RecipeTokens = {
    tokens: new Set(['makeWidgetAsync']),
    sources: new Map(),
  };

  it('验收2 committed 改动经 revisionRange 得非空 impact；默认工作树为 null', () => {
    const root = setupRepo();
    try {
      writeFile(root, REL, 'export function makeWidget() {}\n');
      git(root, ['add', '-A']);
      git(root, ['commit', '-q', '-m', 'baseline']);
      writeFile(root, REL, 'export function makeWidgetAsync() {}\n');
      git(root, ['add', '-A']);
      git(root, ['commit', '-q', '-m', 'change']);

      // 默认工作树：committed 改动不可见 → null（漏报）
      expect(assessFileImpact(root, REL, recipeTokens)).toBeNull();
      // revisionRange：committed 改动可评估，命中 token
      const impact = assessFileImpact(root, REL, recipeTokens, 'HEAD~1..HEAD');
      expect(impact).not.toBeNull();
      expect(impact?.matchedTokens).toContain('makeWidgetAsync');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
