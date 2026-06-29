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
const RELATIONSHIP_EN_RE =
  /\b(call chain|caller|callee|called by|depends on|impact path|relationship|invokes)\b/i;
const RELATIONSHIP_CN_RE = /调用链|调用方|被调用|依赖|影响路径|关系|上游|下游/;
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

function collectCodeEvidence(item: Record<string, unknown>): string[] {
  const content = asRecord(item.content);
  const markdown = stringValue(content?.markdown) || '';
  const fenced = markdown.match(/```(?:[a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)```/);
  return uniqueStrings(
    [stringValue(item.coreCode), stringValue(content?.pattern), fenced?.[1]].filter(
      (value): value is string => Boolean(value?.trim())
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
      'Code evidence must match a cited source line range and must not be placeholder code (operation(), doThing, foo, bar, TODO).',
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
      'Relationship claims require fresh graph-backed refs; stale/partial/pending graph evidence is rejected.',
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
    params: { codeFingerprintFloor: 20, patternFloor: 30 },
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

  // Session scope (runtime port) — only when injected.
  if (opts.sessionScope) {
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

  // Snippet match + placeholder (pure, operate on resolved range text).
  for (const snippet of collectCodeEvidence(item)) {
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

  // Evidence floor (pure, distinct sourcePaths) — only meaningful once refs are resolved.
  if (opts.sourceRefResolver && opts.projectRoot) {
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
