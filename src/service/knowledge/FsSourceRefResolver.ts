/**
 * FsSourceRefResolver.ts — 可复用的 fs-backed 源码引用解析器（P5/C8 深度接地评分的宿主注入实现）。
 *
 * 背景：domain 层的 recipe-authoring-spec 保持 fs-free，把 on-disk 读取抽象为注入的 `RecipeSourceRefResolver`
 * port。门禁(validateAgainst)由宿主注入自己的 resolver；而 `KnowledgeService.updateQuality` 的深度接地评分
 * (C7/C8)也需要同一套「file:line 是否解析成真实文件行」的判定。两个宿主(AlembicPlugin host-agent + Alembic
 * 主体 in-process)必须用**同一** resolver 才能保证深度接地判定 parity（P6 双宿主一致性门），故把这份纯 fs +
 * 确定性的解析逻辑放在 Core 共享，而非各宿主各写一份。
 *
 * 只依赖 node:fs / node:path，无 host 概念、无网络、无持久化，产出与门禁 resolver 同义的 evidence/violation。
 * `resolveGroundedSourcePaths` 只消费成功项(evidence)、丢弃 violation，故 violation 文案从简即可。
 */
import fs from 'node:fs';
import path from 'node:path';

import type { RecipeSourceRefResolver } from '../../types/recipeAuthoringSpec.js';

/** projectRoot 是否包含 absolutePath（防目录穿越）。 */
function isInsideRoot(projectRoot: string, absolutePath: string): boolean {
  const rel = path.relative(path.resolve(projectRoot), absolutePath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * 构造一个 fs-backed 的 `RecipeSourceRefResolver`：校验 repo-relative 路径在项目根内、文件存在、行范围有效，
 * 成功返回 { evidence: { sourcePath, rangeText, filePath } }，失败返回 { violation }。判定口径与
 * AlembicPlugin 门禁 resolver 逐分支对齐（路径归一 → containment → 存在 → 行范围）。
 */
export function createFsSourceRefResolver(): RecipeSourceRefResolver {
  return ({
    projectRoot,
    sourcePath: rawPath,
    startLine,
    endLine,
    sourceRef,
    itemIndex,
    title,
  }) => {
    const sourcePath = path.posix.normalize(rawPath.replaceAll('\\', '/'));
    if (path.isAbsolute(sourcePath) || sourcePath.startsWith('..')) {
      return {
        violation: {
          code: 'SOURCE_REF_INVALID',
          itemIndex,
          sourceRef,
          title,
          message: 'Source ref must stay inside the project source root.',
          nextAction: 'Use a repo-relative source path under the current project.',
        },
      };
    }
    const absolutePath = path.resolve(projectRoot, sourcePath);
    if (!isInsideRoot(projectRoot, absolutePath)) {
      return {
        violation: {
          code: 'SOURCE_REF_INVALID',
          itemIndex,
          path: sourcePath,
          sourceRef,
          title,
          message: 'Source ref resolves outside the project source root.',
          nextAction: 'Use a source path under the current project root.',
        },
      };
    }
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      return {
        violation: {
          code: 'SOURCE_REF_NOT_FOUND',
          itemIndex,
          path: sourcePath,
          sourceRef,
          title,
          message: 'Source ref file does not exist.',
          nextAction: 'Check the repo-relative path and cite an existing source file.',
        },
      };
    }
    const lines = fs.readFileSync(absolutePath, 'utf8').split(/\r?\n/);
    if (startLine < 1 || endLine < startLine || endLine > lines.length) {
      return {
        violation: {
          code: 'SOURCE_REF_LINE_OUT_OF_RANGE',
          itemIndex,
          path: sourcePath,
          sourceRef,
          title,
          message: 'Source ref line range is outside the file.',
          nextAction: 'Use a valid line range from the current source file.',
        },
      };
    }
    return {
      evidence: {
        filePath: absolutePath,
        raw: sourceRef,
        rangeText: lines.slice(startLine - 1, endLine).join('\n'),
        sourcePath,
      },
    };
  };
}
