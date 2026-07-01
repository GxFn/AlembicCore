/**
 * depthContract.ts — SECTION 7 (P0/C3): the DEPTH contract.
 *
 * 门禁(gateRules)保证 recipe「形状合格」；深度契约保证 recipe「真正有价值」——即让复用者(人或 AI)能
 * 判断「能否在自己的场景安全套用、越界会怎样」。这不是新的门槛(不进 validateAgainst、不倒退 floor)，
 * 而是索取真实深度的价值要求：每个深度断言都必须挂真实 file:line，把「深度」与「多读真实代码」焊死，
 * 使追求深度无法退化成凑字数/加标题(那正是 contentDepth 评分被 game 的失败模式)。
 *
 * 纯数据 + 字符串 builder：无 fs、无 host import。两宿主(host-agent + 主体 in-process)经 guidanceGenerator
 * 的 renderGuidance 从同一处渲染这份契约(单源)；depthReview(C4)按同一维度做确定性接地裁判；生成期
 * retry(C9)按同一维度报缺口。三者共用 DEPTH_DIMENSIONS 即天然对齐。
 */

/** 一个深度维度：作者必须回答的「深度问题」+ 它必须携带的真实接地证据。 */
export interface DepthDimension {
  /** 稳定键，depthReview/scorer/retry 按此对齐(勿随文案改)。 */
  key: 'designIntent' | 'boundaries' | 'failureModes' | 'tradeoffs' | 'multiSourceCorroboration';
  /** 人类可读维度名(中文)，也用于 markdown `## <label>` 分节匹配。 */
  label: string;
  /** 该维度要回答的深度问题(front-load 给 agent)。 */
  question: string;
  /** 该维度的断言必须携带的真实接地证据要求。 */
  grounding: string;
}

/**
 * 五个深度维度。前四个是「深度四问」，第五个是「多来源佐证」(把 evidence-floor 的 count 门升级为
 * 跨文件 synthesis)。key 稳定，label 用于 `## <label>` 分节匹配。
 */
export const DEPTH_DIMENSIONS: readonly DepthDimension[] = [
  {
    key: 'designIntent',
    label: '设计意图',
    question: '为什么是这个设计/结构/约定，而不是显而易见的替代方案？',
    grounding: '至少 1 处真实 file:line 佐证该选择(如实现处/配置处)，并说明被放弃的替代方案。',
  },
  {
    key: 'boundaries',
    label: '边界与前置条件',
    question: '何时适用、何时不适用？依赖哪些前置条件与不变量？',
    grounding: '边界/前置断言必须挂真实 file:line(如守卫、断言、类型约束、schema 校验处)。',
  },
  {
    key: 'failureModes',
    label: '失败模式',
    question: '违反或越界会发生什么？出什么错、谁受影响、如何被发现？',
    grounding: '失败模式必须指向真实代码的 file:line(抛错、降级、校验拒绝、回滚处)。',
  },
  {
    key: 'tradeoffs',
    label: '设计权衡',
    question: '放弃了什么、换来了什么？成本与代价在哪里？',
    grounding: '权衡断言挂真实 file:line 或真实约束证据(如性能/复杂度/耦合的代码见证)。',
  },
  {
    key: 'multiSourceCorroboration',
    label: '多来源佐证',
    question: '同一模式在项目里还出现在哪几处？它是普遍约定还是孤例？',
    grounding: '跨 ≥2 处不同文件的真实 file:line 佐证同一模式(synthesis，非同一处重复计数)。',
  },
];

/**
 * buildDepthScaffold — 「先推理、再落笔」的脚手架。front-load 给 agent，要求它在写 markdown 正文之前
 * 先就每个深度维度作答(并挂真实 file:line)。这一步本身就是深度思考——要答「越界会怎样」就必须回代码
 * 真读失败路径，而不是格式化。
 */
export function buildDepthScaffold(): string {
  const lines = [
    '写正文之前，先就以下深度维度逐一作答(每条挂真实 file:line，读不到真实证据就不要写这一维)：',
  ];
  for (const dim of DEPTH_DIMENSIONS) {
    lines.push(`- ${dim.label}：${dim.question} —— ${dim.grounding}`);
  }
  return lines.join('\n');
}

/**
 * buildDepthSelfReviewChecklist — 「落笔后自评」清单。draft 完成后 agent 逐条自检：该维度是否真捕获、
 * 是否挂在真实 file:line、多来源是否跨 ≥2 文件。self-review 只用于自我改进/驱动重挖，绝不作为放行依据
 * (不倒退门禁)。
 */
export function buildDepthSelfReviewChecklist(): string {
  const lines = ['落笔后自评(任一未过则回代码重挖，不要凭空补写)：'];
  for (const dim of DEPTH_DIMENSIONS) {
    lines.push(`- [ ] ${dim.label}：是否真捕获且挂了真实 file:line？`);
  }
  lines.push('- [ ] 多来源佐证是否跨 ≥2 处不同文件(而非同一处重复)？');
  lines.push('- [ ] 每个深度断言的 file:line 是否都能在项目里真解析到(不是编造/占位)？');
  return lines.join('\n');
}
