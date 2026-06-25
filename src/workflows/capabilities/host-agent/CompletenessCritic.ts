const DEFAULT_TARGET_PER_DIMENSION = 5;
const DEFAULT_FLOOR_PER_DIMENSION = 3;
const DEFAULT_MAX_HINTS = 5;

export type CompletenessCriticStatus =
  | 'has-grounded-hints'
  | 'satisfied'
  | 'exhausted'
  | 'insufficient-grounded-evidence';

export type CompletenessCriticCoverageStatus = 'covered' | 'uncovered' | 'ungrounded';

export interface CompletenessSourceRef {
  path: string;
  line?: number;
  symbol?: string;
  qualifiedPath?: string;
  relativePath?: string;
  kind?: string;
  reason?: string;
}

export type CompletenessSourceRefInput = string | CompletenessSourceRef;

export interface CompletenessMiningGuidance {
  id?: string;
  title: string;
  description?: string;
  importance?: number;
  keywords?: readonly string[];
  dimensionIds?: readonly string[];
  sourceRefs?: readonly CompletenessSourceRefInput[];
}

export interface CompletenessProjectFact {
  id?: string;
  title?: string;
  label?: string;
  description?: string;
  importance?: number;
  dimensionIds?: readonly string[];
  tags?: readonly string[];
  sourceRefs?: readonly CompletenessSourceRefInput[];
}

export interface CompletenessProjectFile {
  path?: string;
  relativePath?: string;
  qualifiedPath?: string;
  name?: string;
  summary?: string;
  priority?: string;
  importance?: number;
  dimensionIds?: readonly string[];
  tags?: readonly string[];
}

export interface CompletenessProjectSymbol {
  name: string;
  file?: string;
  path?: string;
  relativePath?: string;
  qualifiedPath?: string;
  kind?: string;
  summary?: string;
  importance?: number;
  dimensionIds?: readonly string[];
  tags?: readonly string[];
}

export interface CompletenessProjectArea {
  name: string;
  description?: string;
  importance?: number;
  dimensionIds?: readonly string[];
  tags?: readonly string[];
  sourceRefs?: readonly CompletenessSourceRefInput[];
  keyFiles?: readonly CompletenessSourceRefInput[];
}

export interface CompletenessProjectInfoTree {
  facts?: readonly CompletenessProjectFact[];
  files?: readonly CompletenessProjectFile[];
  symbols?: readonly CompletenessProjectSymbol[];
  modules?: readonly CompletenessProjectArea[];
  areas?: readonly CompletenessProjectArea[];
}

export interface CompletenessSubmittedRecipe {
  id?: string;
  title?: string;
  dimensionId?: string;
  sourceRefs?: readonly CompletenessSourceRefInput[];
  reasoning?: {
    sources?: readonly string[];
  };
}

export interface CompletenessCriticInput {
  dimensionId: string;
  miningGuidance?: readonly CompletenessMiningGuidance[];
  projectInfoTree?: CompletenessProjectInfoTree;
  projectFacts?: readonly CompletenessProjectFact[];
  submittedRecipes?: readonly CompletenessSubmittedRecipe[];
  submittedSourceRefs?: readonly CompletenessSourceRefInput[];
  submittedRecipeCount?: number;
  targetPerDimension?: number;
  floorPerDimension?: number;
  noPadding?: boolean;
  exhaustedReason?: string;
  maxHints?: number;
}

export interface CompletenessCriticHint {
  pattern: string;
  reason: string;
  importance: number;
  sourceRefs: CompletenessSourceRef[];
  matchedGuidanceIds: string[];
  coverageStatus: 'uncovered';
}

export interface SortedCompletenessMiningGuidance {
  id: string;
  title: string;
  description?: string;
  importance: number;
  keywords: string[];
  sourceRefs: CompletenessSourceRef[];
  coverageStatus: CompletenessCriticCoverageStatus;
}

export interface CompletenessCriticResult {
  dimensionId: string;
  status: CompletenessCriticStatus;
  shouldBlockCompletion: false;
  targetGate: 'advisory';
  submittedRecipeCount: number;
  floorPerDimension: number;
  targetPerDimension: number;
  neededToTarget: number;
  floorStatus: 'below-floor' | 'at-or-above-floor';
  hints: CompletenessCriticHint[];
  sortedMiningGuidance: SortedCompletenessMiningGuidance[];
  exhaustedReason?: string;
  notes: string[];
}

interface ProjectCandidate {
  pattern: string;
  reason: string;
  text: string;
  importance: number;
  sourceRefs: CompletenessSourceRef[];
  dimensionIds: readonly string[];
  tags: readonly string[];
}

interface NormalizedGuidance {
  id: string;
  title: string;
  description?: string;
  importance: number;
  keywords: string[];
  sourceRefs: CompletenessSourceRef[];
  dimensionIds: readonly string[];
  originalIndex: number;
}

interface ScoredCandidate extends ProjectCandidate {
  score: number;
  matchedGuidance: NormalizedGuidance[];
  covered: boolean;
}

export function buildCompletenessCritic(input: CompletenessCriticInput): CompletenessCriticResult {
  const dimensionId = normalizeDimensionId(input.dimensionId);
  const targetPerDimension = normalizePositiveInt(
    input.targetPerDimension,
    DEFAULT_TARGET_PER_DIMENSION
  );
  const floorPerDimension = normalizePositiveInt(
    input.floorPerDimension,
    DEFAULT_FLOOR_PER_DIMENSION
  );
  const maxHints = normalizePositiveInt(input.maxHints, DEFAULT_MAX_HINTS);
  const submittedRecipeCount =
    typeof input.submittedRecipeCount === 'number'
      ? Math.max(0, Math.floor(input.submittedRecipeCount))
      : (input.submittedRecipes ?? []).length;
  const neededToTarget = Math.max(0, targetPerDimension - submittedRecipeCount);
  const floorStatus =
    submittedRecipeCount >= floorPerDimension ? 'at-or-above-floor' : 'below-floor';

  const guidance = normalizeGuidance(input.miningGuidance ?? [], dimensionId);
  const coveredPaths = collectCoveredPaths(input);
  const candidates = collectProjectCandidates(input, dimensionId);
  const scored = scoreCandidates({ candidates, guidance, coveredPaths, dimensionId });
  const hints = scored
    .filter((candidate) => !candidate.covered)
    .slice(0, maxHints)
    .map(toHint);
  const sortedMiningGuidance = guidance.map((item) => ({
    id: item.id,
    title: item.title,
    ...(item.description ? { description: item.description } : {}),
    importance: item.importance,
    keywords: item.keywords,
    sourceRefs: item.sourceRefs,
    coverageStatus: guidanceCoverageStatus(item, coveredPaths, scored),
  }));

  const status = resolveStatus({
    hints,
    submittedRecipeCount,
    targetPerDimension,
    noPadding: Boolean(input.noPadding),
    exhaustedReason: input.exhaustedReason,
  });
  const notes = buildNotes({
    candidates,
    hints,
    status,
    neededToTarget,
    noPadding: Boolean(input.noPadding),
  });

  return {
    dimensionId,
    status,
    shouldBlockCompletion: false,
    targetGate: 'advisory',
    submittedRecipeCount,
    floorPerDimension,
    targetPerDimension,
    neededToTarget,
    floorStatus,
    hints,
    sortedMiningGuidance,
    ...(status === 'exhausted' && input.exhaustedReason
      ? { exhaustedReason: input.exhaustedReason }
      : {}),
    notes,
  };
}

function normalizeDimensionId(dimensionId: string): string {
  return dimensionId.trim() || 'unknown';
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeGuidance(
  items: readonly CompletenessMiningGuidance[],
  dimensionId: string
): NormalizedGuidance[] {
  return items
    .map((item, index) => {
      const sourceRefs = normalizeSourceRefs(item.sourceRefs ?? []);
      const keywords = sortUnique([
        ...(item.keywords ?? []),
        ...tokenize(`${item.title} ${item.description ?? ''}`),
      ]);
      return {
        id: item.id ?? stableId('guidance', item.title, index),
        title: item.title,
        ...(item.description ? { description: item.description } : {}),
        importance: normalizeImportance(item.importance, 100 - index),
        keywords,
        sourceRefs,
        dimensionIds: item.dimensionIds ?? [],
        originalIndex: index,
      };
    })
    .filter((item) => appliesToDimension(item.dimensionIds, [], dimensionId))
    .sort(sortGuidance);
}

function collectCoveredPaths(input: CompletenessCriticInput): string[] {
  const refs = [
    ...normalizeSourceRefs(input.submittedSourceRefs ?? []),
    ...normalizeSourceRefs(
      (input.submittedRecipes ?? []).flatMap((recipe) => [
        ...(recipe.sourceRefs ?? []),
        ...(recipe.reasoning?.sources ?? []),
      ])
    ),
  ];
  return sortUnique(refs.flatMap(comparablePaths));
}

function collectProjectCandidates(
  input: CompletenessCriticInput,
  dimensionId: string
): ProjectCandidate[] {
  const facts = [...(input.projectFacts ?? []), ...(input.projectInfoTree?.facts ?? [])].flatMap(
    (fact) => factCandidate(fact, dimensionId)
  );
  const files = (input.projectInfoTree?.files ?? []).flatMap((file) =>
    fileCandidate(file, dimensionId)
  );
  const symbols = (input.projectInfoTree?.symbols ?? []).flatMap((symbol) =>
    symbolCandidate(symbol, dimensionId)
  );
  const areas = [
    ...(input.projectInfoTree?.modules ?? []),
    ...(input.projectInfoTree?.areas ?? []),
  ].flatMap((area) => areaCandidate(area, dimensionId));
  const guidanceRefs = (input.miningGuidance ?? []).flatMap((guidance, index) =>
    guidanceCandidate(guidance, index, dimensionId)
  );

  return dedupeCandidates([...facts, ...files, ...symbols, ...areas, ...guidanceRefs]);
}

function factCandidate(fact: CompletenessProjectFact, dimensionId: string): ProjectCandidate[] {
  if (!appliesToDimension(fact.dimensionIds ?? [], fact.tags ?? [], dimensionId)) {
    return [];
  }
  const sourceRefs = normalizeSourceRefs(fact.sourceRefs ?? []);
  if (sourceRefs.length === 0) {
    return [];
  }
  const pattern = fact.title ?? fact.label ?? fact.id ?? 'Project fact';
  return [
    {
      pattern,
      reason: fact.description ?? `Project fact: ${pattern}`,
      text: `${pattern} ${fact.description ?? ''}`,
      importance: normalizeImportance(fact.importance, 70),
      sourceRefs,
      dimensionIds: fact.dimensionIds ?? [],
      tags: fact.tags ?? [],
    },
  ];
}

function fileCandidate(file: CompletenessProjectFile, dimensionId: string): ProjectCandidate[] {
  if (!appliesToDimension(file.dimensionIds ?? [], file.tags ?? [], dimensionId)) {
    return [];
  }
  const sourceRefs = normalizeSourceRefs([
    file.qualifiedPath ?? file.relativePath ?? file.path ?? '',
  ]);
  if (sourceRefs.length === 0) {
    return [];
  }
  const path = sourceRefs[0]?.path ?? file.path ?? file.relativePath ?? 'file';
  const name = file.name ?? path.split('/').pop() ?? path;
  const priorityBoost = file.priority === 'high' ? 15 : 0;
  return [
    {
      pattern: name,
      reason: file.summary ?? `High-value source file: ${path}`,
      text: `${name} ${path} ${file.summary ?? ''}`,
      importance: normalizeImportance(file.importance, 55 + priorityBoost),
      sourceRefs,
      dimensionIds: file.dimensionIds ?? [],
      tags: file.tags ?? [],
    },
  ];
}

function symbolCandidate(
  symbol: CompletenessProjectSymbol,
  dimensionId: string
): ProjectCandidate[] {
  if (!appliesToDimension(symbol.dimensionIds ?? [], symbol.tags ?? [], dimensionId)) {
    return [];
  }
  const path = symbol.qualifiedPath ?? symbol.relativePath ?? symbol.file ?? symbol.path ?? '';
  const sourceRefs = normalizeSourceRefs([
    {
      path,
      symbol: symbol.name,
      qualifiedPath: symbol.qualifiedPath,
      kind: symbol.kind,
    },
  ]);
  if (sourceRefs.length === 0) {
    return [];
  }
  return [
    {
      pattern: symbol.name,
      reason: symbol.summary ?? `Project symbol: ${symbol.name}`,
      text: `${symbol.name} ${symbol.kind ?? ''} ${path} ${symbol.summary ?? ''}`,
      importance: normalizeImportance(symbol.importance, 65),
      sourceRefs,
      dimensionIds: symbol.dimensionIds ?? [],
      tags: symbol.tags ?? [],
    },
  ];
}

function areaCandidate(area: CompletenessProjectArea, dimensionId: string): ProjectCandidate[] {
  if (!appliesToDimension(area.dimensionIds ?? [], area.tags ?? [], dimensionId)) {
    return [];
  }
  const sourceRefs = normalizeSourceRefs([...(area.sourceRefs ?? []), ...(area.keyFiles ?? [])]);
  if (sourceRefs.length === 0) {
    return [];
  }
  return [
    {
      pattern: area.name,
      reason: area.description ?? `Project area: ${area.name}`,
      text: `${area.name} ${area.description ?? ''}`,
      importance: normalizeImportance(area.importance, 60),
      sourceRefs,
      dimensionIds: area.dimensionIds ?? [],
      tags: area.tags ?? [],
    },
  ];
}

function guidanceCandidate(
  guidance: CompletenessMiningGuidance,
  index: number,
  dimensionId: string
): ProjectCandidate[] {
  if (!appliesToDimension(guidance.dimensionIds ?? [], [], dimensionId)) {
    return [];
  }
  const sourceRefs = normalizeSourceRefs(guidance.sourceRefs ?? []);
  if (sourceRefs.length === 0) {
    return [];
  }
  return [
    {
      pattern: guidance.title,
      reason: guidance.description ?? `Mining guidance: ${guidance.title}`,
      text: `${guidance.title} ${guidance.description ?? ''} ${(guidance.keywords ?? []).join(' ')}`,
      importance: normalizeImportance(guidance.importance, 100 - index),
      sourceRefs,
      dimensionIds: guidance.dimensionIds ?? [],
      tags: [],
    },
  ];
}

function scoreCandidates({
  candidates,
  guidance,
  coveredPaths,
  dimensionId,
}: {
  candidates: readonly ProjectCandidate[];
  guidance: readonly NormalizedGuidance[];
  coveredPaths: readonly string[];
  dimensionId: string;
}): ScoredCandidate[] {
  const guidanceHasSignals = guidance.some(
    (item) => item.keywords.length > 0 || item.sourceRefs.length > 0
  );

  return candidates
    .map((candidate) => {
      const matchedGuidance = guidance.filter((item) => guidanceMatchesCandidate(item, candidate));
      return {
        ...candidate,
        matchedGuidance,
        covered: candidate.sourceRefs.some((ref) => pathIsCovered(ref, coveredPaths)),
        score:
          candidate.importance +
          matchedGuidance.reduce((sum, item) => sum + item.importance, 0) +
          (appliesToDimension(candidate.dimensionIds, candidate.tags, dimensionId) ? 10 : 0),
      };
    })
    .filter((candidate) => !guidanceHasSignals || candidate.matchedGuidance.length > 0)
    .sort(sortCandidates);
}

function guidanceMatchesCandidate(
  guidance: NormalizedGuidance,
  candidate: ProjectCandidate
): boolean {
  if (
    guidance.sourceRefs.some((ref) =>
      candidate.sourceRefs.some((source) => refsOverlap(ref, source))
    )
  ) {
    return true;
  }
  const candidateTokens = new Set(tokenize(candidate.text));
  return guidance.keywords.some((keyword) => candidateTokens.has(keyword));
}

function pathIsCovered(ref: CompletenessSourceRef, coveredPaths: readonly string[]): boolean {
  return comparablePaths(ref).some((candidate) =>
    coveredPaths.some((covered) => pathsOverlap(candidate, covered))
  );
}

function guidanceCoverageStatus(
  guidance: NormalizedGuidance,
  coveredPaths: readonly string[],
  scoredCandidates: readonly ScoredCandidate[]
): CompletenessCriticCoverageStatus {
  const matchedCandidates = scoredCandidates.filter((candidate) =>
    candidate.matchedGuidance.some((item) => item.id === guidance.id)
  );
  if (matchedCandidates.length > 0) {
    return matchedCandidates.every((candidate) => candidate.covered) ? 'covered' : 'uncovered';
  }
  if (guidance.sourceRefs.length === 0) {
    return 'ungrounded';
  }

  return guidance.sourceRefs.every((ref) => pathIsCovered(ref, coveredPaths))
    ? 'covered'
    : 'uncovered';
}

function toHint(candidate: ScoredCandidate): CompletenessCriticHint {
  return {
    pattern: candidate.pattern,
    reason: candidate.reason,
    importance: candidate.score,
    sourceRefs: candidate.sourceRefs,
    matchedGuidanceIds: candidate.matchedGuidance.map((item) => item.id),
    coverageStatus: 'uncovered',
  };
}

function resolveStatus({
  hints,
  submittedRecipeCount,
  targetPerDimension,
  noPadding,
  exhaustedReason,
}: {
  hints: readonly CompletenessCriticHint[];
  submittedRecipeCount: number;
  targetPerDimension: number;
  noPadding: boolean;
  exhaustedReason?: string;
}): CompletenessCriticStatus {
  if (hints.length > 0) {
    return 'has-grounded-hints';
  }
  if (submittedRecipeCount >= targetPerDimension) {
    return 'satisfied';
  }
  if (noPadding && exhaustedReason?.trim()) {
    return 'exhausted';
  }
  return 'insufficient-grounded-evidence';
}

function buildNotes({
  candidates,
  hints,
  status,
  neededToTarget,
  noPadding,
}: {
  candidates: readonly ProjectCandidate[];
  hints: readonly CompletenessCriticHint[];
  status: CompletenessCriticStatus;
  neededToTarget: number;
  noPadding: boolean;
}): string[] {
  const notes = ['targetPerDimension is advisory; this critic never blocks dimension completion.'];
  if (neededToTarget > 0 && hints.length > 0) {
    notes.push(`Grounded hints can help produce up to ${neededToTarget} more Recipe(s).`);
  }
  if (status === 'insufficient-grounded-evidence') {
    notes.push('No uncovered pattern is emitted because supplied project facts lacked grounding.');
  }
  if (status === 'exhausted' || noPadding) {
    notes.push('noPadding honored: do not invent Recipes when real project evidence is exhausted.');
  }
  if (candidates.length === 0) {
    notes.push('No projectInfoTree/source evidence candidates were supplied.');
  }
  return notes;
}

function normalizeSourceRefs(refs: readonly CompletenessSourceRefInput[]): CompletenessSourceRef[] {
  return refs.flatMap((ref) => {
    const normalized = normalizeSourceRef(ref);
    return normalized ? [normalized] : [];
  });
}

function normalizeSourceRef(ref: CompletenessSourceRefInput): CompletenessSourceRef | null {
  if (typeof ref === 'string') {
    const parsed = parseSourcePath(ref);
    return parsed ? { path: parsed.path, ...(parsed.line ? { line: parsed.line } : {}) } : null;
  }
  const path = ref.path || ref.relativePath || ref.qualifiedPath || '';
  const parsed = parseSourcePath(path);
  if (!parsed) {
    return null;
  }
  return {
    path: parsed.path,
    ...(typeof ref.line === 'number'
      ? { line: ref.line }
      : parsed.line
        ? { line: parsed.line }
        : {}),
    ...(ref.symbol ? { symbol: ref.symbol } : {}),
    ...(ref.qualifiedPath ? { qualifiedPath: normalizePath(ref.qualifiedPath) } : {}),
    ...(ref.relativePath ? { relativePath: normalizePath(ref.relativePath) } : {}),
    ...(ref.kind ? { kind: ref.kind } : {}),
    ...(ref.reason ? { reason: ref.reason } : {}),
  };
}

function parseSourcePath(pathValue: string): { path: string; line?: number } | null {
  const trimmed = pathValue.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/^(.*?):(\d+)(?::\d+)?$/);
  if (match?.[1] && match[2]) {
    return { path: normalizePath(match[1]), line: Number(match[2]) };
  }
  return { path: normalizePath(trimmed) };
}

function comparablePaths(ref: CompletenessSourceRef): string[] {
  return sortUnique([ref.path, ref.relativePath, ref.qualifiedPath].filter(isNonEmptyString));
}

function refsOverlap(left: CompletenessSourceRef, right: CompletenessSourceRef): boolean {
  return comparablePaths(left).some((leftPath) =>
    comparablePaths(right).some((rightPath) => pathsOverlap(leftPath, rightPath))
  );
}

function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function appliesToDimension(
  dimensionIds: readonly string[],
  tags: readonly string[],
  dimensionId: string
): boolean {
  if (dimensionIds.length === 0 && tags.length === 0) {
    return true;
  }
  const target = dimensionId.toLowerCase();
  return [...dimensionIds, ...tags].some((value) => value.toLowerCase() === target);
}

function normalizeImportance(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, value));
}

function tokenize(value: string): string[] {
  return sortUnique(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((token) => token.length >= 3)
  );
}

function sortGuidance(left: NormalizedGuidance, right: NormalizedGuidance): number {
  return right.importance - left.importance || left.originalIndex - right.originalIndex;
}

function sortCandidates(left: ScoredCandidate, right: ScoredCandidate): number {
  return (
    right.score - left.score ||
    left.pattern.localeCompare(right.pattern) ||
    (left.sourceRefs[0]?.path ?? '').localeCompare(right.sourceRefs[0]?.path ?? '')
  );
}

function dedupeCandidates(candidates: readonly ProjectCandidate[]): ProjectCandidate[] {
  const seen = new Set<string>();
  const result: ProjectCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.pattern}|${candidate.sourceRefs.map((ref) => ref.path).join('|')}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function sortUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter(isNonEmptyString))].sort();
}

function stableId(prefix: string, value: string, index: number): string {
  return `${prefix}-${index + 1}-${tokenize(value).slice(0, 3).join('-') || 'item'}`;
}

function isNonEmptyString(value: string | undefined): value is string {
  return Boolean(value?.trim());
}
