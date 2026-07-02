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

## 深度要求（真思考，不是填表）
正文必须承载**你真的挖到证据的洞察**：为何这样选而非替代方案、何时不适用、违反后最先坏什么、
放弃了什么换来什么、项目内的对照与例外。从中挑你有真实证据的角度深挖，以自然叙述融入正文
（用不用小节标题随你）；每个深度断言与 (来源: File:行号) 同句或同段，没证据的角度宁可不写。

## 格式要求
- 标题使用项目真实类名/前缀，不用占位名，不以项目名开头
- 代码来源标注: (来源: FileName.ext:行号)
- 不要纯代码罗列，必须有项目上下文
- 标题和正文中不得出现 "Agent" 字样`;

/**
 * VALUE_RUBRIC — 「价值标准」(P1/C1)。区别于 DOC_SCORE_TARGETS(评分器数值杠杆)，这是 agent 面的**价值**
 * 索取：一条 recipe 是否让复用者能安全套用/判断越界。刻意不含具体分数——避免继续明文教「凑长度」。由
 * guidanceGenerator 渲染进 `## 深度契约` 段(无自带 `##` 顶级标题，供上层包裹)。
 */
export const VALUE_RUBRIC = `一条有价值的 recipe 让复用者(人或 AI)能判断：能否在自己场景安全套用、越界会发生什么、放弃了什么换来什么。
- 价值来自「就真实代码推理」，不来自字数或标题——评分器只认接地深度(挂真实 file:line)，长度冲不出高分。
- 每个深度断言必须挂 (来源: File:行号) 且能在项目里真解析到；读不到真实证据的那一维宁可不写(编造/占位既拿不到分也过不了自评)。
- 多来源佐证需跨 ≥2 处不同文件(synthesis)，而非同一处重复计数。`;

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
  /**
   * P1/C1: 深度覆盖目标——按【接地覆盖的深度维度数】计，而非字符数。这是本次升级把评分口径从「长度」
   * 转向「接地深度」的目标描述；C8(P5)将其接成真实 scorer 子分(depthCoverage 只在维度论述挂真实
   * file:line 时计分)。放在这里让 guidance 明说「覆盖 ≥N 维给满，凑长度不得分」。
   */
  depthCoverage: { dimensionsForFull: number; note: string };
}

const DOC_SCORE_TARGETS: DocScoreTargets = {
  markdownLength: { minLen: 50, optimalLen: 800, weight: 0.3 },
  structure: { heading: 0.08, codeBlock: 0.08, list: 0.04 },
  rationale: { minLen: 10, optimalLen: 100, weight: 0.15 },
  whyStandard: { minLen: 10, optimalLen: 100, weight: 0.15 },
  sources: { perSource: 0.03, cap: 0.1 },
  usageGuide: { minLen: 20, optimalLen: 200, weight: 0.1 },
  depthCoverage: {
    dimensionsForFull: 3,
    note: '深度按【接地覆盖的深度维度数】计分（覆盖 ≥3 个深度维度即满），不按字符数；凑长度/加标题不得分。',
  },
};

/** The recipe content contract: the style guide + the explicit scorer targets + the value rubric. */
export function contentContract(): {
  styleGuide: string;
  docScoreTargets: DocScoreTargets;
  valueRubric: string;
} {
  return {
    styleGuide: PROJECT_SNAPSHOT_STYLE_GUIDE,
    docScoreTargets: DOC_SCORE_TARGETS,
    valueRubric: VALUE_RUBRIC,
  };
}
