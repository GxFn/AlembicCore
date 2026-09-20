import { estimateTokens } from '../../shared/tokenUtils.js';
import Logger from '../logging/Logger.js';

/** 两个公开分块入口共用规则；内部子块不再重复验证。 */
export function validateSplitBudget(maxChunkTokens: number, overlapTokens = 0) {
  // 非空文本至少估算为一个 token，不能接受会失去前进能力的预算。
  if (!(maxChunkTokens >= 1) || !(overlapTokens >= 0)) {
    Logger.warn('[Chunker] Invalid split budget', { maxChunkTokens, overlapTokens });
    throw new RangeError(
      'maxChunkTokens must be at least 1 and overlapTokens must be non-negative'
    );
  }
}

/** 已验证预算下的内部跨度算法；同步文本和 AST 叶子共用，不增加 package 出口。 */
export function fixedTextRanges(content: string, maxChunkTokens: number, overlapTokens: number) {
  const overlap = overlapTokens < maxChunkTokens ? overlapTokens : 0;
  if (overlapTokens > 0 && overlap === 0) {
    Logger.debug('[Chunker] Overlap consumes the budget; continuing without overlap', {
      maxChunkTokens,
      overlapTokens,
    });
  }
  const ranges: Array<{ start: number; end: number }> = [];
  let start = 0;
  while (start < content.length) {
    // ASCII 上界是快速路径；CJK/混合文本使用同一估算器收紧，不能固定按四字符切。
    let end = Math.min(content.length, start + Math.floor(maxChunkTokens * 4));
    if (estimateTokens(content.slice(start, end)) > maxChunkTokens) {
      let low = start;
      let high = end;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (estimateTokens(content.slice(start, middle)) <= maxChunkTokens) {
          low = middle;
        } else {
          high = middle - 1;
        }
      }
      end = low;
    }
    if (splitsSurrogatePair(content, end)) {
      end--;
    }
    if (end < content.length) {
      // 换行也占预算，不能把位于 end 的字符额外纳入当前块。
      const boundary = content.lastIndexOf('\n', end - 1);
      if (boundary > start + (end - start) * 0.5) {
        end = boundary + 1;
      }
    }
    ranges.push({ start, end });
    // 最后一块已经包含全文尾部，不能再为 overlap 单独产生一个重复尾块。
    if (end === content.length) {
      break;
    }

    let next = end;
    if (overlap > 0) {
      let low = Math.max(start, end - Math.floor(overlap * 4));
      let high = end;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (estimateTokens(content.slice(middle, end)) <= overlap) {
          high = middle;
        } else {
          low = middle + 1;
        }
      }
      next = splitsSurrogatePair(content, low) ? low + 1 : low;
    }
    // 行边界可能让实际块小于 overlap；保持既有“向前、不整块重复”的语义。
    start = next > start ? next : end;
  }
  return ranges;
}

function splitsSurrogatePair(content: string, offset: number): boolean {
  const before = content.charCodeAt(offset - 1);
  const after = content.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}
