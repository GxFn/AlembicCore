import fs from 'node:fs/promises';
import path from 'node:path';
import Logger from '../../../../infrastructure/logging/Logger.js';

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MAX_FILE_CACHE = 200;
const MAX_SEARCH_CACHE = 100;

const NON_CACHEABLE = new Set([
  'knowledge',
  'memory',
  'note_finding',
  'get_previous_analysis',
  'get_previous_evidence',
]);

export interface Finding {
  finding: string;
  evidence?: string;
  importance: number;
  dimId?: string;
  timestamp?: number;
}

export interface CandidateSummary {
  dimId: string;
  title: string;
  subTopic: string;
  summary: string;
}

export interface CrossReference {
  from: string;
  to: string;
  relation: string;
  detail: string;
}

export interface TierReflection {
  tierIndex: number;
  completedDimensions: string[];
  topFindings: Finding[];
  crossDimensionPatterns: string[];
  suggestionsForNextTier: string[];
}

export interface WorkingMemoryDistilled {
  keyFindings?: Finding[];
  toolCallSummary?: Array<string | { tool: string; summary: string }>;
  stats?: Record<string, number>;
  plan?: Record<string, unknown> | null;
  totalObservations?: number;
  compressedCount?: number;
}

export interface DimensionDigest {
  summary?: string;
  candidateCount?: number;
  keyFindings?: Array<string | Finding>;
  crossRefs?: Record<string, string>;
  gaps?: string[];
  [key: string]: unknown;
}

export interface DimensionReport {
  dimId: string;
  completedAt: number;
  analysisText: string;
  findings: Finding[];
  referencedFiles: string[];
  candidatesSummary: CandidateSummary[];
  workingMemoryDistilled: WorkingMemoryDistilled | null;
  digest: DimensionDigest | null;
}

export interface DimensionReportInput {
  analysisText?: string;
  findings?: Array<{
    finding?: string;
    evidence?: string | string[] | unknown;
    importance?: number;
  }>;
  referencedFiles?: string[];
  candidatesSummary?: CandidateSummary[];
  workingMemoryDistilled?: WorkingMemoryDistilled | null;
  digest?: DimensionDigest | null;
}

export interface MiningSessionStoreConfig {
  projectContext?: Record<string, unknown>;
  ttlMs?: number;
  projectName?: string;
  primaryLang?: string;
  fileCount?: number;
  modules?: string[] | number;
  [key: string]: unknown;
}

interface ToolArgs {
  action?: string;
  pattern?: string;
  filePath?: string;
  [key: string]: unknown;
}

interface SearchCacheEntry {
  result: unknown;
  cachedAt: number;
  hitCount: number;
}

interface FileCacheEntry {
  content: string;
  cachedAt: number;
  hitCount: number;
}

export interface MiningSessionStoreSerialized {
  dimensionReports: Record<string, DimensionReport>;
  crossReferences: CrossReference[];
  tierReflections: TierReflection[];
  submittedCandidates: Record<string, CandidateSummary[]>;
  projectContext: Record<string, unknown>;
}

/**
 * Core 版 SessionStore。
 *
 * 它保留 host-agent 挖掘链路需要的维度报告、证据、跨维度上下文、
 * 候选摘要、checkpoint 和只读缓存语义；不依赖 Alembic internal agent、
 * MemoryCoordinator、TimerRegistry 或工具执行器。
 */
export class MiningSessionStore {
  #dimensionReports = new Map<string, DimensionReport>();
  #evidenceStore = new Map<string, Finding[]>();
  #crossReferences: CrossReference[] = [];
  #tierReflections: TierReflection[] = [];
  #submittedCandidates = new Map<string, CandidateSummary[]>();
  #projectContext: Record<string, unknown>;
  #searchCache = new Map<string, SearchCacheEntry>();
  #fileCache = new Map<string, FileCacheEntry>();
  #cacheStats = { hits: 0, misses: 0, evictions: 0 };
  #ttlMs: number;
  #logger = Logger.getInstance();

  constructor(config: MiningSessionStoreConfig = {}) {
    this.#projectContext = normalizeMiningProjectContext(config);
    this.#ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
  }

  storeDimensionReport(dimId: string, report: DimensionReportInput): void {
    const findings: Finding[] = (report.findings || []).map((finding) => ({
      finding: finding.finding || '',
      evidence: normalizeEvidence(finding.evidence),
      importance: finding.importance || 5,
    }));

    this.#dimensionReports.set(dimId, {
      dimId,
      completedAt: Date.now(),
      analysisText: report.analysisText || '',
      findings,
      referencedFiles: report.referencedFiles || [],
      candidatesSummary: report.candidatesSummary || [],
      workingMemoryDistilled: report.workingMemoryDistilled || null,
      digest: report.digest || null,
    });

    for (const finding of findings) {
      if (!finding.evidence) {
        continue;
      }
      const filePath = finding.evidence.split(':')[0] || finding.evidence;
      this.addEvidence(filePath, {
        dimId,
        finding: finding.finding,
        importance: finding.importance,
      });
    }

    this.#addCrossReferencesFromDigest(dimId, report.digest || null);
    this.#logger.info(
      `[MiningSessionStore] Stored report for "${dimId}": ${findings.length} findings, ${report.referencedFiles?.length || 0} files`
    );
  }

  getDimensionReport(dimId: string): DimensionReport | undefined {
    return this.#dimensionReports.get(dimId);
  }

  getCompletedDimensions(): string[] {
    return [...this.#dimensionReports.keys()];
  }

  addEvidence(filePath: string, evidence: Omit<Finding, 'timestamp'>): void {
    if (!this.#evidenceStore.has(filePath)) {
      this.#evidenceStore.set(filePath, []);
    }
    this.#evidenceStore.get(filePath)?.push({ ...evidence, timestamp: Date.now() });
  }

  getEvidenceForFile(filePath: string): Finding[] {
    return this.#evidenceStore.get(filePath) || [];
  }

  searchEvidence(query: string, dimId?: string): Array<{ filePath: string; evidence: Finding }> {
    const results: Array<{ filePath: string; evidence: Finding }> = [];
    const lowerQuery = query.toLowerCase();
    for (const [filePath, evidences] of this.#evidenceStore) {
      for (const evidence of evidences) {
        if (dimId && evidence.dimId !== dimId) {
          continue;
        }
        if (
          filePath.toLowerCase().includes(lowerQuery) ||
          (evidence.finding || '').toLowerCase().includes(lowerQuery)
        ) {
          results.push({ filePath, evidence });
        }
      }
    }
    return results.sort(
      (left, right) => (right.evidence.importance || 5) - (left.evidence.importance || 5)
    );
  }

  addSubmittedCandidate(dimId: string, candidate: Omit<CandidateSummary, 'dimId'>): void {
    if (!this.#submittedCandidates.has(dimId)) {
      this.#submittedCandidates.set(dimId, []);
    }
    this.#submittedCandidates.get(dimId)?.push({ dimId, ...candidate });
  }

  addDimensionDigest(dimId: string, digest: DimensionDigest): void {
    const existing = this.#dimensionReports.get(dimId);
    if (existing) {
      existing.digest = digest;
    } else {
      this.#dimensionReports.set(dimId, {
        dimId,
        completedAt: Date.now(),
        analysisText: digest.summary || '',
        findings: (digest.keyFindings || []).map((finding) => ({
          finding: typeof finding === 'string' ? finding : finding.finding || '',
          evidence: typeof finding === 'string' ? '' : finding.evidence || '',
          importance: typeof finding === 'string' ? 5 : finding.importance || 5,
        })),
        referencedFiles: [],
        candidatesSummary: [],
        workingMemoryDistilled: null,
        digest,
      });
    }
    this.#addCrossReferencesFromDigest(dimId, digest);
  }

  addTierReflection(tierIndex: number, reflection: TierReflection): void {
    this.#tierReflections.push(reflection);
    this.#logger.info(
      `[MiningSessionStore] Tier ${tierIndex + 1} reflection: ${reflection.topFindings?.length || 0} findings`
    );
  }

  getTierReflections(): TierReflection[] {
    return [...this.#tierReflections];
  }

  getRelevantReflections(_currentDimId: string): string | null {
    if (this.#tierReflections.length === 0) {
      return null;
    }
    const parts: string[] = [];
    for (const reflection of this.#tierReflections) {
      parts.push(`### Tier ${reflection.tierIndex + 1} 综合洞察`);
      for (const finding of reflection.topFindings.slice(0, 5)) {
        parts.push(`- [${finding.importance || 5}/10] ${finding.finding}`);
      }
      for (const pattern of reflection.crossDimensionPatterns) {
        parts.push(`- ${pattern}`);
      }
      for (const suggestion of reflection.suggestionsForNextTier) {
        parts.push(`- ${suggestion}`);
      }
    }
    return parts.join('\n');
  }

  buildContextForDimension(
    currentDimId: string,
    focusKeywordsOrOpts: string[] | { focusKeywords?: string[]; tokenBudget?: number } = []
  ): string {
    const { focusKeywords, tokenBudget } = normalizeContextOptions(focusKeywordsOrOpts);
    const parts: string[] = [];
    const completedDims = [...this.#dimensionReports.entries()].filter(
      ([id]) => id !== currentDimId
    );

    if (completedDims.length === 0 && this.#tierReflections.length === 0) {
      return '';
    }

    parts.push('## 前序维度分析成果（避免重复探索）');
    for (const [dimId, report] of completedDims) {
      parts.push(`### ${dimId}`);
      parts.push(report.digest?.summary || `${report.analysisText.substring(0, 300)}...`);
      const findings = this.#selectRelevantFindings(report.findings, focusKeywords, 5);
      if (findings.length > 0) {
        parts.push('**具体发现**:');
        for (const finding of findings) {
          parts.push(
            `- [${finding.importance}/10] ${finding.finding}${finding.evidence ? ` _(${finding.evidence})_` : ''}`
          );
        }
      }
      const candidates = this.#submittedCandidates.get(dimId) || [];
      if (candidates.length > 0) {
        parts.push(
          `已提交 ${candidates.length} 个候选: ${candidates.map((candidate) => candidate.title).join(', ')}`
        );
      }
    }

    const allReadFiles = this.getAllReferencedFiles();
    if (allReadFiles.size > 0) {
      parts.push(`### 前序维度已扫描的文件 (${allReadFiles.size} 个)`);
      parts.push([...allReadFiles].slice(0, 30).join(', '));
    }

    const crossRefs = this.#crossReferences.filter((crossRef) => crossRef.to === currentDimId);
    if (crossRefs.length > 0) {
      parts.push(`### 其他维度对 ${currentDimId} 的建议`);
      for (const crossRef of crossRefs) {
        parts.push(`- [来自 ${crossRef.from}] ${crossRef.detail}`);
      }
    }

    const reflections = this.getRelevantReflections(currentDimId);
    if (reflections) {
      parts.push(reflections);
    }

    const result = parts.join('\n');
    return tokenBudget && Math.ceil(result.length / 4) > tokenBudget
      ? `${result.substring(0, tokenBudget * 4)}\n...(truncated due to budget)`
      : result;
  }

  buildContextSnapshot(currentDimId: string): {
    previousDimensions: Record<string, DimensionDigest>;
    submittedCandidates: CandidateSummary[];
  } {
    const previousDimensions: Record<string, DimensionDigest> = {};
    for (const [dimId, report] of this.#dimensionReports) {
      if (dimId === currentDimId) {
        continue;
      }
      previousDimensions[dimId] = report.digest || {
        summary: report.analysisText.substring(0, 300),
        candidateCount: report.candidatesSummary.length,
        keyFindings: report.findings.map((finding) => finding.finding),
        crossRefs: {},
        gaps: [],
      };
    }
    return {
      previousDimensions,
      submittedCandidates: [...this.#submittedCandidates.values()].flat(),
    };
  }

  getDistilledForProducer(dimId: string): {
    keyFindings: Finding[];
    toolCallSummary: Array<string | { tool: string; summary: string }>;
    referencedFiles: string[];
  } | null {
    const report = this.#dimensionReports.get(dimId);
    if (!report) {
      return null;
    }
    return {
      keyFindings: report.workingMemoryDistilled?.keyFindings || [],
      toolCallSummary: report.workingMemoryDistilled?.toolCallSummary || [],
      referencedFiles: report.referencedFiles,
    };
  }

  getCachedResult(toolName: string, args: ToolArgs): unknown | null {
    if (NON_CACHEABLE.has(toolName)) {
      return null;
    }
    if (toolName === 'code' && args.action === 'search' && args.pattern) {
      return this.#readCache(this.#searchCache, args.pattern);
    }
    if (toolName === 'code' && args.action === 'read' && args.filePath) {
      const content = this.#readCache(this.#fileCache, args.filePath);
      return typeof content === 'string' ? { content, path: args.filePath, cached: true } : content;
    }
    this.#cacheStats.misses++;
    return null;
  }

  cacheToolResult(toolName: string, args: ToolArgs, result: unknown): void {
    if (NON_CACHEABLE.has(toolName)) {
      return;
    }
    if (toolName === 'code' && args.action === 'search' && args.pattern) {
      this.#writeCache(this.#searchCache, args.pattern, result, MAX_SEARCH_CACHE);
    }
    if (toolName === 'code' && args.action === 'read' && args.filePath) {
      const content =
        typeof result === 'object' && result !== null && 'content' in result
          ? (result as { content?: unknown }).content
          : result;
      if (content !== undefined) {
        this.#writeCache(this.#fileCache, args.filePath, String(content), MAX_FILE_CACHE);
      }
    }
  }

  get(toolName: string, args: ToolArgs): unknown | null {
    return this.getCachedResult(toolName, args);
  }

  set(toolName: string, args: ToolArgs, result: unknown): void {
    this.cacheToolResult(toolName, args, result);
  }

  async saveCheckpoint(projectRoot: string): Promise<void> {
    const checkpointDir = path.join(projectRoot, '.asd', 'bootstrap-checkpoint');
    await fs.mkdir(checkpointDir, { recursive: true });
    await fs.writeFile(
      path.join(checkpointDir, 'session-store.json'),
      JSON.stringify({ version: 2, savedAt: Date.now(), ...this.toJSON() }, null, 2),
      'utf8'
    );
  }

  async loadCheckpoint(projectRoot: string, ttlMs = 24 * 3600_000): Promise<boolean> {
    const checkpointPath = path.join(
      projectRoot,
      '.asd',
      'bootstrap-checkpoint',
      'session-store.json'
    );
    try {
      const data = JSON.parse(await fs.readFile(checkpointPath, 'utf8')) as Record<string, unknown>;
      if (typeof data.savedAt === 'number' && Date.now() - data.savedAt > ttlMs) {
        return false;
      }
      const restored = MiningSessionStore.fromJSON(data);
      this.#dimensionReports = restored.#dimensionReports;
      this.#crossReferences = restored.#crossReferences;
      this.#tierReflections = restored.#tierReflections;
      this.#submittedCandidates = restored.#submittedCandidates;
      return true;
    } catch {
      return false;
    }
  }

  toJSON(projectContextOverride?: MiningSessionStoreConfig): MiningSessionStoreSerialized {
    return {
      dimensionReports: Object.fromEntries(this.#dimensionReports),
      crossReferences: this.#crossReferences,
      tierReflections: this.#tierReflections,
      submittedCandidates: Object.fromEntries(this.#submittedCandidates),
      projectContext: projectContextOverride
        ? normalizeMiningProjectContext(projectContextOverride)
        : structuredClone(this.#projectContext),
    };
  }

  static fromJSON(json: Record<string, unknown>): MiningSessionStore {
    const store = new MiningSessionStore({
      projectContext: isRecord(json.projectContext) ? json.projectContext : {},
    });
    if (isRecord(json.dimensionReports)) {
      for (const [dimId, report] of Object.entries(json.dimensionReports)) {
        store.#dimensionReports.set(dimId, report as DimensionReport);
      }
    }
    store.#crossReferences = Array.isArray(json.crossReferences)
      ? (json.crossReferences as CrossReference[])
      : [];
    store.#tierReflections = Array.isArray(json.tierReflections)
      ? (json.tierReflections as TierReflection[])
      : [];
    if (isRecord(json.submittedCandidates)) {
      for (const [dimId, candidates] of Object.entries(json.submittedCandidates)) {
        store.#submittedCandidates.set(
          dimId,
          Array.isArray(candidates) ? (candidates as CandidateSummary[]) : []
        );
      }
    }
    return store;
  }

  getAllReferencedFiles(): Set<string> {
    const files = new Set<string>();
    for (const report of this.#dimensionReports.values()) {
      for (const file of report.referencedFiles) {
        files.add(file);
      }
    }
    return files;
  }

  getStats(): Record<string, unknown> {
    const totalFindings = [...this.#dimensionReports.values()].reduce(
      (sum, report) => sum + report.findings.length,
      0
    );
    const totalEvidence = [...this.#evidenceStore.values()].reduce(
      (sum, evidence) => sum + evidence.length,
      0
    );
    const totalCandidates = [...this.#submittedCandidates.values()].reduce(
      (sum, candidates) => sum + candidates.length,
      0
    );
    const hits = this.#cacheStats.hits;
    const misses = this.#cacheStats.misses;
    return {
      completedDimensions: this.#dimensionReports.size,
      totalFindings,
      totalEvidence,
      totalCandidates,
      crossReferences: this.#crossReferences.length,
      tierReflections: this.#tierReflections.length,
      referencedFiles: this.getAllReferencedFiles().size,
      cache: {
        ...this.#cacheStats,
        hitRate: hits + misses > 0 ? `${((hits / (hits + misses)) * 100).toFixed(1)}%` : '0%',
        searchCacheSize: this.#searchCache.size,
        fileCacheSize: this.#fileCache.size,
      },
    };
  }

  clearCache(): void {
    this.#searchCache.clear();
    this.#fileCache.clear();
    this.#cacheStats = { hits: 0, misses: 0, evictions: 0 };
  }

  dispose(): void {
    this.clearCache();
    this.#dimensionReports.clear();
    this.#evidenceStore.clear();
    this.#crossReferences = [];
    this.#tierReflections = [];
    this.#submittedCandidates.clear();
  }

  #addCrossReferencesFromDigest(dimId: string, digest: DimensionDigest | null): void {
    if (!digest?.crossRefs) {
      return;
    }
    for (const [targetDim, detail] of Object.entries(digest.crossRefs)) {
      if (!detail) {
        continue;
      }
      const exists = this.#crossReferences.some(
        (crossReference) => crossReference.from === dimId && crossReference.to === targetDim
      );
      if (!exists) {
        this.#crossReferences.push({
          from: dimId,
          to: targetDim,
          relation: 'suggests',
          detail: String(detail),
        });
      }
    }
  }

  #selectRelevantFindings(
    findings: Finding[] | undefined,
    focusKeywords: string[],
    limit: number
  ): Finding[] {
    if (!findings || findings.length === 0) {
      return [];
    }
    if (focusKeywords.length === 0) {
      return [...findings]
        .sort((left, right) => right.importance - left.importance)
        .slice(0, limit);
    }
    return [...findings]
      .map((finding) => ({
        ...finding,
        _score:
          (focusKeywords.some((keyword) =>
            finding.finding.toLowerCase().includes(keyword.toLowerCase())
          )
            ? 10
            : 0) + finding.importance,
      }))
      .sort((left, right) => right._score - left._score)
      .slice(0, limit)
      .map(({ _score, ...finding }) => finding);
  }

  #readCache<T>(
    cache: Map<string, { result?: T; content?: T; cachedAt: number; hitCount: number }>,
    key: string
  ): T | null {
    const entry = cache.get(key);
    if (!entry) {
      this.#cacheStats.misses++;
      return null;
    }
    if (this.#ttlMs > 0 && Date.now() - entry.cachedAt > this.#ttlMs) {
      cache.delete(key);
      this.#cacheStats.evictions++;
      this.#cacheStats.misses++;
      return null;
    }
    entry.hitCount++;
    this.#cacheStats.hits++;
    return (entry.result ?? entry.content ?? null) as T | null;
  }

  #writeCache<T>(
    cache: Map<string, { result?: T; content?: T; cachedAt: number; hitCount: number }>,
    key: string,
    value: T,
    maxSize: number
  ): void {
    if (cache.size >= maxSize) {
      const oldestKey = cache.keys().next().value as string | undefined;
      if (oldestKey) {
        cache.delete(oldestKey);
        this.#cacheStats.evictions++;
      }
    }
    cache.set(key, { result: value, cachedAt: Date.now(), hitCount: 0 });
  }
}

function normalizeMiningProjectContext(config: MiningSessionStoreConfig): Record<string, unknown> {
  return structuredClone({
    ...(config.projectContext || {}),
    ...(config.projectName ? { projectName: config.projectName } : {}),
    ...(config.primaryLang ? { primaryLang: config.primaryLang } : {}),
    ...(typeof config.fileCount === 'number' ? { fileCount: config.fileCount } : {}),
    ...(config.modules !== undefined ? { modules: config.modules } : {}),
  });
}

function normalizeEvidence(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return value ? String(value) : '';
}

function normalizeContextOptions(
  value: string[] | { focusKeywords?: string[]; tokenBudget?: number }
): { focusKeywords: string[]; tokenBudget?: number } {
  return Array.isArray(value)
    ? { focusKeywords: value }
    : { focusKeywords: value.focusKeywords || [], tokenBudget: value.tokenBudget };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
