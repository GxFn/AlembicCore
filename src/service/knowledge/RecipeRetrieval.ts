import { createHash } from 'node:crypto';
import type { RecipeRetrievalProfile } from '../../domain/knowledge/RecipeRetrievalProfile.js';

export const RECIPE_RETRIEVAL_PROFILE_SCHEMA_VERSION = '1';
export const RECIPE_RETRIEVAL_PROJECTION_SCHEMA_VERSION = '1';

export type RecipeRetrievalDocumentRole = 'intent' | 'guidance' | 'implementation' | 'rationale';

export interface RecipeRetrievalSource {
  id?: string;
  title?: string;
  description?: string;
  lifecycle?: string;
  language?: string;
  dimensionId?: string;
  category?: string;
  knowledgeType?: string;
  kind?: string;
  tags?: string[];
  trigger?: string;
  topicHint?: string;
  whenClause?: string;
  doClause?: string;
  dontClause?: string;
  coreCode?: string;
  usageGuide?: string;
  moduleName?: string;
  content?: unknown;
  reasoning?: unknown;
  retrievalProfile?: RecipeRetrievalProfile | null;
}

export interface RecipeRetrievalDocument {
  role: RecipeRetrievalDocumentRole;
  candidateEligible: boolean;
  text: string;
  contentHash: string;
  sourceFields: string[];
  provenanceRefs: string[];
  sourceContentHash: string;
  profileHash: string;
  documentSetHash: string;
}

export interface RecipeRetrievalDocumentSet {
  projectionSchemaVersion: string;
  recipeId: string;
  profileMode: 'native' | 'compatibility';
  sourceContentHash: string;
  profileHash: string;
  documentSetHash: string;
  documents: RecipeRetrievalDocument[];
  warnings: Array<{ code: string; message: string }>;
}

export interface RetrievalReadinessViolation {
  code: string;
  field?: string;
  message: string;
  provenanceRefs?: string[];
}

export interface RetrievalReadinessReport {
  ready: boolean;
  schemaVersion: string;
  profileHash: string | null;
  documentSetHash: string | null;
  violations: RetrievalReadinessViolation[];
  warnings: Array<{ code: string; message: string }>;
}

export interface RetrievalReadinessDiagnostics {
  /** 仅产生 warning；不得改变 ready/violations/hash。 */
  providerAvailable?: boolean;
  vectorStoreAvailable?: boolean;
  providerModel?: string | null;
  vectorDimension?: number | null;
  rankingMetricsAvailable?: boolean;
  indexGenerationStatus?: 'ready' | 'pending' | 'stale' | 'failed';
}

type DraftDocument = Omit<RecipeRetrievalDocument, 'documentSetHash'>;
const DEFAULT_ONLY_RETRIEVAL_CONCEPTS = new Set(['utility', 'general', 'default']);
const PLACEHOLDER_RETRIEVAL_CONCEPTS = new Set([
  '',
  '-',
  'n/a',
  'na',
  'none',
  'null',
  'undefined',
  'unknown',
  'todo',
  'tbd',
]);
type MeaninglessRetrievalConceptKind = 'placeholder' | 'default-only';

/**
 * Recipe 源事实的确定性 hash。时间、运行时 handle、质量台账与本地路径均不参与，
 * 因而 event/full/reconcile 三条派生链可以得到相同 identity。
 */
export function computeRecipeSourceContentHash(source: RecipeRetrievalSource): string {
  return stableHash(recipeSourceContentIdentity(source));
}

function recipeSourceContentIdentity(source: RecipeRetrievalSource): Record<string, unknown> {
  const content = plainRecord(source.content);
  const reasoning = plainRecord(source.reasoning);
  return {
    category: text(source.category),
    content: {
      markdown: text(content.markdown),
      pattern: text(content.pattern),
      rationale: text(content.rationale),
    },
    coreCode: text(source.coreCode),
    description: text(source.description),
    dimensionId: text(source.dimensionId),
    doClause: text(source.doClause),
    dontClause: text(source.dontClause),
    kind: text(source.kind),
    knowledgeType: text(source.knowledgeType),
    language: text(source.language),
    moduleName: text(source.moduleName),
    reasoning: {
      sources: stringArray(reasoning.sources),
      whyStandard: text(reasoning.whyStandard),
    },
    tags: stringArray(source.tags),
    title: text(source.title),
    topicHint: text(source.topicHint),
    trigger: text(source.trigger),
    usageGuide: text(source.usageGuide),
    whenClause: text(source.whenClause),
  };
}

function computeLegacyRecipeSourceContentHash(source: RecipeRetrievalSource): string {
  return stableHash({ ...recipeSourceContentIdentity(source), id: text(source.id) });
}

/**
 * 老 Recipe 的只读兼容 profile。只搬运已有字段；中文事实不会被翻译或扩写，
 * 因此 compatibility projection 永远不会伪造 evidence-grounded English。
 */
export function projectCompatibilityRecipeRetrievalProfile(
  source: RecipeRetrievalSource
): RecipeRetrievalProfile {
  const content = plainRecord(source.content);
  const reasoning = plainRecord(source.reasoning);
  const evidenceRefs = stringArray(reasoning.sources);
  const sourceFieldRefs = existingSourceFieldRefs(source, content);
  const language = text(source.language) || inferLanguage(source);
  const primarySummary = firstNonEmpty(
    source.description,
    source.doClause,
    content.rationale,
    content.markdown,
    source.title
  );
  const technicalEnglish = isEnglishText(primarySummary) ? primarySummary : '';

  const concepts = distinctFacts(
    [source.tags, [source.topicHint, source.moduleName, source.category]].flatMap((value) =>
      stringArray(value)
    )
  )
    .filter((term) => language === 'en' || !isEnglishText(term) || source.tags?.includes(term))
    .map((term) => ({
      term,
      language: isEnglishText(term) ? 'en' : language,
      provenanceRefs: [sourceFieldForValue(source, term)],
    }));

  const scenarios = text(source.whenClause)
    ? [
        {
          text: text(source.whenClause),
          language: isEnglishText(text(source.whenClause)) ? 'en' : language,
          provenanceRefs: ['field:whenClause'],
        },
      ]
    : [];
  const exclusions = text(source.dontClause)
    ? [
        {
          text: text(source.dontClause),
          language: isEnglishText(text(source.dontClause)) ? 'en' : language,
          provenanceRefs: ['field:dontClause'],
        },
      ]
    : [];

  return {
    schemaVersion: RECIPE_RETRIEVAL_PROFILE_SCHEMA_VERSION,
    primaryLanguage: language,
    summary: { primary: primarySummary, technicalEnglish },
    concepts,
    scenarios,
    exclusions,
    provenance: {
      evidenceRefs,
      sourceFieldRefs,
      sourceContentHash: computeRecipeSourceContentHash(source),
      generator: 'compatibility-existing-fields-v1',
    },
  };
}

/** 统一 sparse/dense 事实 projector。 */
export function projectRecipeRetrievalDocumentSet(
  source: RecipeRetrievalSource
): RecipeRetrievalDocumentSet {
  const profileMode = source.retrievalProfile ? 'native' : 'compatibility';
  const profile = normalizeProfile(
    source.retrievalProfile ?? projectCompatibilityRecipeRetrievalProfile(source)
  );
  const sourceContentHash = computeRecipeSourceContentHash(source);
  const profileHash = stableHash(profile);
  const content = plainRecord(source.content);
  const reasoning = plainRecord(source.reasoning);
  const profileRefs = distinctStrings([
    ...profile.provenance.evidenceRefs,
    ...profile.provenance.sourceFieldRefs,
  ]);

  const drafts: DraftDocument[] = [];
  addDocument(drafts, {
    role: 'intent',
    values: [
      source.title,
      source.trigger,
      source.description,
      source.topicHint,
      profile.summary.primary,
      profile.summary.technicalEnglish,
      ...profile.concepts.map((item) => item.term),
      ...profile.scenarios.map((item) => item.text),
    ],
    sourceFields: [
      'title',
      'trigger',
      'description',
      'topicHint',
      'retrievalProfile.summary',
      'retrievalProfile.concepts',
      'retrievalProfile.scenarios',
    ],
    provenanceRefs: profileRefs,
    required: true,
    sourceContentHash,
    profileHash,
  });
  addDocument(drafts, {
    role: 'guidance',
    values: [
      source.whenClause,
      source.doClause,
      source.dontClause,
      ...profile.exclusions.map((item) => item.text),
    ],
    sourceFields: ['whenClause', 'doClause', 'dontClause', 'retrievalProfile.exclusions'],
    provenanceRefs: profileRefs,
    sourceContentHash,
    profileHash,
  });
  const boundedCoreCode = profile.provenance.evidenceRefs.some(isBoundedSourceRange)
    ? source.coreCode
    : '';
  addDocument(drafts, {
    role: 'implementation',
    values: [boundedCoreCode, content.pattern, content.markdown, source.usageGuide],
    sourceFields: ['coreCode', 'content.pattern', 'content.markdown', 'usageGuide'],
    provenanceRefs: profileRefs,
    sourceContentHash,
    profileHash,
  });
  addDocument(drafts, {
    role: 'rationale',
    values: [content.rationale, reasoning.whyStandard],
    sourceFields: ['content.rationale', 'reasoning.whyStandard'],
    provenanceRefs: distinctStrings([...profileRefs, ...stringArray(reasoning.sources)]),
    sourceContentHash,
    profileHash,
  });

  const distinctDrafts = collapseDuplicateDocuments(drafts);
  const documentSetHash = stableHash({
    documents: distinctDrafts.map((document) => ({
      contentHash: document.contentHash,
      role: document.role,
      sourceFields: document.sourceFields,
    })),
    profileHash,
    projectionSchemaVersion: RECIPE_RETRIEVAL_PROJECTION_SCHEMA_VERSION,
    recipeId: text(source.id),
    sourceContentHash,
  });

  const warnings: Array<{ code: string; message: string }> = [];
  if (profileMode === 'compatibility') {
    warnings.push({
      code: 'retrieval.profile.compatibility',
      message: 'Recipe has no native retrieval profile; existing facts are projected read-only.',
    });
  }

  return {
    projectionSchemaVersion: RECIPE_RETRIEVAL_PROJECTION_SCHEMA_VERSION,
    recipeId: text(source.id),
    profileMode,
    sourceContentHash,
    profileHash,
    documentSetHash,
    documents: distinctDrafts.map((document) => ({ ...document, documentSetHash })),
    warnings,
  };
}

/** sparse lane 仅改变 role 权重，不改变 document set 中的事实。 */
export function serializeRecipeRetrievalDocumentSetForSparse(
  documentSet: RecipeRetrievalDocumentSet
): string {
  return documentSet.documents
    .filter((document) => document.candidateEligible)
    .flatMap((document) =>
      document.role === 'intent' ? [document.text, document.text] : [document.text]
    )
    .join('\n');
}

export function evaluateRecipeRetrievalReadiness(
  source: RecipeRetrievalSource,
  diagnostics: RetrievalReadinessDiagnostics = {}
): RetrievalReadinessReport {
  const violations: RetrievalReadinessViolation[] = [];
  const warnings: Array<{ code: string; message: string }> = [];
  const nativeProfile = source.retrievalProfile ? normalizeProfile(source.retrievalProfile) : null;

  if (!nativeProfile) {
    violations.push({
      code: 'retrieval.profile.missing',
      field: 'retrievalProfile',
      message: 'A native retrieval profile is required before active publish.',
    });
  } else {
    if (nativeProfile.schemaVersion !== RECIPE_RETRIEVAL_PROFILE_SCHEMA_VERSION) {
      violations.push({
        code: 'retrieval.profile.schema-unsupported',
        field: 'retrievalProfile.schemaVersion',
        message: `Unsupported retrieval profile schema: ${nativeProfile.schemaVersion}`,
      });
    }
    if (!nativeProfile.summary.primary) {
      violations.push({
        code: 'retrieval.profile.primary-summary-missing',
        field: 'retrievalProfile.summary.primary',
        message: 'Primary-language retrieval summary is required.',
      });
    }
    if (!nativeProfile.primaryLanguage) {
      violations.push({
        code: 'retrieval.profile.primary-language-missing',
        field: 'retrievalProfile.primaryLanguage',
        message: 'The primary retrieval language is required.',
      });
    }
    if (
      nativeProfile.provenance.evidenceRefs.length === 0 &&
      nativeProfile.provenance.sourceFieldRefs.length === 0
    ) {
      violations.push({
        code: 'retrieval.profile.provenance-missing',
        field: 'retrievalProfile.provenance',
        message: 'Retrieval facts require source-field or evidence provenance.',
      });
    }
    const validSourceFieldRefs = new Set(
      existingSourceFieldRefs(source, plainRecord(source.content))
    );
    for (const sourceFieldRef of nativeProfile.provenance.sourceFieldRefs) {
      if (!validSourceFieldRefs.has(sourceFieldRef)) {
        violations.push({
          code: 'retrieval.profile.source-field-ref-invalid',
          field: 'retrievalProfile.provenance.sourceFieldRefs',
          message: `Retrieval source field does not exist in the Recipe: ${sourceFieldRef}`,
          provenanceRefs: [sourceFieldRef],
        });
      }
    }
    if (hasTechnicalContent(source) && !nativeProfile.summary.technicalEnglish) {
      violations.push({
        code: 'retrieval.profile.technical-english-missing',
        field: 'retrievalProfile.summary.technicalEnglish',
        message: 'Technical Recipes require an evidence-grounded English retrieval summary.',
      });
    }

    const allowedRefs = new Set([
      ...nativeProfile.provenance.evidenceRefs,
      ...nativeProfile.provenance.sourceFieldRefs,
    ]);
    for (const [bucket, facts] of [
      ['concepts', nativeProfile.concepts],
      ['scenarios', nativeProfile.scenarios],
      ['exclusions', nativeProfile.exclusions],
    ] as const) {
      const seen = new Set<string>();
      for (const [index, fact] of facts.entries()) {
        const value = 'term' in fact ? fact.term : fact.text;
        const normalized = comparable(value);
        const meaninglessKind =
          bucket === 'concepts' ? classifyMeaninglessRetrievalConcept(value) : null;
        if (meaninglessKind) {
          violations.push({
            code: `retrieval.profile.concept-${meaninglessKind}`,
            field: `retrievalProfile.${bucket}.${index}`,
            message:
              meaninglessKind === 'placeholder'
                ? 'Placeholder labels are not retrieval concepts.'
                : 'Default-only topic, category, or module labels are not retrieval concepts.',
            provenanceRefs: fact.provenanceRefs,
          });
        }
        if (seen.has(normalized)) {
          violations.push({
            code: 'retrieval.profile.fact-duplicate',
            field: `retrievalProfile.${bucket}.${index}`,
            message: 'Retrieval facts must be semantically distinct.',
          });
        }
        seen.add(normalized);
        if (
          fact.provenanceRefs.length === 0 ||
          fact.provenanceRefs.some((ref) => !allowedRefs.has(ref))
        ) {
          violations.push({
            code: 'retrieval.profile.fact-ungrounded',
            field: `retrievalProfile.${bucket}.${index}`,
            message: 'Every retrieval fact must resolve to profile evidence or source fields.',
            provenanceRefs: fact.provenanceRefs,
          });
        }
      }
    }

    const expectedSourceHash = computeRecipeSourceContentHash(source);
    const legacySourceHash = computeLegacyRecipeSourceContentHash(source);
    if (
      nativeProfile.provenance.sourceContentHash !== expectedSourceHash &&
      nativeProfile.provenance.sourceContentHash !== legacySourceHash
    ) {
      violations.push({
        code: 'retrieval.profile.source-hash-mismatch',
        field: 'retrievalProfile.provenance.sourceContentHash',
        message: 'Retrieval profile provenance does not match current Recipe source facts.',
      });
    }
  }

  const coreCode = text(source.coreCode);
  if (coreCode) {
    const evidenceRefs = nativeProfile?.provenance.evidenceRefs ?? [];
    const boundedEvidence = evidenceRefs.some(isBoundedSourceRange);
    const lineCount = coreCode.split('\n').length;
    if (!boundedEvidence || lineCount > 120 || coreCode.length > 12_000) {
      violations.push({
        code: 'retrieval.core-code.unbounded',
        field: 'coreCode',
        message: 'coreCode requires a bounded source range and must not contain a whole file.',
        provenanceRefs: evidenceRefs,
      });
    }
  }

  let profileHash: string | null = null;
  let documentSetHash: string | null = null;
  try {
    const documentSet = projectRecipeRetrievalDocumentSet(source);
    profileHash = nativeProfile ? stableHash(nativeProfile) : null;
    documentSetHash = nativeProfile ? documentSet.documentSetHash : null;
    const intent = documentSet.documents.find((document) => document.role === 'intent');
    if (!intent?.text) {
      violations.push({
        code: 'retrieval.projector.intent-missing',
        field: 'retrievalProfile',
        message: 'The retrieval projector must emit one non-empty intent document.',
      });
    }
    if (documentSet.documents.some((document) => document.text.length > 2_400)) {
      violations.push({
        code: 'retrieval.projector.role-budget-exceeded',
        message: 'A retrieval role exceeds the deterministic 2400 character budget.',
      });
    }
    for (const role of ['implementation', 'rationale'] as const) {
      if (!documentSet.documents.some((document) => document.role === role)) {
        warnings.push({
          code: `retrieval.projector.${role}-missing`,
          message: `Optional ${role} retrieval role is absent.`,
        });
      }
    }
  } catch (error: unknown) {
    violations.push({
      code: 'retrieval.projector.failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  if (diagnostics.providerAvailable === false) {
    warnings.push({
      code: 'retrieval.provider.unavailable',
      message: 'Embedding provider is unavailable; truth readiness is unchanged.',
    });
  }
  if (diagnostics.vectorStoreAvailable === false) {
    warnings.push({
      code: 'retrieval.vector-store.unavailable',
      message: 'Vector storage is unavailable; truth readiness is unchanged.',
    });
  }
  if (diagnostics.providerModel === null || diagnostics.providerModel === '') {
    warnings.push({
      code: 'retrieval.provider.model-missing',
      message: 'Embedding model identity is unavailable; truth readiness is unchanged.',
    });
  }
  if (diagnostics.vectorDimension === null) {
    warnings.push({
      code: 'retrieval.vector.dimension-missing',
      message: 'Embedding dimension is unavailable; truth readiness is unchanged.',
    });
  }
  if (diagnostics.rankingMetricsAvailable === false) {
    warnings.push({
      code: 'retrieval.ranking.metrics-missing',
      message: 'Ranking metrics are unavailable; truth readiness is unchanged.',
    });
  }
  if (diagnostics.indexGenerationStatus && diagnostics.indexGenerationStatus !== 'ready') {
    warnings.push({
      code: `retrieval.index.${diagnostics.indexGenerationStatus}`,
      message: `Vector generation is ${diagnostics.indexGenerationStatus}; publish readiness is unchanged.`,
    });
  }

  return {
    ready: violations.length === 0,
    schemaVersion: RECIPE_RETRIEVAL_PROFILE_SCHEMA_VERSION,
    profileHash,
    documentSetHash,
    violations: violations.sort(compareDiagnostic),
    warnings: warnings.sort((a, b) => a.code.localeCompare(b.code)),
  };
}

function addDocument(
  target: DraftDocument[],
  input: {
    role: RecipeRetrievalDocumentRole;
    values: unknown[];
    sourceFields: string[];
    provenanceRefs: string[];
    sourceContentHash: string;
    profileHash: string;
    required?: boolean;
  }
): void {
  const lines = distinctStrings(input.values.map(text)).filter(
    (value) => !classifyMeaninglessRetrievalConcept(value)
  );
  if (lines.length === 0 && !input.required) {
    return;
  }
  const documentText = clip(lines.join('\n'), 2_400);
  if (!documentText) {
    throw new Error(`Recipe retrieval ${input.role} document is empty.`);
  }
  target.push({
    role: input.role,
    candidateEligible: true,
    text: documentText,
    contentHash: stableHash({ role: input.role, text: documentText }),
    sourceFields: distinctStrings(input.sourceFields),
    provenanceRefs: distinctStrings(input.provenanceRefs),
    sourceContentHash: input.sourceContentHash,
    profileHash: input.profileHash,
  });
}

function collapseDuplicateDocuments(documents: DraftDocument[]): DraftDocument[] {
  const seen = new Set<string>();
  const result: DraftDocument[] = [];
  for (const document of documents) {
    const key = comparable(document.text);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(document);
  }
  return result;
}

function normalizeProfile(profile: RecipeRetrievalProfile): RecipeRetrievalProfile {
  return {
    schemaVersion: text(profile.schemaVersion),
    primaryLanguage: text(profile.primaryLanguage),
    summary: {
      primary: text(profile.summary?.primary),
      technicalEnglish: text(profile.summary?.technicalEnglish),
    },
    concepts: normalizeFacts(profile.concepts, 'term'),
    scenarios: normalizeFacts(profile.scenarios, 'text'),
    exclusions: normalizeFacts(profile.exclusions, 'text'),
    provenance: {
      evidenceRefs: distinctStrings(profile.provenance?.evidenceRefs ?? []),
      sourceFieldRefs: distinctStrings(profile.provenance?.sourceFieldRefs ?? []),
      sourceContentHash: text(profile.provenance?.sourceContentHash),
      generator: text(profile.provenance?.generator),
    },
  };
}

function normalizeFacts<T extends 'term' | 'text'>(
  facts: unknown,
  valueKey: T
): Array<{ language: string; provenanceRefs: string[] } & Record<T, string>> {
  if (!Array.isArray(facts)) {
    return [];
  }
  return facts
    .map((fact) => plainRecord(fact))
    .map(
      (fact) =>
        ({
          [valueKey]: text(fact[valueKey]),
          language: text(fact.language),
          provenanceRefs: distinctStrings(
            Array.isArray(fact.provenanceRefs) ? fact.provenanceRefs : []
          ),
        }) as { language: string; provenanceRefs: string[] } & Record<T, string>
    )
    .filter((fact) => Boolean(fact[valueKey]));
}

function existingSourceFieldRefs(
  source: RecipeRetrievalSource,
  content: Record<string, unknown>
): string[] {
  return distinctStrings(
    [
      ['title', source.title],
      ['language', source.language],
      ['dimensionId', source.dimensionId],
      ['category', source.category],
      ['knowledgeType', source.knowledgeType],
      ['kind', source.kind],
      ['tags', source.tags?.join(' ')],
      ['description', source.description],
      ['trigger', source.trigger],
      ['topicHint', source.topicHint],
      ['moduleName', source.moduleName],
      ['whenClause', source.whenClause],
      ['doClause', source.doClause],
      ['dontClause', source.dontClause],
      ['coreCode', source.coreCode],
      ['usageGuide', source.usageGuide],
      ['content.pattern', content.pattern],
      ['content.markdown', content.markdown],
      ['content.rationale', content.rationale],
    ]
      .filter(([, value]) => Boolean(text(value)))
      .map(([field]) => `field:${field}`)
  );
}

function sourceFieldForValue(source: RecipeRetrievalSource, value: string): string {
  if (source.tags?.includes(value)) {
    return 'field:tags';
  }
  if (text(source.topicHint) === value) {
    return 'field:topicHint';
  }
  if (text(source.moduleName) === value) {
    return 'field:moduleName';
  }
  return 'field:category';
}

function isBoundedSourceRange(value: string): boolean {
  const match = value.match(/:(\d+)(?:-(\d+))?$/);
  if (!match) {
    return false;
  }
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  return start > 0 && end >= start && end - start <= 160;
}

function hasTechnicalContent(source: RecipeRetrievalSource): boolean {
  const content = plainRecord(source.content);
  return Boolean(
    text(source.coreCode) ||
      text(content.pattern) ||
      text(source.doClause) ||
      text(source.dontClause) ||
      text(source.knowledgeType)
  );
}

function inferLanguage(source: RecipeRetrievalSource): string {
  const sample = firstNonEmpty(source.description, source.title, source.doClause);
  return isEnglishText(sample) ? 'en' : 'und';
}

function isEnglishText(value: string): boolean {
  const letters = value.match(/[A-Za-z]/g)?.length ?? 0;
  const cjk = value.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  return letters >= 4 && letters > cjk;
}

function classifyMeaninglessRetrievalConcept(
  value: unknown
): MeaninglessRetrievalConceptKind | null {
  const normalized = comparable(value);
  if (PLACEHOLDER_RETRIEVAL_CONCEPTS.has(normalized)) {
    return 'placeholder';
  }
  if (DEFAULT_ONLY_RETRIEVAL_CONCEPTS.has(normalized)) {
    return 'default-only';
  }
  return null;
}

function firstNonEmpty(...values: unknown[]): string {
  return values.map(text).find(Boolean) ?? '';
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }
  if (typeof value === 'string') {
    try {
      return plainRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const candidate = value as Record<string, unknown> & { toJSON?: () => unknown };
    if (typeof candidate.toJSON === 'function') {
      return plainRecord(candidate.toJSON());
    }
    return candidate;
  }
  return {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return distinctStrings(value.map(text));
}

function distinctFacts(values: string[]): string[] {
  return distinctStrings(values).filter((value) => !classifyMeaninglessRetrievalConcept(value));
}

function distinctStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = text(value);
    const key = comparable(normalized);
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function comparable(value: unknown): string {
  return text(value).toLowerCase().replace(/\s+/g, ' ');
}

function clip(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(0, maxChars).trim();
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function compareDiagnostic(a: RetrievalReadinessViolation, b: RetrievalReadinessViolation): number {
  return a.code.localeCompare(b.code) || (a.field ?? '').localeCompare(b.field ?? '');
}
