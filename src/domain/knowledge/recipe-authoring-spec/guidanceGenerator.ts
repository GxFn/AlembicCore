/**
 * guidance-generator.ts — SECTION 4.
 *
 * The guidance projection of the spec. Every builder here renders from the SAME `gateRules()`
 * table that `validateAgainst` enforces against, plus the field spec, the content contract, and the
 * worked example — one assembly, zero hand-copied constants. That shared read is the structural
 * guarantee that "what guidance tells authors" == "what the gate enforces" (CG-1).
 *
 * Pure data assembly only — no fs, no host imports.
 */
import type {
  RecipeAuthoringProfile,
  RecipeAuthoringSubmitPath,
} from '../../../types/recipeAuthoringSpec.js';
import { contentContract, type DocScoreTargets } from './contentContract.js';
import { buildDepthScaffold, buildDepthSelfReviewChecklist } from './depthContract.js';
import { example, type WorkedExample } from './examples/index.js';
import { getAllRequiredFieldNames, getRequiredFieldsDescription, V3_FIELD_SPEC } from './fields.js';
import {
  type GateRule,
  gateRules,
  getEvidenceFloorPolicy,
  getImperativeVerbAllowlist,
} from './gateRules.js';

/** One rendered guidance bundle for a submission path. */
export interface GuidanceBlock {
  path: RecipeAuthoringSubmitPath;
  /** §12.3 profile this guidance was rendered for. */
  profile: RecipeAuthoringProfile;
  stage?: 1 | 2 | 3;
  requiredFields: string[];
  rules: Array<{ id: string; stage: 1 | 2 | 3; rejectCodes: string[]; guidance: string }>;
  imperativeVerbs: { positive: string[]; negative: string[] };
  evidenceFloor: { ruleFiles: number; factFiles: number; scopeEscape: string };
  contentContract: { styleGuide: string; docScoreTargets: DocScoreTargets; valueRubric: string };
  example: WorkedExample;
  /**
   * P1/C2: 深度契约段(价值标准 + 写前推理脚手架 + 落笔后自评)，从 DEPTH_DIMENSIONS 单源渲染。作为
   * GuidanceBlock 一级结构化字段(与 example 同级)，使深度指引活过 host 压缩阶梯——host 截断 front-load
   * 时保 example/evidenceFloor/imperativeVerbs，深度契约随结构化字段一并保留，不因 text 截断而丢失。
   */
  depthContract: string;
  /** P1/C2: 价值标准(VALUE_RUBRIC)——「什么是有价值的 recipe」，与深度契约同源(contentContract().valueRubric)。 */
  valueRubric: string;
  /** the assembled human-facing guidance text. */
  text: string;
}

/** Map the lifted rule table into renderable guidance rows (no constant is re-typed). */
function ruleRows(
  stage?: 1 | 2 | 3
): Array<{ id: string; stage: 1 | 2 | 3; rejectCodes: string[]; guidance: string }> {
  return gateRules(stage).map((rule: GateRule) => ({
    id: rule.id,
    stage: rule.stage,
    rejectCodes: rule.rejectCodes,
    guidance: rule.guidanceText,
  }));
}

/**
 * Gate rules the opportunistic profile does NOT enforce, so the guidance for it must not claim them:
 * the 3-distinct-files evidence floor and the bootstrap session-scope. cold-start renders every rule.
 */
const OPPORTUNISTIC_DROPPED_RULE_IDS = new Set(['evidence-floor', 'session-scope']);

/**
 * Assemble the guidance for one submission path + profile. Reads gateRules() (the same table the
 * gate reads), the verb allowlist, the evidence floor, the required-field set, the content contract,
 * and the worked example into a single block. cold-start (default) renders every rule + the evidence
 * floor — byte-identical to before; opportunistic drops exactly the rules the opportunistic gate
 * skips, so guidance == gate per profile.
 */
export function renderGuidance(
  path: RecipeAuthoringSubmitPath,
  stage?: 1 | 2 | 3,
  profile: RecipeAuthoringProfile = 'cold-start'
): GuidanceBlock {
  const verbs = getImperativeVerbAllowlist();
  const floor = getEvidenceFloorPolicy();
  const contract = contentContract();
  const rows = ruleRows(stage).filter(
    (row) => profile === 'cold-start' || !OPPORTUNISTIC_DROPPED_RULE_IDS.has(row.id)
  );
  const requiredFields = getAllRequiredFieldNames();
  const worked = example('typescript');

  // P1/C2: 深度契约段——最高杠杆单点。从 DEPTH_DIMENSIONS 单源渲染(与 C3 契约/C4 裁判/C9 retry 同源)，
  // 明说「这是价值要求不是门槛：不进门禁、不倒退 floor；但评分器只认接地深度、不认长度」。纯 additive，
  // 不改任何 gateRules 谓词。作为 GuidanceBlock.depthContract 一级字段返回，活过 host 压缩阶梯。
  const depthContractText = [
    '## 深度契约（超越门禁的价值要求）',
    '这是价值要求不是新门槛：不进门禁校验、不降低现有证据要求。但评分器只认接地深度、不认长度——凑字数或加标题冲不出高分。',
    contract.valueRubric,
    '',
    '### 写正文前先推理（先逐维作答，再落笔）',
    buildDepthScaffold(),
    '',
    '### 落笔后自评（任一未过则回代码重挖）',
    buildDepthSelfReviewChecklist(),
  ].join('\n');

  const text = [
    contract.styleGuide,
    '',
    '## 提交校验规则（与门禁完全一致）',
    ...rows.map((row) => `- [stage ${row.stage}] ${row.id}: ${row.guidance}`),
    '',
    depthContractText,
    '',
    `## doClause 允许的祈使动词（共 ${verbs.positive.length} 个）`,
    verbs.positive.join(', '),
    `## dontClause 否定动词（共 ${verbs.negative.length} 个）`,
    verbs.negative.join(', '),
    // 证据下限只属于 cold-start；opportunistic 声明不强制 3-file floor，指引同步省略，保持 guidance==gate。
    ...(profile === 'cold-start'
      ? [
          '',
          `## 证据下限`,
          `- rule/pattern 候选需要 ≥${floor.ruleFiles} 个不同来源文件（除非 scope 标记为 ${floor.scopeEscape.source}）`,
          `- fact 候选需要 ≥${floor.factFiles} 个来源文件`,
        ]
      : []),
  ].join('\n');

  return {
    path,
    profile,
    stage,
    requiredFields,
    rules: rows,
    imperativeVerbs: verbs,
    evidenceFloor: {
      ruleFiles: floor.ruleFiles,
      factFiles: floor.factFiles,
      scopeEscape: floor.scopeEscape.source,
    },
    contentContract: contract,
    example: worked,
    depthContract: depthContractText,
    valueRubric: contract.valueRubric,
    text,
  };
}

/** The collapsed submission spec — one builder replacing the two parallel ones (0-vs-3 resolved → 3). */
export interface SubmissionSpec {
  dimensionId: string;
  /** the resolved candidate floor (the 0-vs-3 contradiction resolves to the floor). */
  minCandidates: number;
  styleGuide: string;
  requiredFields: string[];
  checklist: string[];
  guidance: GuidanceBlock;
}

/** Build the submission spec for a dimension from the shared spec table. */
export function buildSubmissionSpec(dim: string): SubmissionSpec {
  const guidance = renderGuidance('host-cold-start');
  return {
    dimensionId: dim,
    minCandidates: 3,
    styleGuide: guidance.contentContract.styleGuide,
    requiredFields: guidance.requiredFields,
    checklist: buildPreSubmitChecklist(),
    guidance,
  };
}

/** The submit-knowledge contract for OnboardingContract — verbs + floor + fields from the spec. */
export interface SubmitContract {
  requiredFields: string[];
  imperativeVerbs: { positive: string[]; negative: string[] };
  evidenceFloor: { ruleFiles: number; factFiles: number; scopeEscape: string };
  styleGuide: string;
  checklist: string[];
}

/** Build the submit-knowledge contract from the shared table (lists the actual allowlisted verbs). */
export function buildSubmitKnowledgeContract(): SubmitContract {
  const verbs = getImperativeVerbAllowlist();
  const floor = getEvidenceFloorPolicy();
  return {
    requiredFields: getAllRequiredFieldNames(),
    imperativeVerbs: verbs,
    evidenceFloor: {
      ruleFiles: floor.ruleFiles,
      factFiles: floor.factFiles,
      scopeEscape: floor.scopeEscape.source,
    },
    styleGuide: contentContract().styleGuide,
    checklist: buildPreSubmitChecklist(),
  };
}

/** The single pre-submit checklist — collapses PRE_SUBMIT + SHARED_SUBMIT, derived from gateRules(). */
export function buildPreSubmitChecklist(): string[] {
  return gateRules().map((rule) => `[stage ${rule.stage}] ${rule.guidanceText}`);
}

/** Submit-tool field descriptions for mcp-tools .describe() strings — generated from V3_FIELD_SPEC. */
export function describeSubmitToolFields(): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const field of V3_FIELD_SPEC) {
    if (typeof field.name === 'string' && typeof field.rule === 'string') {
      fields[field.name] = field.rule;
    }
  }
  // include the aggregate required-fields description so both schema forks render identical text.
  // getRequiredFieldsDescription() 返回 string[]，join 成单串以契合 Record<string,string> 描述表。
  fields._requiredFieldsDescription = getRequiredFieldsDescription().join('; ');
  return fields;
}
