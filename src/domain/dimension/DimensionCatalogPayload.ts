import { getCursorDeliverySpec } from '../knowledge/FieldSpec.js';
import { PROJECT_SNAPSHOT_STYLE_GUIDE } from '../knowledge/StyleGuide.js';
import { DIMENSION_REGISTRY } from './DimensionRegistry.js';
import { type FullSop, getDimensionSOP, PRE_SUBMIT_CHECKLIST } from './DimensionSop.js';
import type { UnifiedDimension } from './UnifiedDimension.js';

export interface ProjectLanguageFrameworkFacts {
  readonly languages?: readonly string[];
  readonly frameworks?: readonly string[];
  readonly primaryLanguage?: string;
  readonly primaryFramework?: string;
}

export interface DimensionLanguageApplicability {
  readonly applicable: boolean;
  readonly reason:
    | 'universal-dimension'
    | 'language-match'
    | 'framework-match'
    | 'language-framework-match'
    | 'no-factual-match';
  readonly requiredLanguages: readonly string[];
  readonly requiredFrameworks: readonly string[];
  readonly matchedLanguages: readonly string[];
  readonly matchedFrameworks: readonly string[];
}

export interface DimensionAnalysisGuide {
  readonly goal: string;
  readonly focus: string;
  readonly steps: FullSop['steps'];
  readonly timeEstimate: string;
  readonly commonMistakes: readonly string[];
}

export interface DimensionSubmissionSpec {
  readonly knowledgeTypes: readonly string[];
  readonly targetCandidateCount: string;
  readonly contentStyle: string;
  readonly contentQuality: string;
  readonly crossDimensionDedup: string;
  readonly cursorFields: ReturnType<typeof getCursorDeliverySpec>;
  readonly dimensionCompleteGuide: string;
  readonly preSubmitChecklist: typeof PRE_SUBMIT_CHECKLIST;
}

export interface DimensionCatalogPayloadItem {
  readonly id: string;
  readonly label: string;
  readonly layer: UnifiedDimension['layer'];
  readonly icon: string;
  readonly colorFamily: string;
  readonly extractionGuide: string;
  readonly allowedKnowledgeTypes: readonly string[];
  readonly outputMode: UnifiedDimension['outputMode'];
  readonly qualityDescription: string;
  readonly matchTopics: readonly string[];
  readonly matchCategories: readonly string[];
  readonly weight: number;
  readonly suggestedTopics: readonly string[];
  readonly relatedRoles: readonly string[];
  readonly conditions?: UnifiedDimension['conditions'];
  readonly tierHint?: number;
  readonly displayGroup: UnifiedDimension['displayGroup'];
  readonly languageApplicable: boolean;
  readonly languageApplicability: DimensionLanguageApplicability;
  readonly sop: FullSop;
  readonly analysisGuide: DimensionAnalysisGuide;
  readonly submissionSpec: DimensionSubmissionSpec;
}

const TOKEN_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'c#': 'csharp',
  dotnet: 'csharp',
  'dot-net': 'csharp',
  js: 'javascript',
  next: 'nextjs',
  'next.js': 'nextjs',
  nodejs: 'javascript',
  objc: 'objectivec',
  'objective-c': 'objectivec',
  springboot: 'spring-boot',
  ts: 'typescript',
});

/**
 * 为 draft 的 Pillar B 构建完整维度资料。
 *
 * 这里故意只投射事实：全量注册表、完整 SOP、提交规范，以及透明
 * languageApplicable 标签。它不排序、不筛选、不推荐、不估算规模。
 */
export function buildDimensionCatalogPayload(
  facts: ProjectLanguageFrameworkFacts = {},
  dimensions: readonly UnifiedDimension[] = DIMENSION_REGISTRY
): readonly DimensionCatalogPayloadItem[] {
  return Object.freeze(
    dimensions.map((dimension) => {
      const sop = getDimensionSOP(dimension.id);
      if (!sop) {
        throw new Error(`Missing SOP for dimension "${dimension.id}".`);
      }
      const clonedSop = cloneSop(sop);
      const applicability = resolveDimensionLanguageApplicability(dimension, facts);
      return Object.freeze({
        id: dimension.id,
        label: dimension.label,
        layer: dimension.layer,
        icon: dimension.icon,
        colorFamily: dimension.colorFamily,
        extractionGuide: dimension.extractionGuide,
        allowedKnowledgeTypes: Object.freeze([...dimension.allowedKnowledgeTypes]),
        outputMode: dimension.outputMode,
        qualityDescription: dimension.qualityDescription,
        matchTopics: Object.freeze([...dimension.matchTopics]),
        matchCategories: Object.freeze([...dimension.matchCategories]),
        weight: dimension.weight,
        suggestedTopics: Object.freeze([...dimension.suggestedTopics]),
        relatedRoles: Object.freeze([...dimension.relatedRoles]),
        conditions: cloneConditions(dimension.conditions),
        tierHint: dimension.tierHint,
        displayGroup: dimension.displayGroup,
        languageApplicable: applicability.applicable,
        languageApplicability: applicability,
        sop: clonedSop,
        analysisGuide: Object.freeze({
          goal: `分析项目的${dimension.label}`,
          focus: dimension.extractionGuide,
          steps: clonedSop.steps,
          timeEstimate: clonedSop.timeEstimate,
          commonMistakes: clonedSop.commonMistakes,
        }),
        submissionSpec: buildSubmissionSpec(dimension),
      });
    })
  );
}

export function resolveDimensionLanguageApplicability(
  dimension: UnifiedDimension,
  facts: ProjectLanguageFrameworkFacts = {}
): DimensionLanguageApplicability {
  const requiredLanguages = normalizeTokens(dimension.conditions?.languages ?? []);
  const requiredFrameworks = normalizeTokens(dimension.conditions?.frameworks ?? []);
  if (requiredLanguages.length === 0 && requiredFrameworks.length === 0) {
    return freezeApplicability({
      applicable: true,
      reason: 'universal-dimension',
      requiredLanguages,
      requiredFrameworks,
      matchedLanguages: [],
      matchedFrameworks: [],
    });
  }

  const projectLanguages = normalizeTokens([facts.primaryLanguage, ...(facts.languages ?? [])]);
  const projectFrameworks = normalizeTokens([facts.primaryFramework, ...(facts.frameworks ?? [])]);
  const matchedLanguages = intersectTokens(projectLanguages, requiredLanguages);
  const matchedFrameworks = intersectTokens(projectFrameworks, requiredFrameworks);
  const frameworkScoped = requiredFrameworks.length > 0;
  const applicable = frameworkScoped ? matchedFrameworks.length > 0 : matchedLanguages.length > 0;

  return freezeApplicability({
    applicable,
    reason: applicable
      ? matchedLanguages.length > 0 && matchedFrameworks.length > 0
        ? 'language-framework-match'
        : matchedFrameworks.length > 0
          ? 'framework-match'
          : 'language-match'
      : 'no-factual-match',
    requiredLanguages,
    requiredFrameworks,
    matchedLanguages,
    matchedFrameworks,
  });
}

function buildSubmissionSpec(dimension: UnifiedDimension): DimensionSubmissionSpec {
  return Object.freeze({
    knowledgeTypes: Object.freeze([...dimension.allowedKnowledgeTypes]),
    targetCandidateCount:
      '每维度按实际证据提交；没有实质内容可以提交 0 条。不要为了凑数合并不同关注点或编造候选。',
    contentStyle: PROJECT_SNAPSHOT_STYLE_GUIDE.split('\n')
      .filter((line) => !line.startsWith('#') || line.startsWith('##'))
      .filter((line) => line.trim())
      .slice(0, 12)
      .join('\n'),
    contentQuality:
      'content.markdown 必须包含项目真实源码证据、完整相对路径和行号；短文本、泛化结论或无来源候选应被拒绝。',
    crossDimensionDedup: '同一知识点只提交到最核心的维度。不要把同一规则换角度重复提交到多个维度。',
    cursorFields: getCursorDeliverySpec(),
    dimensionCompleteGuide:
      'dimension_complete 需要 referencedFiles、keyFindings 和含源码证据的 analysisText；数量由真实分析结果决定。',
    preSubmitChecklist: PRE_SUBMIT_CHECKLIST,
  });
}

function cloneSop(sop: FullSop): FullSop {
  return Object.freeze({
    ...(sop.focusKeywords
      ? { focusKeywords: Object.freeze([...sop.focusKeywords]) as string[] }
      : {}),
    steps: Object.freeze(
      sop.steps.map((step) =>
        Object.freeze({
          ...step,
          ...(step.tools ? { tools: Object.freeze([...step.tools]) as string[] } : {}),
          ...(step.qualityChecklist
            ? { qualityChecklist: Object.freeze([...step.qualityChecklist]) as string[] }
            : {}),
        })
      )
    ) as FullSop['steps'],
    timeEstimate: sop.timeEstimate,
    commonMistakes: Object.freeze([...sop.commonMistakes]) as string[],
  });
}

function cloneConditions(conditions: UnifiedDimension['conditions']) {
  if (!conditions) {
    return undefined;
  }
  return Object.freeze({
    ...(conditions.languages
      ? { languages: Object.freeze([...conditions.languages]) as string[] }
      : {}),
    ...(conditions.frameworks
      ? { frameworks: Object.freeze([...conditions.frameworks]) as string[] }
      : {}),
  });
}

function freezeApplicability(
  value: DimensionLanguageApplicability
): DimensionLanguageApplicability {
  return Object.freeze({
    applicable: value.applicable,
    reason: value.reason,
    requiredLanguages: Object.freeze([...value.requiredLanguages]),
    requiredFrameworks: Object.freeze([...value.requiredFrameworks]),
    matchedLanguages: Object.freeze([...value.matchedLanguages]),
    matchedFrameworks: Object.freeze([...value.matchedFrameworks]),
  });
}

function normalizeTokens(tokens: readonly (string | undefined)[]): string[] {
  return uniqueSorted(
    tokens.map((token) => normalizeToken(token)).filter((token): token is string => Boolean(token))
  );
}

function normalizeToken(token: string | undefined): string | null {
  const trimmed = token?.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  const alias = TOKEN_ALIASES[trimmed];
  if (alias) {
    return alias;
  }
  const compact = trimmed.replace(/[^a-z0-9#+.-]+/g, '-').replace(/^-+|-+$/g, '');
  return TOKEN_ALIASES[compact] ?? compact;
}

function intersectTokens(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((token) => rightSet.has(token));
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
