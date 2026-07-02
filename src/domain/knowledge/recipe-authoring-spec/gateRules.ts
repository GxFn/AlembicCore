/**
 * gate-rules.ts — SECTION 2, the heart of RecipeAuthoringSpec.
 *
 * The behavioral gate constants and pure predicates, promoted to one inspectable table and
 * lifted **byte-identical** (CG-3, the most dangerous discipline) from the live gates:
 *   - stage 1: AlembicPlugin/lib/runtime/mcp/handlers/recipe-content-quality-gate.ts
 *   - stage 2: AlembicPlugin/lib/recipe-generation/host-agent-workflows/recipe-evidence-gate.ts (the LIVE one)
 *   - stage 3: AlembicCore/src/domain/knowledge/UnifiedValidator.ts
 *
 * §C.1 split: only pure-data predicates live here. The two runtime couplings — on-disk source-ref
 * reads (SOURCE_REF_INVALID / NOT_FOUND / LINE_OUT_OF_RANGE) and bootstrap-session scope
 * (SESSION_NOT_FOUND / WRONG_SCOPE) — stay behind the injected `sourceRefResolver` / `sessionScope`
 * typed ports (types layer). This module therefore imports zero node:fs / node:path /
 * host-agent-workflows; the layer contract holds while gate strictness is unchanged.
 *
 * P0 is purely additive: the live gates keep their inline originals until P1 re-points them
 * to import these back. Moving the function bodies (not retyping) is what guarantees byte-identity.
 */
import type {
  RecipeAuthoringProfile,
  RecipeAuthoringSubmitPath,
  RecipeAuthoringViolation,
  RecipeSessionScope,
  RecipeSourceRefResolver,
} from '../../../types/recipeAuthoringSpec.js';

/* ════════════════ Stage 1 — content-quality constants + predicates (verbatim) ════════════════ */

const NON_ENGLISH_SCRIPT_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const FIRST_WORD_RE = /^[\s"'`([{]*([A-Za-z]+(?:'[A-Za-z]+)?)/u;

const POSITIVE_IMPERATIVE_VERBS = new Set([
  'add',
  'align',
  'bind',
  'build',
  'call',
  'check',
  'cite',
  'collect',
  'compare',
  'configure',
  'copy',
  'create',
  'derive',
  'dispatch',
  'ensure',
  'expose',
  'fetch',
  'follow',
  'guard',
  'handle',
  'include',
  'inject',
  'keep',
  'load',
  'map',
  'normalize',
  'pass',
  'prefer',
  'preserve',
  'query',
  'read',
  'record',
  'reject',
  'require',
  'resolve',
  'return',
  'route',
  'run',
  'select',
  'store',
  'submit',
  'update',
  'use',
  'validate',
  'write',
]);

const NEGATIVE_IMPERATIVE_VERBS = new Set([
  'avoid',
  'block',
  'do',
  'exclude',
  'forbid',
  'keep',
  'omit',
  'prevent',
  'reject',
  'remove',
  'skip',
  'stop',
]);

function isImperativeVerbLeading(value: string, field: 'doClause' | 'dontClause'): boolean {
  const firstWord = value.match(FIRST_WORD_RE)?.[1]?.toLowerCase();
  if (!firstWord) {
    return false;
  }
  if (field === 'doClause') {
    return POSITIVE_IMPERATIVE_VERBS.has(firstWord);
  }
  if (firstWord === 'do') {
    return /^["'`([{]*do\s+not\b/iu.test(value.trim());
  }
  return NEGATIVE_IMPERATIVE_VERBS.has(firstWord);
}

function hasMarkerExample(markdown: string, marker: '✅' | '❌'): boolean {
  return markdown.split(/\r?\n/u).some((line) => {
    const index = line.indexOf(marker);
    return index >= 0 && line.slice(index + marker.length).trim().length >= 4;
  });
}

function readContentMarkdown(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const markdown = (value as { markdown?: unknown }).markdown;
  return typeof markdown === 'string' && markdown.trim().length > 0 ? markdown : null;
}

/* ════════════════ Stage 2 — evidence constants + pure predicates (verbatim) ════════════════ */

/** Source-ref shape: `path:line` or `path:start-end`. fs reads stay in the injected resolver. */
const SOURCE_REF_RE = /^(.+?):(\d+)(?:-(\d+))?$/;
const EVIDENCE_FLOOR = { ruleFiles: 3, factFiles: 1 } as const;
const SCOPE_ESCAPE_RE = /\b(single-file|file-local|local-only|narrow)\b/;
// 2026-07-02 收窄（用户决策）：关系词判定只保留「具体调用链断言」（caller/callee/call chain/
// invokes/called by）——这类论断没有图谱背书即凭印象，必须拦。原词表中的「依赖/影响路径/
// 关系/上游/下游/depends on/impact path/relationship」是架构描述语言：架构维度知识天然充满
// 这些词，其真实性已由 snippet-match + source-ref fs 接地覆盖；Recipe 之间的关联另有系统链路
// 负责（KnowledgeService._autoDiscoverRelations 落库自动建边 + ConsolidationAdvisor 融合），
// 不依赖候选文本措辞。十轮真机验证表明宽词表在两宿主实践中均退化为「措辞税」：host（cc）靠
// 改述规避、in-process DeepSeek 直接被拒——没有任何宿主真正走过 graphRefs 正向通道。
const RELATIONSHIP_EN_RE = /\b(call chain|caller|callee|called by|invokes)\b/i;
const RELATIONSHIP_CN_RE = /调用链|调用方|被调用/;
const PLACEHOLDER_PATTERNS = [
  /\bawait\s+operation\s*\(/i,
  /\boperation\s*\(/i,
  /\bdoThing\b/,
  /\bfoo\b/i,
  /\bbar\b/i,
  /\bTODO\b/,
];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0
    );
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return [value];
  }
  return [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function cleanSourceRef(value: string): string {
  return value
    .trim()
    .replace(/^[`(["']+/, '')
    .replace(/[`)!"',.;]+$/, '');
}

function collectSourceRefs(item: Record<string, unknown>): string[] {
  const refs = [
    ...stringArray(item.sourceRefs),
    ...stringArray(asRecord(item.reasoning)?.sources),
    ...stringArray(item.sourceRef),
  ];
  return uniqueStrings(refs.map(cleanSourceRef).filter(Boolean));
}

/**
 * 逐字 snippet-match 的探针集合（2026-07-02 修正）：只取 coreCode / content.pattern——它们的
 * 语义就是「来自项目的核心代码证据」，必须与 cited range 逐字对照。markdown 代码块**不再**参与
 * 逐字校验：PROJECT_SNAPSHOT_STYLE_GUIDE 定义特写正文的代码为「可直接复制使用的代码模板」
 * （提炼物，天然不逐字）；其接地由 (来源: File:行号) 标注的 fs 解析 + stage-3
 * NEEDS_CODE_OR_FILEREF 保证。原实现把 fenced 纳入逐字判据与特写契约冲突——真机上两宿主
 * 均被挤压成「粘贴项目原文」，特写的范式意义被门禁摧毁（用户验收否决）。
 */
function collectCodeEvidence(item: Record<string, unknown>): string[] {
  const content = asRecord(item.content);
  return uniqueStrings(
    [stringValue(item.coreCode), stringValue(content?.pattern)].filter((value): value is string =>
      Boolean(value?.trim())
    )
  );
}

/**
 * placeholder 反伪探针集合：markdown 代码块虽退出逐字校验，但仍必须不是占位代码
 * （operation()/doThing/foo/bar/TODO）——防伪底线与特写契约不冲突。
 */
function collectPlaceholderProbes(item: Record<string, unknown>): string[] {
  const content = asRecord(item.content);
  const markdown = stringValue(content?.markdown) || '';
  const fenced = markdown.match(/```(?:[a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)```/);
  return uniqueStrings(
    [...collectCodeEvidence(item), fenced?.[1] ?? ''].filter((value): value is string =>
      Boolean(value?.trim())
    )
  );
}

function looksLikePlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

function normalizedCode(value: string): string {
  return value.replace(/\s+/g, '').trim();
}

function snippetMatchesSourceRange(snippet: string, rangeText: string): boolean {
  const source = normalizedCode(rangeText);
  const candidate = normalizedCode(snippet);
  if (candidate.length > 0 && source.includes(candidate)) {
    return true;
  }
  const sourceLines = rangeText.split(/\r?\n/).map(normalizedCode).filter(Boolean);
  const significantSnippetLines = snippet
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:\/\/|#)\s*/, '').trim())
    .filter((line) => !/^(?:[{}()[\],;]|\.\.\.)*$/.test(line))
    .map(normalizedCode)
    .filter((line) => line.length >= 6);
  if (significantSnippetLines.length === 0) {
    return false;
  }

  let sourceCursor = 0;
  for (const snippetLine of significantSnippetLines) {
    const nextIndex = sourceLines.findIndex(
      (line, index) =>
        index >= sourceCursor && (line.includes(snippetLine) || snippetLine.includes(line))
    );
    if (nextIndex < 0) {
      return false;
    }
    sourceCursor = nextIndex + 1;
  }
  return true;
}

function hasRelationshipClaim(item: Record<string, unknown>): boolean {
  if (
    item.graphRefs ||
    item.sourceGraphRefs ||
    item.relations ||
    item.relationships ||
    item.relationshipClaim === true ||
    item.requiresGraphEvidence === true ||
    item.relationshipEvidenceRequired === true
  ) {
    return true;
  }
  const text = [
    stringValue(item.description),
    stringValue(asRecord(item.content)?.markdown),
    stringValue(asRecord(item.reasoning)?.whyStandard),
  ]
    .filter(Boolean)
    .join('\n');
  return RELATIONSHIP_EN_RE.test(text) || RELATIONSHIP_CN_RE.test(text);
}

function requiresMultiFileEvidence(item: Record<string, unknown>): boolean {
  const kind = stringValue(item.kind)?.toLowerCase();
  if (kind !== 'rule' && kind !== 'pattern') {
    return false;
  }
  const scope = stringValue(item.scope)?.toLowerCase() || '';
  return !SCOPE_ESCAPE_RE.test(scope);
}

function isFactCandidate(item: Record<string, unknown>): boolean {
  return stringValue(item.kind)?.toLowerCase() === 'fact';
}

/* ════════════════ Stage 3 — UnifiedValidator content constants (verbatim) ════════════════ */

const MARKDOWN_FLOOR = 200;
const CODE_BLOCK_RE = /```[\s\S]*?```/;
const FILE_REF_RE = /\.\w{1,10}(:\d+)?/;
const GENERIC_TITLE_RE = /^(Singleton|Factory|Observer|MVC|MVVM) (pattern|模式)$/i;
const INCOMPLETE_CORECODE_FIRST_CHARS = new Set(['}', ')', ']']);
// 唯一性下限 — 来自 UnifiedValidator#checkUniqueness / recordSubmission 的内联字面量（字节级保持）。
const PATTERN_FLOOR = 30;
const CODE_FINGERPRINT_FLOOR = 20;

/** UnifiedValidator#codeFingerprint — strip comments+whitespace, first 200 chars, lowercase. */
function codeFingerprint(code: string): string {
  return (code || '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/[\s]+/g, '')
    .toLowerCase()
    .slice(0, 200);
}

/* ════════════════════════════ The GateRule table ════════════════════════════ */

export interface GateRule<P = unknown> {
  id: string;
  stage: 1 | 2 | 3;
  rejectCodes: string[];
  /** the verbatim constants for this rule. */
  params: P;
  /** human-facing guidance rendered by guidance-generator (never hand-copied elsewhere). */
  guidanceText: string;
  failureModeKey: string;
}

const GATE_RULES: GateRule[] = [
  {
    id: 'clause-imperative',
    stage: 1,
    rejectCodes: ['DO_CLAUSE_NON_IMPERATIVE', 'DONT_CLAUSE_NON_IMPERATIVE'],
    params: {
      positiveVerbs: [...POSITIVE_IMPERATIVE_VERBS],
      negativeVerbs: [...NEGATIVE_IMPERATIVE_VERBS],
      firstWordRe: FIRST_WORD_RE.source,
    },
    guidanceText:
      'doClause must start with an English imperative verb from the positive allowlist; dontClause with a negative verb or "Do not …".',
    failureModeKey: 'DO_CLAUSE_NON_IMPERATIVE',
  },
  {
    id: 'clause-required',
    stage: 1,
    rejectCodes: ['DO_CLAUSE_REQUIRED', 'DONT_CLAUSE_REQUIRED'],
    params: {},
    guidanceText:
      'Both doClause and dontClause are required, non-empty English imperative clauses.',
    failureModeKey: 'DO_CLAUSE_REQUIRED',
  },
  {
    id: 'clause-english',
    stage: 1,
    rejectCodes: ['DO_CLAUSE_NON_ENGLISH', 'DONT_CLAUSE_NON_ENGLISH'],
    params: { nonEnglishScriptRe: NON_ENGLISH_SCRIPT_RE.source },
    guidanceText: 'doClause / dontClause must be English (no Han/Hiragana/Katakana/Hangul script).',
    failureModeKey: 'DO_CLAUSE_NON_ENGLISH',
  },
  {
    id: 'content-contrast',
    stage: 1,
    rejectCodes: ['CONTENT_MARKDOWN_REQUIRED', 'CONTENT_CONTRAST_MISSING'],
    params: { markerThreshold: 4 },
    guidanceText:
      'content.markdown is required and must include both a ✅ correct and a ❌ forbidden project-specific example (each with ≥4 trailing non-space chars on its line).',
    failureModeKey: 'CONTENT_CONTRAST_MISSING',
  },
  {
    id: 'source-refs',
    stage: 2,
    rejectCodes: [
      'SOURCE_REFS_MISSING',
      'SOURCE_REF_LINE_MISSING',
      'SOURCE_REF_INVALID',
      'SOURCE_REF_NOT_FOUND',
      'SOURCE_REF_LINE_OUT_OF_RANGE',
    ],
    params: { sourceRefRe: SOURCE_REF_RE.source },
    guidanceText:
      'Cite concrete repo-relative source refs with a line or line range (lib/module/file.ts:10-18) that resolve to existing files inside the project root.',
    failureModeKey: 'SOURCE_REF_LINE_MISSING',
  },
  {
    id: 'evidence-floor',
    stage: 2,
    rejectCodes: ['INSUFFICIENT_EVIDENCE'],
    params: {
      ruleFiles: EVIDENCE_FLOOR.ruleFiles,
      factFiles: EVIDENCE_FLOOR.factFiles,
      scopeEscapeRe: SCOPE_ESCAPE_RE.source,
    },
    guidanceText:
      'Rule/pattern candidates need ≥3 distinct source files (unless scope: narrow/file-local/local-only); fact candidates need ≥1.',
    failureModeKey: 'INSUFFICIENT_EVIDENCE',
  },
  {
    id: 'snippet-match',
    stage: 2,
    rejectCodes: ['SNIPPET_MISMATCH', 'PLACEHOLDER_EVIDENCE'],
    params: {
      placeholderPatterns: PLACEHOLDER_PATTERNS.map((re) => re.source),
      minSignificantLine: 6,
    },
    guidanceText:
      'coreCode / content.pattern must match a cited source line range verbatim (they are project evidence). The markdown code block is a distilled, reusable template — it is NOT checked verbatim, but must not be placeholder code (operation(), doThing, foo, bar, TODO) and its claims stay grounded via (来源: File:行号) refs.',
    failureModeKey: 'SNIPPET_MISMATCH',
  },
  {
    id: 'graph-evidence',
    stage: 2,
    rejectCodes: ['GRAPH_REF_INVALID', 'STALE_GRAPH'],
    params: {
      relationshipEn: RELATIONSHIP_EN_RE.source,
      relationshipCn: RELATIONSHIP_CN_RE.source,
    },
    guidanceText:
      'Concrete call-chain claims (caller/callee/call chain/invokes) require fresh graph-backed refs; stale/partial/pending graph evidence is rejected. General dependency/layering/boundary wording does not trigger this gate — its grounding is covered by snippet and source-ref checks.',
    failureModeKey: 'GRAPH_REF_INVALID',
  },
  {
    id: 'session-scope',
    stage: 2,
    rejectCodes: ['SESSION_NOT_FOUND', 'WRONG_SCOPE'],
    params: {},
    guidanceText:
      'Cold-start submissions must run inside a bootstrap session whose projectRoot and dimension match the submission.',
    failureModeKey: 'SESSION_NOT_FOUND',
  },
  {
    id: 'field-content',
    stage: 3,
    rejectCodes: [
      'STAGE3_MARKDOWN_TOO_SHORT',
      'STAGE3_MARKDOWN_NEEDS_CODE_OR_FILEREF',
      'STAGE3_CORECODE_INCOMPLETE',
      'STAGE3_TITLE_TOO_GENERIC',
    ],
    params: {
      markdownFloor: MARKDOWN_FLOOR,
      codeBlockRe: CODE_BLOCK_RE.source,
      fileRefRe: FILE_REF_RE.source,
      genericTitleRe: GENERIC_TITLE_RE.source,
      incompleteCoreCodeFirstChars: [...INCOMPLETE_CORECODE_FIRST_CHARS],
    },
    guidanceText:
      'content.markdown must be ≥200 chars with a code block or file ref; coreCode must not start with a closing bracket; titles must not be generic pattern names.',
    failureModeKey: 'STAGE3_MARKDOWN_TOO_SHORT',
  },
  {
    id: 'uniqueness',
    stage: 3,
    rejectCodes: ['STAGE3_TITLE_DUPLICATE', 'STAGE3_TRIGGER_DUPLICATE', 'STAGE3_CODE_DUPLICATE'],
    params: { codeFingerprintFloor: CODE_FINGERPRINT_FLOOR, patternFloor: PATTERN_FLOOR },
    guidanceText:
      'Title, trigger, and code-fingerprint must be unique against already-submitted recipes (skippable).',
    failureModeKey: 'STAGE3_CODE_DUPLICATE',
  },
];

/** All gate rules, optionally filtered by stage. */
export function gateRules(stage?: 1 | 2 | 3): GateRule[] {
  return stage ? GATE_RULES.filter((rule) => rule.stage === stage) : [...GATE_RULES];
}

/** A single rule by id. */
export function gateRule(id: string): GateRule {
  const rule = GATE_RULES.find((candidate) => candidate.id === id);
  if (!rule) {
    throw new Error(`Unknown gate rule id: ${id}`);
  }
  return rule;
}

/** The imperative verb allowlist — derived from the lifted Sets (never a hardcoded number). */
export function getImperativeVerbAllowlist(): { positive: string[]; negative: string[] } {
  return {
    positive: [...POSITIVE_IMPERATIVE_VERBS],
    negative: [...NEGATIVE_IMPERATIVE_VERBS],
  };
}

/** The evidence-floor policy (distinct-file floors + the scope-escape the gate honors). */
export function getEvidenceFloorPolicy(): {
  ruleFiles: number;
  factFiles: number;
  scopeEscape: RegExp;
} {
  return {
    ruleFiles: EVIDENCE_FLOOR.ruleFiles,
    factFiles: EVIDENCE_FLOOR.factFiles,
    scopeEscape: new RegExp(SCOPE_ESCAPE_RE.source, SCOPE_ESCAPE_RE.flags),
  };
}

/**
 * Stage-3 field-gate policy — the UnifiedValidator content/uniqueness constants, exposed so the
 * Core stage-3 gate reads these EXACT values from the spec instead of inline literals (P0.3 lift
 * completed for P1.3 re-point). Regexes are fresh instances rebuilt from the same source+flags;
 * all are stateless (no `g` flag), so callers get byte-identical behavior to the lifted originals.
 */
export interface Stage3FieldPolicy {
  /** content.markdown 最小长度，过短即拒绝。 */
  markdownFloor: number;
  /** markdown“代码块”探测正则。 */
  codeBlockRe: RegExp;
  /** markdown“文件引用”探测正则。 */
  fileRefRe: RegExp;
  /** 通用标题正则，命中即过于通用。 */
  genericTitleRe: RegExp;
  /** coreCode 不完整的起始字符集合（以闭合括号开头）。 */
  incompleteCoreCodeFirstChars: ReadonlySet<string>;
  /** 唯一性：代码指纹最小长度。 */
  codeFingerprintFloor: number;
  /** 唯一性：pattern 最小长度。 */
  patternFloor: number;
}

export function getStage3FieldPolicy(): Stage3FieldPolicy {
  return {
    markdownFloor: MARKDOWN_FLOOR,
    codeBlockRe: new RegExp(CODE_BLOCK_RE.source, CODE_BLOCK_RE.flags),
    fileRefRe: new RegExp(FILE_REF_RE.source, FILE_REF_RE.flags),
    genericTitleRe: new RegExp(GENERIC_TITLE_RE.source, GENERIC_TITLE_RE.flags),
    incompleteCoreCodeFirstChars: new Set(INCOMPLETE_CORECODE_FIRST_CHARS),
    codeFingerprintFloor: CODE_FINGERPRINT_FLOOR,
    patternFloor: PATTERN_FLOOR,
  };
}

/* ════════════════════════════ validateAgainst orchestrator ════════════════════════════ */

export interface ValidateAgainstOptions {
  stage?: 1 | 2 | 3 | 'all';
  path: RecipeAuthoringSubmitPath;
  /** host-injected fs port (stage 2 source-ref reads). */
  sourceRefResolver?: RecipeSourceRefResolver;
  /** host-injected session port (stage 2 cold-start scope). */
  sessionScope?: RecipeSessionScope;
  /** stage-2 cold-start project root for source-ref resolution. */
  projectRoot?: string;
  dimensionId?: string;
  /**
   * §12.3 context profile. Defaults to 'cold-start' (the full gate, byte-identical to today), so
   * existing callers that omit it are unaffected. 'opportunistic' skips ONLY the 3-distinct-files
   * evidence floor and the session-scope; all content gates + cheap grounding still run.
   */
  profile?: RecipeAuthoringProfile;
}

/**
 * Resolve the authoring profile from the host submit context. Mirrors the live
 * shouldRunRecipeEvidenceGate decision (recipe-evidence-gate.ts): a resolved bootstrap session, a
 * string sessionId/bootstrapSessionRef, requireProductionSession===true, a string args.dimensionId,
 * or any item carrying a string dimensionId means a production/cold-start submission; otherwise the
 * submission is opportunistic in-process authoring. The host resolves the session, then passes the
 * resulting profile to validateAgainst / renderGuidance.
 */
export function resolveAuthoringProfile(input: {
  session?: unknown;
  args?: {
    sessionId?: unknown;
    bootstrapSessionRef?: unknown;
    requireProductionSession?: unknown;
    dimensionId?: unknown;
  };
  items?: ReadonlyArray<{ dimensionId?: unknown }>;
}): RecipeAuthoringProfile {
  const args = input.args ?? {};
  if (input.session) {
    return 'cold-start';
  }
  if (typeof args.sessionId === 'string' || typeof args.bootstrapSessionRef === 'string') {
    return 'cold-start';
  }
  if (args.requireProductionSession === true) {
    return 'cold-start';
  }
  if (typeof args.dimensionId === 'string') {
    return 'cold-start';
  }
  if ((input.items ?? []).some((item) => typeof item?.dimensionId === 'string')) {
    return 'cold-start';
  }
  return 'opportunistic';
}

/**
 * The single orchestrator the gates and the in-process path call. Returns the SAME violation
 * objects the live gates emit. Stage 1 + the pure parts of stage 2/3 run unconditionally; the
 * fs-bound + session-bound checks run only when their port is injected (so the domain stays pure).
 */
export function validateAgainst(
  items: ReadonlyArray<Record<string, unknown>>,
  opts: ValidateAgainstOptions
): RecipeAuthoringViolation[] {
  const stage = opts.stage ?? 'all';
  const runStage = (n: 1 | 2 | 3): boolean => stage === 'all' || stage === n;
  const violations: RecipeAuthoringViolation[] = [];

  items.forEach((item, itemIndex) => {
    if (runStage(1)) {
      violations.push(...validateStage1(item, itemIndex));
    }
    if (runStage(2)) {
      violations.push(...validateStage2(item, itemIndex, opts));
    }
    if (runStage(3)) {
      violations.push(...validateStage3(item, itemIndex));
    }
  });
  return violations;
}

/**
 * resolveGroundedSourcePaths — 只读接地投影(P0/C7 支撑)。
 *
 * 复用门禁同一套 collectSourceRefs → cleanSourceRef → SOURCE_REF_RE → sourceRefResolver 管线，抽出
 * 【成功解析成真实文件行】的证据集(validSourcePaths / validRanges)，但**绝不产出任何 violation**。
 *
 * 存在理由：`validateAgainst` 在 submit 期算出 validSourcePaths 后只回 violations 就丢弃它；而
 * `KnowledgeService.updateQuality` 对已持久化 entry 打分时(C7)、以及 `reviewRecipeDepth`(C4)需要知道
 * 「哪些 file:line 真接地」来判定深度覆盖。此 helper 让评分/深度裁判用与门禁**字节同源**的判定重算接地集，
 * 从而「深度只在接地时计分」成立。
 *
 * 刻意**镜像而非重构**门禁的解析循环：门禁的拒绝集是 rev-60 字节不变量，不能被本只读路径扰动；改动门禁
 * 解析循环时须同步本函数(二者共用 collectSourceRefs/cleanSourceRef/SOURCE_REF_RE 三原语，天然对齐)。
 * 无 resolver 或无 projectRoot 时返回空集(纯函数保持，fs 绑定仍在注入 port 后)。
 */
export function resolveGroundedSourcePaths(
  item: Record<string, unknown>,
  opts: {
    sourceRefResolver?: RecipeSourceRefResolver;
    projectRoot?: string;
    itemIndex?: number;
  }
): { validSourcePaths: string[]; validRanges: string[] } {
  const validSourcePaths: string[] = [];
  const validRanges: string[] = [];
  if (!opts.sourceRefResolver || !opts.projectRoot) {
    return { validSourcePaths, validRanges };
  }
  const itemIndex = opts.itemIndex ?? 0;
  const title = stringValue(item.title) || '(untitled)';
  for (const sourceRef of collectSourceRefs(item)) {
    const match = cleanSourceRef(sourceRef).match(SOURCE_REF_RE);
    if (!match) {
      continue;
    }
    // 逐 ref 隔离：fs-backed resolver 可能对单个不可读/竞态文件抛错，不能让一处坏 ref 令整条 recipe 的
    // 接地集归零(真机健壮性)。抛错的 ref 视为未接地跳过，其余照常解析。
    try {
      const resolved = opts.sourceRefResolver({
        projectRoot: opts.projectRoot,
        sourcePath: match[1] ?? '',
        startLine: Number(match[2]),
        endLine: match[3] ? Number(match[3]) : Number(match[2]),
        sourceRef,
        itemIndex,
        title,
      });
      if (!('violation' in resolved)) {
        validRanges.push(resolved.evidence.rangeText);
        validSourcePaths.push(resolved.evidence.sourcePath);
      }
    } catch {
      // 单 ref 解析异常 → 视为未接地，继续。
    }
  }
  return { validSourcePaths, validRanges };
}

function validateStage1(
  item: Record<string, unknown>,
  itemIndex: number
): RecipeAuthoringViolation[] {
  return [
    ...validateClause(item, itemIndex, 'doClause'),
    ...validateClause(item, itemIndex, 'dontClause'),
    ...validateContentContrast(item, itemIndex),
  ];
}

function validateClause(
  item: Record<string, unknown>,
  itemIndex: number,
  field: 'doClause' | 'dontClause'
): RecipeAuthoringViolation[] {
  const value = item[field];
  const label = field;
  const codePrefix = field === 'doClause' ? 'DO_CLAUSE' : 'DONT_CLAUSE';
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [
      {
        code: `${codePrefix}_REQUIRED`,
        field,
        itemIndex,
        message: `${label} is required.`,
        nextAction:
          field === 'doClause'
            ? 'Rewrite doClause as an English imperative clause that starts with a command verb, e.g. "Use ...".'
            : 'Rewrite dontClause as an English negative imperative clause, e.g. "Do not ..." or "Avoid ...".',
      },
    ];
  }
  if (NON_ENGLISH_SCRIPT_RE.test(value)) {
    return [
      {
        code: `${codePrefix}_NON_ENGLISH`,
        field,
        itemIndex,
        message: `${label} contains non-English script.`,
        nextAction:
          field === 'doClause'
            ? 'Translate doClause into an English imperative clause that starts with a command verb.'
            : 'Translate dontClause into an English negative imperative clause such as "Do not ..." or "Avoid ...".',
      },
    ];
  }
  if (!isImperativeVerbLeading(value, field)) {
    return [
      {
        code: `${codePrefix}_NON_IMPERATIVE`,
        field,
        itemIndex,
        message: `${label} is not verb-leading imperative guidance.`,
        nextAction:
          field === 'doClause'
            ? 'Start doClause with an imperative verb such as Use, Prefer, Validate, Keep, or Require.'
            : 'Start dontClause with Do not, Avoid, Prevent, Reject, or another negative imperative verb.',
      },
    ];
  }
  return [];
}

function validateContentContrast(
  item: Record<string, unknown>,
  itemIndex: number
): RecipeAuthoringViolation[] {
  const markdown = readContentMarkdown(item.content);
  if (!markdown) {
    return [
      {
        code: 'CONTENT_MARKDOWN_REQUIRED',
        field: 'content.markdown',
        itemIndex,
        message: 'content.markdown is required for project close-up guidance.',
        nextAction:
          'Provide content.markdown with project-specific guidance and a ✅ correct / ❌ forbidden contrast.',
      },
    ];
  }
  if (!hasMarkerExample(markdown, '✅') || !hasMarkerExample(markdown, '❌')) {
    return [
      {
        code: 'CONTENT_CONTRAST_MISSING',
        field: 'content.markdown',
        itemIndex,
        message: 'content.markdown must include both ✅ and ❌ project-specific examples.',
        nextAction:
          'Add a consistent contrast in content.markdown: one ✅ correct project-specific example and one ❌ forbidden counterexample.',
      },
    ];
  }
  return [];
}

function validateStage2(
  item: Record<string, unknown>,
  itemIndex: number,
  opts: ValidateAgainstOptions
): RecipeAuthoringViolation[] {
  const violations: RecipeAuthoringViolation[] = [];
  const title = stringValue(item.title) || '(untitled)';
  // §12.3 profile: cold-start (default) runs the full stage-2 gate; opportunistic skips ONLY the
  // 3-distinct-files evidence floor and the session-scope, keeping content + cheap grounding.
  const profile = opts.profile ?? 'cold-start';

  // Session scope (runtime port) — cold-start only; opportunistic declares no session. Only when injected.
  if (profile === 'cold-start' && opts.sessionScope) {
    const scope = opts.sessionScope({
      projectRoot: opts.projectRoot,
      dimensionId: opts.dimensionId ?? stringValue(item.dimensionId),
      itemIndex,
      title,
    });
    if ('violation' in scope) {
      violations.push(scope.violation);
    }
  }

  const sourceRefs = collectSourceRefs(item);
  if (sourceRefs.length === 0) {
    violations.push({
      code: 'SOURCE_REFS_MISSING',
      itemIndex,
      title,
      message: 'Recipe candidate has no concrete sourceRefs or reasoning.sources.',
      nextAction: 'Add repo-relative source refs with line ranges for the cited source evidence.',
    });
  }

  const validRanges: string[] = [];
  const validSourcePaths: string[] = [];
  for (const sourceRef of sourceRefs) {
    const cleaned = cleanSourceRef(sourceRef);
    const match = cleaned.match(SOURCE_REF_RE);
    if (!match) {
      violations.push({
        code: 'SOURCE_REF_LINE_MISSING',
        itemIndex,
        sourceRef,
        title,
        message: 'Source ref must include a line or line range.',
        nextAction: 'Use repo-relative refs such as lib/module/file.ts:10-18.',
      });
      continue;
    }
    // fs-bound resolution stays behind the injected port (keeps this module pure).
    if (!opts.sourceRefResolver || !opts.projectRoot) {
      continue;
    }
    const resolved = opts.sourceRefResolver({
      projectRoot: opts.projectRoot,
      sourcePath: match[1] ?? '',
      startLine: Number(match[2]),
      endLine: match[3] ? Number(match[3]) : Number(match[2]),
      sourceRef,
      itemIndex,
      title,
    });
    if ('violation' in resolved) {
      violations.push(resolved.violation);
    } else {
      validRanges.push(resolved.evidence.rangeText);
      validSourcePaths.push(resolved.evidence.sourcePath);
    }
  }

  // Placeholder（含 markdown 模板代码的防伪底线）与逐字 snippet-match（仅 coreCode/pattern
  // 证据位）分探针集合执行——markdown 特写模板不做逐字校验，见 collectCodeEvidence 注释。
  const snippetProbes = new Set(collectCodeEvidence(item));
  for (const snippet of collectPlaceholderProbes(item)) {
    if (looksLikePlaceholder(snippet)) {
      violations.push({
        code: 'PLACEHOLDER_EVIDENCE',
        itemIndex,
        title,
        message: 'Recipe candidate contains placeholder code instead of project source evidence.',
        nextAction: 'Replace placeholder snippets with code copied from the cited source range.',
      });
      continue;
    }
    if (
      snippetProbes.has(snippet) &&
      validRanges.length > 0 &&
      !validRanges.some((rangeText) => snippetMatchesSourceRange(snippet, rangeText))
    ) {
      violations.push({
        code: 'SNIPPET_MISMATCH',
        itemIndex,
        title,
        message: 'Recipe code evidence does not match any cited source line range.',
        nextAction: 'Cite the exact source line range that contains the submitted code snippet.',
      });
    }
  }

  // Evidence floor (3-distinct-files, pure) — cold-start only; opportunistic declares this off.
  // Only meaningful once refs are resolved.
  if (profile === 'cold-start' && opts.sourceRefResolver && opts.projectRoot) {
    const distinctFiles = new Set(validSourcePaths);
    if (requiresMultiFileEvidence(item) && distinctFiles.size < EVIDENCE_FLOOR.ruleFiles) {
      violations.push({
        code: 'INSUFFICIENT_EVIDENCE',
        itemIndex,
        title,
        message:
          'Rule/pattern candidates require at least three distinct source files unless explicitly scoped narrower.',
        nextAction:
          'Add at least three distinct repo-relative file references, or declare scope: "narrow" / "file-local" for a legitimately local rule.',
      });
    } else if (isFactCandidate(item) && distinctFiles.size < EVIDENCE_FLOOR.factFiles) {
      violations.push({
        code: 'INSUFFICIENT_EVIDENCE',
        itemIndex,
        title,
        message: 'Fact candidates require at least one precise source reference.',
        nextAction: 'Add a repo-relative source reference with a valid line range.',
      });
    }
  }

  // Graph evidence (pure).
  if (hasRelationshipClaim(item)) {
    const refs = [
      ...stringArray(item.graphRefs),
      ...stringArray(item.sourceGraphRefs),
      ...stringArray(asRecord(item.relations)?.graphRefs),
      ...stringArray(asRecord(item.relationships)?.graphRefs),
      ...stringArray(asRecord(item.reasoning)?.graphRefs),
    ];
    if (refs.length === 0) {
      violations.push({
        code: 'GRAPH_REF_INVALID',
        itemIndex,
        title,
        message: 'Relationship claims require graph-backed refs.',
        nextAction:
          'Attach sourceGraph refs from a fresh graph query or remove the relationship claim.',
      });
    } else if (refs.some((ref) => /\bstale\b|\bpartial\b|\bpending\b/i.test(ref))) {
      violations.push({
        code: 'STALE_GRAPH',
        itemIndex,
        title,
        message: 'Relationship evidence refers to stale or partial graph data.',
        nextAction: 'Refresh the source graph and cite fresh graph refs before submitting.',
      });
    }
  }

  return violations;
}

function validateStage3(
  item: Record<string, unknown>,
  itemIndex: number
): RecipeAuthoringViolation[] {
  const violations: RecipeAuthoringViolation[] = [];
  const markdown = (stringValue(asRecord(item.content)?.markdown) as string) || '';

  if (markdown.length > 0 && markdown.length < MARKDOWN_FLOOR) {
    violations.push({
      code: 'STAGE3_MARKDOWN_TOO_SHORT',
      itemIndex,
      message: `content.markdown 过短 (${markdown.length} 字符, 最少 ${MARKDOWN_FLOOR})。请包含代码片段和项目上下文描述。`,
      nextAction: 'Expand content.markdown to ≥200 chars with a code snippet and project context.',
    });
  }
  if (
    markdown.length >= MARKDOWN_FLOOR &&
    !CODE_BLOCK_RE.test(markdown) &&
    !FILE_REF_RE.test(markdown)
  ) {
    violations.push({
      code: 'STAGE3_MARKDOWN_NEEDS_CODE_OR_FILEREF',
      itemIndex,
      message: 'content.markdown 中必须包含至少一个代码块或文件引用',
      nextAction: 'Add a fenced code block or a file reference to content.markdown.',
    });
  }
  const coreCode = (stringValue(item.coreCode) || '').trim();
  if (coreCode && INCOMPLETE_CORECODE_FIRST_CHARS.has(coreCode[0] ?? '')) {
    violations.push({
      code: 'STAGE3_CORECODE_INCOMPLETE',
      itemIndex,
      message: `coreCode 以 "${coreCode[0]}" 开头 — 代码片段不完整，请包含完整的函数/方法/表达式`,
      nextAction: 'Provide a complete function/method/expression for coreCode.',
    });
  }
  const title = (stringValue(item.title) || '').trim();
  if (title && GENERIC_TITLE_RE.test(title)) {
    violations.push({
      code: 'STAGE3_TITLE_TOO_GENERIC',
      itemIndex,
      message: `标题过于通用: "${title}" — 请加上项目特定的上下文`,
      nextAction: 'Add project-specific context to the title.',
    });
  }
  return violations;
}

/** Stage-3 code fingerprint (exposed for the uniqueness consumer; byte-identical to UnifiedValidator). */
export { codeFingerprint };
