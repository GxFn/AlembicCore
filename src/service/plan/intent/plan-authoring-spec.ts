/**
 * PlanAuthoringSpec — plan 决策指导的单一真源(S2,2026-07-02 统一重构)。
 *
 * 复刻 RecipeAuthoringSpec 的成功模式(单源数据 + render 多皮)：此前 plan 的
 * 「规模评估方法/阶段要求/输出硬约束」在三处各写一份——
 *   1. 主体 in-process persona(AlembicAgent plan.profile.ts)
 *   2. 主体 prompt builder 阶段指导(PlanAgentRun.ts)
 *   3. 宿主 draft 决策 checklist(AlembicPlugin plan-tool.ts)——且宿主版缺
 *      密度→预算映射规则,host agent 决策规模时无同款指导(B8 散乱实锤)。
 * 本模块把规则数据与文本收为单源；两宿主 render 各自的皮(主体=中文 persona
 * 单轮 JSON 协议;宿主=英文 checklist draft→confirm 协议),改一处规则两边同步。
 */

/** 规模评估规则(数值单源)：与 dimensionEvidenceDensity 的 strength 语义对齐。 */
export const PLAN_SCALE_RULES = {
  /** strength ≥ 此值为强证据维度 */
  strongStrengthMin: 60,
  /** 强证据维度的每维预算区间 */
  strongRange: { min: 6, max: 10 },
  /** strength ≥ 此值(且 < strong)为中等证据维度 */
  mediumStrengthMin: 20,
  /** 中等证据维度的每维预算区间 */
  mediumRange: { min: 4, max: 6 },
  /** 弱但非零证据维度的每维下限 */
  weakFloor: 3,
  /** totalRecipeBudget 必须 ≥ dimensions × 此值(与 planIntent dimensionLowerBound 同义) */
  perDimensionFloor: 3,
} as const;

/**
 * 规模评估方法(中文,主体 persona 用)。
 * 逐字承接自 plan.profile.ts P-1 版本——S2 迁移保持字节等价,规则数字由
 * PLAN_SCALE_RULES 插值(改数值即改文本)。
 */
export function renderPlanScaleMethodZh(): string[] {
  const r = PLAN_SCALE_RULES;
  return [
    '规模评估方法（必须基于输入的真实项目结构情报推导，不许拍保守小数）：',
    '- 你的输入包含 projectInfoTree（模块→文件→符号的真实结构金字塔，meta 里有 totals 与 omitted）和 dimensionEvidenceDensity（每个维度的证据密度：matchedFiles/matchedModules/matchedFrameworks/strength/sampleHits）。',
    `- 逐维评估：strength 高（≥${r.strongStrengthMin}）且 sampleHits 实质的维度是强证据维度，预算 ${r.strongRange.min}-${r.strongRange.max} 条；中等（${r.mediumStrengthMin}-${r.strongStrengthMin - 1}）${r.mediumRange.min}-${r.mediumRange.max} 条；弱但非零 ${r.weakFloor} 条；strength=0 且树中无相关结构才可排除。`,
    '- 用 projectInfoTree 交叉验证量级：moduleCount 个模块的项目，核心维度（架构/模块系统/代码规范）每个模块通常贡献 1-2 条可提炼约定；多仓/多模块结构预算应显著高于单模块。',
    '- 输出 scale.dimensionBudgets（每个入选维度的预算条数，按密度分配）；totalRecipeBudget = 各维度之和。',
  ];
}

/** 输出硬约束(中文,主体 persona 用)。逐字承接自 plan.profile.ts。 */
export function renderPlanHardConstraintsZh(): string[] {
  const r = PLAN_SCALE_RULES;
  return [
    '硬约束：',
    '- 只输出一个纯 JSON object，不输出 Markdown、解释文字或工具调用。',
    '- 不访问文件、数据库、仓库、账本或外部工具；事实只来自输入上下文。',
    '- dimensions 必须是至少一个非空字符串；合法窄选（例如 1 个维度）必须保留。',
    `- scale.totalRecipeBudget 必须大于 0 且不低于 dimensions 数量 × ${r.perDimensionFloor}；maxFiles/contentMaxLines 可按输入事实给出。`,
    '- deepMining 和 moduleMining 必须输出真实 moduleBindings；modulePath/moduleId/moduleName 只能来自 ProjectContext facts 中的模块候选，不能编造。',
    '- 每个 moduleBinding.dimensions 必须是本次 dimensions 的子集且非空，targetRecipes 必须大于 0。',
    '- coldStart 保持兼容：没有模块目标时 moduleBindings 可为空。',
  ];
}

/** 输出格式示例(中文,主体 persona 用)。示例数字与 ~500 文件多仓规模自洽,防锚定。 */
export function renderPlanOutputExampleZh(): string {
  return '输出格式（示例数字对应一个 ~500 文件的多仓项目，你必须按输入事实重新估算）：\n{ "generationStage": "coldStart|deepMining|moduleMining", "dimensions": ["architecture", "ts-js-module", "coding-standards", "error-resilience", "testing-quality", "data-events"], "scale": { "totalRecipeBudget": 40, "dimensionBudgets": { "architecture": 10, "ts-js-module": 8, "coding-standards": 7, "error-resilience": 5, "testing-quality": 5, "data-events": 5 }, "maxFiles": 500, "contentMaxLines": 120 }, "moduleBindings": [{ "modulePath": "Sources/App", "moduleId": "target:App:Sources/App", "moduleName": "App", "dimensions": ["architecture"], "targetRecipes": 5, "priority": 1 }] }';
}

/**
 * 主体 in-process plan persona 全文(单源 render)。
 * AlembicAgent plan.profile.ts 的 persona.description 改由本函数生成——
 * S2 迁移与迁移前文本字节等价(见 PlanAuthoringSpec 测试钉)。
 */
export function renderPlanPersonaDescription(): string {
  return [
    '你是 Alembic 主体内置的计划选择 Agent。你只根据调用方传入的 ProjectContext facts 选择本轮生成阶段要执行的维度、规模和模块绑定。',
    '',
    ...renderPlanScaleMethodZh(),
    '',
    ...renderPlanHardConstraintsZh(),
    '',
    renderPlanOutputExampleZh(),
  ].join('\n');
}

/**
 * 宿主 draft 决策 checklist 的规模条目(英文,host agent 用)。
 * 与主体 persona 同一规则数据 render——宿主此前的 checklist 只有「Set scale from
 * the projectInfoTree evidence」,缺密度→预算映射,host agent 决策规模无据可依。
 */
export function renderPlanScaleChecklistEn(): string[] {
  const r = PLAN_SCALE_RULES;
  return [
    `Size each selected dimension from dimensionEvidenceDensity: strength >= ${r.strongStrengthMin} with concrete sampleHits -> ${r.strongRange.min}-${r.strongRange.max} recipes; strength ${r.mediumStrengthMin}-${r.strongStrengthMin - 1} -> ${r.mediumRange.min}-${r.mediumRange.max}; weak but non-zero -> ${r.weakFloor}; exclude only when strength is 0 and projectInfoTree shows no related structure.`,
    `Set scale.dimensionBudgets per selected dimension and make scale.totalRecipeBudget their sum (must be >= dimensions x ${r.perDimensionFloor}); cross-check magnitude against moduleCount — multi-module workspaces owe 1-2 extractable conventions per module on core dimensions.`,
  ];
}
