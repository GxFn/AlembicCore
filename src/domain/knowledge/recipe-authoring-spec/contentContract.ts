/**
 * content-contract.ts — SECTION 3.
 *
 * The single home for the recipe "项目特写" content contract:
 *   - PROJECT_SNAPSHOT_STYLE_GUIDE moved here verbatim from StyleGuide.ts:14-31 (StyleGuide.ts
 *     re-imports it, same-layer edge, so buildProducerStyleGuide keeps working byte-identically).
 *   - docScoreTargets encodes the QualityScorer#scoreContentDepth levers
 *     (src/service/quality/QualityScorer.ts:151-188) as explicit numeric targets so guidance can
 *     state the content bar the scorer actually rewards instead of re-deriving it by hand.
 *
 * Pure data only — no fs, no host imports.
 */

/** 「项目特写」写作指南全文 — verbatim from StyleGuide.ts:14-31 (single authoritative source). */
export const PROJECT_SNAPSHOT_STYLE_GUIDE = `# 「项目特写」写作要求

knowledge({ action: "submit" }) 的 content.markdown 字段必须是「项目特写」。

## 什么是「项目特写」
将一种技术的**基本用法**与**本项目的具体特征**融合为一体。

## 四大核心内容
1. **项目选择了什么** — 采用了哪种写法/模式/约定
2. **为什么这样选** — 统计分布、占比、历史决策
3. **项目禁止什么** — 反模式、已废弃写法
4. **新代码怎么写** — 可直接复制使用的代码模板 + 来源标注 (来源: FileName.ext:行号)

## 格式要求
- 标题使用项目真实类名/前缀，不用占位名，不以项目名开头
- 代码来源标注: (来源: FileName.ext:行号)
- 不要纯代码罗列，必须有项目上下文
- 标题和正文中不得出现 "Agent" 字样`;

/** One scored text lever: empty→0, <minLen→weight*0.2, ≤optimalLen→ramp, else full weight. */
export interface DocScoreTextTarget {
  minLen: number;
  optimalLen: number;
  weight: number;
}

/**
 * The content-depth targets the QualityScorer rewards (verbatim numeric levers from
 * QualityScorer#scoreContentDepth). Guidance renders these so authors aim at the exact bar
 * the scorer measures — no hand-copied thresholds.
 */
export interface DocScoreTargets {
  /** content.markdown length target (textScore(md, 50, 800, 0.3)). */
  markdownLength: DocScoreTextTarget;
  /** structural-marker bonuses applied when present in markdown. */
  structure: { heading: number; codeBlock: number; list: number };
  /** content.rationale (textScore(rationale, 10, 100, 0.15)). */
  rationale: DocScoreTextTarget;
  /** reasoning.whyStandard (textScore(whyStandard, 10, 100, 0.15)). */
  whyStandard: DocScoreTextTarget;
  /** reasoning.sources reward (min(cap, n * perSource)). */
  sources: { perSource: number; cap: number };
  /** usageGuide extra reward when it differs from markdown (textScore(usageGuide, 20, 200, 0.1)). */
  usageGuide: DocScoreTextTarget;
}

const DOC_SCORE_TARGETS: DocScoreTargets = {
  markdownLength: { minLen: 50, optimalLen: 800, weight: 0.3 },
  structure: { heading: 0.08, codeBlock: 0.08, list: 0.04 },
  rationale: { minLen: 10, optimalLen: 100, weight: 0.15 },
  whyStandard: { minLen: 10, optimalLen: 100, weight: 0.15 },
  sources: { perSource: 0.03, cap: 0.1 },
  usageGuide: { minLen: 20, optimalLen: 200, weight: 0.1 },
};

/** The recipe content contract: the style guide + the explicit scorer targets. */
export function contentContract(): { styleGuide: string; docScoreTargets: DocScoreTargets } {
  return {
    styleGuide: PROJECT_SNAPSHOT_STYLE_GUIDE,
    docScoreTargets: DOC_SCORE_TARGETS,
  };
}
