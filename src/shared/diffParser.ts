/**
 * diffParser — Git diff 获取与解析
 *
 * 通过 `git diff -U0` 获取文件的行级变更内容，
 * 解析 unified diff 格式，提取变更行中的代码标识符。
 *
 * @module shared/diffParser
 */

import { execFileSync } from 'node:child_process';
import { tokenizeIdentifiers } from './recipeTokens.js';

/* ────────────── Types ────────────── */

export interface DiffHunk {
  /** 删除的行（- 前缀，已去掉前缀） */
  removedLines: string[];
  /** 新增的行（+ 前缀，已去掉前缀） */
  addedLines: string[];
}

/* ────────────── Public API ────────────── */

/**
 * 获取文件的 git diff 内容（unified format，零上下文行）。
 *
 * @param projectRoot 项目根目录绝对路径
 * @param relativePath 相对于项目根的文件路径
 * @param revisionRange 可选 git 修订范围（如 `mergeBase..HEAD`）。
 *   缺省 → `git diff HEAD`（工作树，含 staged+unstaged；改动一旦 commit 即为空）——与改前字节兼容。
 *   给定 → `git diff <revisionRange>`（commit-range）：用于「改动已提交、工作树为空」场景，
 *   使 committed-impactful 改动仍可被影响评估（committed→propose 修复，maint-fix-core）。
 * @returns diff 文本，或 null（无 git / untracked / 无变更）
 */
export function getFileDiff(
  projectRoot: string,
  relativePath: string,
  revisionRange?: string
): string | null {
  try {
    // 默认 `git diff HEAD`（工作树）；给定 revisionRange 时切到 commit-range diff。
    // revisionRange 作为单个 git 修订实参传入 execFileSync（无 shell，`..` 范围语法安全）。
    // 仅替换 diff 源，-U0/--/路径 与降级语义不变，缺省路径与改前逐字节一致。
    const diffTarget = revisionRange ?? 'HEAD';
    const output = execFileSync('git', ['diff', diffTarget, '-U0', '--', relativePath], {
      cwd: projectRoot,
      encoding: 'utf8',
      // 测试夹具或真实项目可能不是 git worktree；这里是可选增强路径，失败时必须安静降级。
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    return output || null;
  } catch {
    return null;
  }
}

/**
 * 解析 unified diff 文本，提取变更行。
 *
 * 根据 @@ 行数识别 hunk 边界，忽略文件头与上下文行。
 */
export function parseDiffHunks(diffText: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldRemaining = 0;
  let newRemaining = 0;

  for (const line of diffText.split('\n')) {
    const header = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (header) {
      if (current && (current.removedLines.length > 0 || current.addedLines.length > 0)) {
        hunks.push(current);
      }
      current = { removedLines: [], addedLines: [] };
      oldRemaining = Number(header[1] ?? 1);
      newRemaining = Number(header[2] ?? 1);
    } else if (current !== null && (oldRemaining > 0 || newRemaining > 0)) {
      // hunk 内的 ---/+++ 可能是 --/++ 源码加上 diff 前缀，不能按文本判作文件头。
      // 行数耗尽后停止消费，后续文件头不会混入上一段变更。
      if (line.startsWith('-')) {
        current.removedLines.push(line.slice(1));
        oldRemaining--;
      } else if (line.startsWith('+')) {
        current.addedLines.push(line.slice(1));
        newRemaining--;
      } else if (line.startsWith(' ')) {
        oldRemaining--;
        newRemaining--;
      }
    }
  }

  if (current && (current.removedLines.length > 0 || current.addedLines.length > 0)) {
    hunks.push(current);
  }

  return hunks;
}

/**
 * 从 diff hunks 中提取所有代码标识符。
 *
 * 同时包含 removed 和 added 行：
 *   - removed：捕获「删除了 Recipe 描述的 API」
 *   - added：捕获「新增了与 Recipe 冲突的 API」
 */
export function tokenizeDiffLines(hunks: DiffHunk[]): Set<string> {
  const allLines = hunks.flatMap((h) => [...h.removedLines, ...h.addedLines]);
  const text = allLines.join('\n');
  return new Set(tokenizeIdentifiers(text));
}
