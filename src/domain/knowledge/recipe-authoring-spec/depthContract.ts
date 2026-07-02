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

/**
 * 一个深度维度。2026-07-02 语义修订(用户决策)：DEPTH_DIMENSIONS 是**裁判与评分的分类轴**
 * (depthReview 按它归类接地深度、retry 按它报缺口)，以及作者**可选**的组织方式——不再是
 * 必须逐问作答的写作模板。固定四问模板会把深度退化成「填表式格式化措辞」；真深度来自作者
 * 自己的深挖思考(见 buildDepthScaffold 的自问引导)，以自由叙述融入正文同样被裁判认可
 * (depthReview 的叙述信号双轨)。
 */
export interface DepthDimension {
  /** 稳定键，depthReview/scorer/retry 按此对齐(勿随文案改)。 */
  key: 'designIntent' | 'boundaries' | 'failureModes' | 'tradeoffs' | 'multiSourceCorroboration';
  /** 人类可读维度名(中文)，用于 markdown `## <label>` 分节匹配(作者选用小节组织时)。 */
  label: string;
  /** 该维度对应的深度问题(裁判分类语义；作者可参考，不强制逐问作答)。 */
  question: string;
  /** 该维度的断言必须携带的真实接地证据要求。 */
  grounding: string;
}

/**
 * 五个深度维度。前四个是深度的分类学(裁判/评分/retry 的对齐轴)，第五个是「多来源佐证」
 * (把 evidence-floor 的 count 门升级为跨文件 synthesis)。key 稳定；label 仅在作者选用
 * `## <label>` 小节组织时参与匹配，自由叙述不需要。
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
 * buildDepthScaffold — 「深挖自问」引导(2026-07-02 重设计，用户决策)。
 *
 * 旧版要求「就每个深度维度逐一作答」——固定四问模板把深度退化成填表：模型为每问凑一段
 * 格式化措辞，恰是深度的反面。新版把深度交还给真思考：给出一组洞察角度，作者**自选**
 * 自己真的挖到证据的 2-3 个深挖到底，以自然叙述融入正文(用不用 `## 小节` 组织自便)；
 * 防刷底线不变——每个深度断言必须与真实 (来源: file:行) 同句/同段，读不到证据的角度
 * 宁可不写。裁判端(depthReview)同步双轨：小节组织与自由叙述同等认可。
 */
export function buildDepthScaffold(): string {
  return [
    '写正文之前，先对这个知识点做一轮真正的深挖(不是填表)。从下面的角度里，挑出你',
    '**真的读到代码证据**的 2-3 个，想透，然后把洞察以自然叙述融入正文——用不用小节标题随你：',
    '- 这个设计最反直觉/最容易被误解的地方是什么？为什么项目仍然这么选(它替代了什么、代价是什么)？',
    '- 一个不知道这条约定的人最可能怎么写错？错了之后最先坏掉的是什么(哪个校验/异常/降级会暴露它)？',
    '- 项目里有没有它**不适用**的例外或反例？例外的存在说明了什么边界条件？',
    '- 同一模式在项目其他地方如何重现或变形？它是普遍约定还是局部选择(跨文件对照)？',
    '- 有没有量化事实支撑(占比/分布/热点统计)让「为什么」更硬？',
    '底线：每个深度断言与真实 (来源: file:行) 同句或同段；读不到证据的角度不写——泛泛而谈的段落',
    '不如不写，它稀释真洞察。',
  ].join('\n');
}

/**
 * buildDepthSelfReviewChecklist — 「落笔后自评」清单(随深挖引导同步重设计)。自评对象从
 * 「每维是否覆盖」改为「叙述是否承载了接地的真洞察」。self-review 只用于自我改进/驱动重挖，
 * 绝不作为放行依据(不倒退门禁)。
 */
export function buildDepthSelfReviewChecklist(): string {
  return [
    '落笔后自评(任一未过则回代码重挖，不要凭空补写)：',
    '- [ ] 正文里是否有 ≥3 处「带真实 (来源: file:行) 的深度断言」(因果/代价/例外/对照，而非描述性复述)？',
    '- [ ] 深度断言是否跨 ≥2 处不同文件(佐证它是项目级洞察，非单点观察)？',
    '- [ ] 每个 (来源: file:行) 是否都能在项目里真解析到(不是编造/占位)？',
    '- [ ] 有没有一段是没有证据的泛泛而谈？有就删掉——它稀释真洞察。',
  ].join('\n');
}
