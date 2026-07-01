/**
 * depthReview.ts — SECTION 8 (P0/C4): 确定性的「深度接地裁判」。
 *
 * reviewRecipeDepth 判断 recipe 的深度是否「既真捕获、又真接地」。核心防刷分口径：
 *   - 接地 = 深度论述里出现的 file:line 命中 gate 已解析成功的 validSourcePaths(真实存在的文件行)。
 *   - 绝不做关键词计数——塞「边界」「失败模式」等词但无真实 file:line 一律不算(anti-gaming)。
 *   - 多来源 = 深度论述跨到 ≥2 处不同的已解析文件(synthesis)，而非同一处重复计数。
 *
 * 判定偏宽松鼓励：结果只用于驱动生成期 retry / 评分对齐 / 指引提示，绝不硬拒(不倒退门禁 floor)。
 * 纯函数：无 fs、无 host import。validSourcePaths 由调用方(gate 侧已注入 resolver 解析后)传入。
 */
import { DEPTH_DIMENSIONS } from './depthContract.js';

/**
 * 在 markdown 正文里探测散落的 file:line 引用(与 gateRules 的 SOURCE_REF 同语义，但用于正文内联，
 * 如「(来源: lib/foo.ts:10-18)」)。仅取形如 path.ext:line[-end] 的片段。
 */
const PROSE_SOURCE_REF_RE = /([A-Za-z0-9_./-]+\.[A-Za-z0-9_]{1,10}):(\d+)(?:-\d+)?/g;

export interface DepthReviewInput {
  /** content.markdown 正文(深度分节通常挂在 `## 设计意图` 等标题下)。 */
  markdown: string;
  /** 结构化深度字段(填了就并入对应维度的接地判定；均可选)。 */
  boundaries?: readonly string[];
  preconditions?: readonly string[];
  sideEffects?: readonly string[];
  verification?: string;
  alternatives?: readonly string[];
}

export interface DepthReviewResult {
  /** 已接地覆盖的深度维度 key(DEPTH_DIMENSIONS.key)。 */
  grounded: string[];
  /** 未覆盖或有论述但未接地的维度 key。 */
  missing: string[];
  /** 有深度论述但引用未解析成功(疑似编造/占位)或缺 file:line 的片段摘要——只作提示，不硬拒。 */
  ungroundedClaims: string[];
  /** 深度论述跨到的、已解析成功的不同文件数(多来源判定依据)。 */
  groundedFileCount: number;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

/** prose 里的 path 是否命中 validSourcePaths(容错后缀匹配，兼容 repo-relative 与带前缀两种口径)。 */
function refIsGrounded(path: string, validSet: ReadonlySet<string>): boolean {
  const normalized = normalizePath(path);
  if (validSet.has(normalized)) {
    return true;
  }
  for (const valid of validSet) {
    if (
      valid === normalized ||
      valid.endsWith(`/${normalized}`) ||
      normalized.endsWith(`/${valid}`)
    ) {
      return true;
    }
  }
  return false;
}

/** 从一段文本抽取内联 file:line 引用及其接地状态。 */
function extractRefs(
  text: string,
  validSet: ReadonlySet<string>
): Array<{ path: string; grounded: boolean }> {
  const refs: Array<{ path: string; grounded: boolean }> = [];
  for (const match of text.matchAll(PROSE_SOURCE_REF_RE)) {
    const path = normalizePath(match[1] ?? '');
    if (path) {
      refs.push({ path, grounded: refIsGrounded(path, validSet) });
    }
  }
  return refs;
}

/**
 * 分节标题是否对应某深度维度。双向包含：兼容作者用完整 label(`## 设计权衡`)或惯用短标题(`## 权衡`)。
 * 短标题至少 2 字以防误匹配。
 */
function sectionMatchesDimension(heading: string, label: string): boolean {
  const trimmed = heading.trim();
  if (!trimmed) {
    return false;
  }
  return trimmed.includes(label) || (trimmed.length >= 2 && label.includes(trimmed));
}

/** 把 markdown 按 `## 标题` 分节(标题行 + 其后正文，直到下一标题)。 */
function splitSections(markdown: string): Array<{ heading: string; text: string }> {
  const sections: Array<{ heading: string; text: string }> = [];
  let heading = '';
  let body: string[] = [];
  const flush = (): void => {
    if (heading || body.length > 0) {
      sections.push({ heading, text: body.join('\n') });
    }
  };
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^#{1,4}\s+(.+?)\s*$/);
    if (match) {
      flush();
      heading = match[1] ?? '';
      body = [];
    } else {
      body.push(line);
    }
  }
  flush();
  return sections;
}

/**
 * reviewRecipeDepth — 对一个 recipe 候选做深度接地裁判。
 *
 * @param input recipe 的深度内容(markdown + 可选结构化字段)。
 * @param resolved gate 侧已解析成功的证据：validSourcePaths(真实存在的源文件相对路径)。
 * @returns 每个深度维度是否接地覆盖 + 疑似未接地论述 + 已接地文件数。
 */
export function reviewRecipeDepth(
  input: DepthReviewInput,
  resolved: { validSourcePaths: readonly string[]; validRanges?: readonly string[] }
): DepthReviewResult {
  const validSet: ReadonlySet<string> = new Set(
    (resolved.validSourcePaths ?? []).map(normalizePath)
  );
  const markdown = input.markdown || '';
  const sections = splitSections(markdown);

  // 各维度对应的结构化字段(填了就并入该维度的接地判定)。
  const structuredByKey: Partial<Record<string, string>> = {
    boundaries: [...(input.boundaries ?? []), ...(input.preconditions ?? [])].join('\n'),
    failureModes: `${(input.sideEffects ?? []).join('\n')}\n${input.verification ?? ''}`,
    tradeoffs: (input.alternatives ?? []).join('\n'),
  };

  const grounded: string[] = [];
  const missing: string[] = [];
  const ungroundedClaims: string[] = [];

  // 多来源 / groundedFileCount：统计【整篇正文 + 全部结构化字段】里已解析成功的不同文件。
  const allText = `${markdown}\n${Object.values(structuredByKey).join('\n')}`;
  const allGroundedFiles = new Set(
    extractRefs(allText, validSet)
      .filter((ref) => ref.grounded)
      .map((ref) => ref.path)
  );

  for (const dim of DEPTH_DIMENSIONS) {
    if (dim.key === 'multiSourceCorroboration') {
      // 单独按跨文件数判定(见下)。
      continue;
    }
    const sectionText = sections
      .filter((section) => sectionMatchesDimension(section.heading, dim.label))
      .map((section) => section.text)
      .join('\n');
    const structuredText = structuredByKey[dim.key] ?? '';
    const dimText = `${sectionText}\n${structuredText}`.trim();
    if (!dimText) {
      missing.push(dim.key);
      continue;
    }
    const refs = extractRefs(dimText, validSet);
    if (refs.some((ref) => ref.grounded)) {
      grounded.push(dim.key);
    } else {
      missing.push(dim.key);
      ungroundedClaims.push(
        refs.length > 0
          ? `${dim.label}: 引用未解析成功(疑似编造/占位)`
          : `${dim.label}: 深度论述缺真实 file:line`
      );
    }
  }

  if (allGroundedFiles.size >= 2) {
    grounded.push('multiSourceCorroboration');
  } else {
    missing.push('multiSourceCorroboration');
  }

  return {
    grounded,
    missing,
    ungroundedClaims,
    groundedFileCount: allGroundedFiles.size,
  };
}
