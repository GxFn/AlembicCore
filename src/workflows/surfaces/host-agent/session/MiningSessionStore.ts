import Logger from '../../../../infrastructure/logging/Logger.js';

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
  projectName?: string;
  primaryLang?: string;
  fileCount?: number;
  modules?: string[] | number;
  [key: string]: unknown;
}

export interface MiningSessionStoreSerialized {
  dimensionReports: Record<string, DimensionReport>;
  crossReferences: CrossReference[];
  tierReflections: TierReflection[];
  submittedCandidates: Record<string, CandidateSummary[]>;
  projectContext: Record<string, unknown>;
}

/**
 * Core 版 SessionStore：host-agent 会话里"每个维度的完成报告"的存放处。
 *
 * 宿主经 GenerateSession 用它做三件事：维度完成时存一份报告、之后按维度取回、随会话落盘与读回。
 * 快照持久化另外会问"哪些维度已完成"。别的能力（证据检索、跨维度上下文拼装、工具结果缓存、
 * 独立 checkpoint、统计）是从内部 Agent 的 SessionStore 照搬过来的，Core 这份从未有调用方——
 * 内部 Agent 用的是它自己的那一个类——已删除。
 *
 * 序列化形状没有变：tierReflections 与 submittedCandidates 在这里不再有写入方，但旧会话文件里
 * 可能带着它们，读回后原样保留、原样再写出，不丢数据。
 */
export class MiningSessionStore {
  #dimensionReports = new Map<string, DimensionReport>();
  #crossReferences: CrossReference[] = [];
  #tierReflections: TierReflection[] = [];
  #submittedCandidates = new Map<string, CandidateSummary[]>();
  #projectContext: Record<string, unknown>;
  #logger = Logger.getInstance();

  constructor(config: MiningSessionStoreConfig = {}) {
    this.#projectContext = normalizeMiningProjectContext(config);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
