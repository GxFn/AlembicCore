/**
 * FsGraphRefVerifier.ts — 图引用的复核：引用里记的内容哈希是否仍是当前文件的哈希。
 *
 * 图门禁（recipe-authoring-spec 的 graph-evidence）自己不读盘；宿主把这个核验器注入进去之后，
 * 候选里的结构化图引用才会被逐条对着当前源码复核。它与关系查询的 evidence 用的是同一种哈希
 * （文件文本的短哈希），所以"查询时给出的引用"与"提交时的复核"判断一致。
 *
 * 只依赖 node:fs / node:path，没有宿主概念、网络与持久化。
 */
import fs from 'node:fs';
import path from 'node:path';

import { computeContentHash } from '../../shared/contentHash.js';
import type { RecipeGraphRefVerifier } from '../../types/recipeAuthoringSpec.js';

/** projectRoot 是否包含 absolutePath（防目录穿越）。 */
function isInsideRoot(projectRoot: string, absolutePath: string): boolean {
  const rel = path.relative(path.resolve(projectRoot), absolutePath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * 构造 fs-backed 的 `RecipeGraphRefVerifier`。
 *
 * - 引用所指的文件不在项目根内、或已经不存在：`GRAPH_REF_INVALID`——这条引用现在对不上任何源码。
 * - 文件还在但内容变了：`STALE_GRAPH`——引用是在旧内容上得出的，要重新查询。
 */
export function createFsGraphRefVerifier(): RecipeGraphRefVerifier {
  return ({ projectRoot, graphRef, filePath: rawPath, hash, itemIndex, title }) => {
    const filePath = path.posix.normalize(rawPath.replaceAll('\\', '/'));
    const absolutePath = path.resolve(projectRoot, filePath);
    if (
      path.isAbsolute(filePath) ||
      filePath.startsWith('..') ||
      !isInsideRoot(projectRoot, absolutePath) ||
      !fs.existsSync(absolutePath) ||
      !fs.statSync(absolutePath).isFile()
    ) {
      return {
        violation: {
          code: 'GRAPH_REF_INVALID',
          itemIndex,
          title,
          path: filePath,
          sourceRef: graphRef,
          message: 'Graph ref cites a file that is not in the project.',
          nextAction: 'Run the graph query again and cite a ref it returns.',
        },
      };
    }
    if (computeContentHash(fs.readFileSync(absolutePath, 'utf8')) !== hash) {
      return {
        violation: {
          code: 'STALE_GRAPH',
          itemIndex,
          title,
          path: filePath,
          sourceRef: graphRef,
          message: 'The cited file changed after this graph ref was produced.',
          nextAction: 'Run the graph query again and cite the fresh ref before submitting.',
        },
      };
    }
    return { ok: true };
  };
}
