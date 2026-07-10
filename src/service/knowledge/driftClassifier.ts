/**
 * driftClassifier — 源锚漂移的精判(G-C P3,纯函数)。
 *
 * SourceRefReconciler 能判"区间指纹变了=drifted",但 drifted 有两种性质完全不同的原因:
 *   1) 行号漂移(line-shift):被引代码块内容没变,只是文件上方增删了行导致它整体位移——
 *      锚点仍指向语义相关代码,理想处置是把 range 修到新位置(而非当作知识过期)。
 *   2) 内容实变(content-change):被引区间的代码本身改了——知识可能真的过期,应升 proposal 复核。
 *
 * 本分类器给定【漂移前文件全文】+【漂移后文件全文】+【原始区间】,判定属于哪一种:
 *   - 从旧文件按原区间截出"旧代码块";
 *   - 在新文件里逐字查找该块(整块连续匹配);
 *   - 找到→line-shift,返回新区间(供上层决定是否自动修 range);找不到→content-change。
 * 纯函数、无 IO、无副作用:旧内容由调用方经 gitBlob.readFileAtCommit 提供;拿不到旧内容时
 * 调用方不应调用本函数(维持粗粒度 drifted),而不是喂空串误判。
 */

export type RegionDriftKind = 'line-shift' | 'content-change' | 'unresolved';

export interface RegionDriftClassification {
  kind: RegionDriftKind;
  /** kind==='line-shift' 时给出新区间(1-based,含端点);其余为 null。 */
  newRange: { start: number; end: number } | null;
}

/** 按行拆分并做行尾归一(与 computeSourceRegionFingerprint 的 region 口径一致)。 */
function splitLines(content: string): string[] {
  return content.split(/\r\n|\n|\r/);
}

/** 截取 1-based 闭区间的行块(越界安全:clamp 到文件范围)。 */
function sliceRegion(lines: readonly string[], start: number, end: number): string[] {
  const from = Math.max(1, start);
  const to = Math.min(lines.length, end);
  if (from > to) {
    return [];
  }
  return lines.slice(from - 1, to);
}

/** 在 haystack 行数组里查找 needle 行块的首个整块连续匹配,返回 0-based 起始行或 -1。 */
function findBlock(haystack: readonly string[], needle: readonly string[]): number {
  if (needle.length === 0 || needle.length > haystack.length) {
    return -1;
  }
  const last = haystack.length - needle.length;
  for (let i = 0; i <= last; i++) {
    let matched = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return i;
    }
  }
  return -1;
}

/**
 * 分类漂移。range 为原始 1-based 闭区间(缺省端点按 SourceRefReconciler 口径由调用方补全)。
 * - 旧区间截空 → unresolved(无从判定,调用方维持粗粒度 drifted);
 * - 旧块在新文件整块出现 → line-shift + 新区间;
 * - 否则 → content-change。
 */
export function classifyRegionDrift(
  oldFileContent: string,
  newFileContent: string,
  range: { start: number; end: number }
): RegionDriftClassification {
  const oldLines = splitLines(oldFileContent);
  const oldRegion = sliceRegion(oldLines, range.start, range.end);
  if (oldRegion.length === 0) {
    return { kind: 'unresolved', newRange: null };
  }
  const newLines = splitLines(newFileContent);
  const at = findBlock(newLines, oldRegion);
  if (at < 0) {
    return { kind: 'content-change', newRange: null };
  }
  const newStart = at + 1;
  return {
    kind: 'line-shift',
    newRange: { start: newStart, end: newStart + oldRegion.length - 1 },
  };
}
