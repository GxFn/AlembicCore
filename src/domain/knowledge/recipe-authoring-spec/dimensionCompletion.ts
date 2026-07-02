/**
 * DimensionCompletionFloor — 维度完成判定的阈值单源(C-3,2026-07-02 统一重构)。
 *
 * 背景(B4):「一个维度何时算完成」的数字此前在两处各写——
 *   - 宿主 alembic_dimension_complete 的 evidence gate
 *     (AlembicPlugin recipe-evidence-gate.validateDimensionCompletionEvidenceGate:
 *      ≥3 session-bound Recipes、≥3 条 ≥20 字 keyFindings、analysisText ≥500)
 *   - 主体 in-process pipeline 的 QualityGate/record_repair/summary_rewrite
 *     (AlembicAgent presets QualityGatePolicy 500/3/3、minFindings 3)
 * 判定**对象**不同(session 绑定证据 vs pipeline 分析产物)是合理宿主分叉,不强行
 * 合并;但**阈值**漂移(一边改 3→5 另一边不知道)会造成两宿主完成标准静默分裂。
 * 本模块把数字收为单源,两边 import;改任一数字即是显式产品决策,两宿主同步。
 */
export const DIMENSION_COMPLETION_FLOOR = {
  /** 每维度最少候选/Recipe 数(宿主按 session-bound 计,in-process 按 record_repair/summary_rewrite 的 findings 底线同数) */
  minCandidates: 3,
  /** 最少实质 keyFindings 条数 */
  minKeyFindings: 3,
  /** 单条 keyFinding 最短字符数(短于此视为空话) */
  minFindingChars: 20,
  /** 分析文本最短字符数(候选生成档;纯分析档的宽松值由消费方自定并注释) */
  minAnalysisChars: 500,
  /** 分析最少引用文件数 */
  minFileRefs: 3,
} as const;
