/**
 * 软规则一次申辩制(C-6,2026-07-02 统一重构)——门禁违规的软硬分级与 waiver 判定。
 *
 * 从 AlembicAgent knowledge handler 下沉为 Core 单源:两宿主(主体 in-process submit
 * 与宿主 alembic_submit_knowledge evidence gate)共用同一分级表与判定语义。
 *
 * 分级原则:
 * - 硬规则=事实与接地(伪造/失配锚点、graph 背书、证据密度、必填结构)——放行即污染
 *   知识库,不可申辩;
 * - 软规则=写作风格判断(祈使动词白名单/英文要求/对比示例/标题泛化/长度/coreCode
 *   完整性)——LLM 可能有正当理由(如项目惯用语),反复猜措辞是最长的提交回合尾巴。
 * 申辩流程:软规则全拒时,提交方带 ≥20 字 waiverJustification 原样重交即放行;理由随
 * reasoning.styleWaiver 落库,由 Dashboard 人工审核终裁。每会话上限由调用方计数。
 */

const SOFT_VIOLATION_CODES = new Set([
  'CONTENT_CONTRAST_MISSING',
  'STAGE3_MARKDOWN_TOO_SHORT',
  'STAGE3_MARKDOWN_NEEDS_CODE_OR_FILEREF',
  'STAGE3_CORECODE_INCOMPLETE',
  'STAGE3_TITLE_TOO_GENERIC',
]);
const SOFT_VIOLATION_SUFFIXES = ['_NON_ENGLISH', '_NON_IMPERATIVE'];

/** 每会话软规则 waiver 放行上限(防「万能理由」刷通过;超限后照常拒绝)。 */
export const STYLE_WAIVER_SESSION_LIMIT = 5;
/** 申辩理由最短长度(过短理由视同无理由)。 */
export const STYLE_WAIVER_MIN_JUSTIFICATION = 20;

export function isSoftAuthoringViolation(code: string): boolean {
  return (
    SOFT_VIOLATION_CODES.has(code) ||
    SOFT_VIOLATION_SUFFIXES.some((suffix) => code.endsWith(suffix))
  );
}

/**
 * 软规则一次申辩判定(纯函数)。
 * 放行条件全部满足:违规全为软规则、理由 ≥20 字、会话 waiver 未超限。
 * 放行时把 {codes, justification} 写进 reasoning.styleWaiver 随候选落库,人工审核终裁。
 */
export function applyStyleWaiver(input: {
  violations: Array<{ code: string }>;
  justification: string | undefined;
  sessionWaiverTotal: number;
  item: Record<string, unknown>;
}): { waived: boolean; item: Record<string, unknown>; waivedCodes: string[] } {
  const justification = (input.justification ?? '').trim();
  const soft = input.violations.filter((v) => isSoftAuthoringViolation(v.code));
  const hard = input.violations.filter((v) => !isSoftAuthoringViolation(v.code));
  if (
    input.violations.length === 0 ||
    hard.length > 0 ||
    soft.length === 0 ||
    justification.length < STYLE_WAIVER_MIN_JUSTIFICATION ||
    input.sessionWaiverTotal >= STYLE_WAIVER_SESSION_LIMIT
  ) {
    return { waived: false, item: input.item, waivedCodes: [] };
  }
  const waivedCodes = soft.map((v) => v.code);
  const reasoningBase = (input.item.reasoning ?? {}) as Record<string, unknown>;
  return {
    waived: true,
    waivedCodes,
    item: {
      ...input.item,
      reasoning: {
        ...reasoningBase,
        styleWaiver: { codes: waivedCodes, justification },
      },
    },
  };
}
