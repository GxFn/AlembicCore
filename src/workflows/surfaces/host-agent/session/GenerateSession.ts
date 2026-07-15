/**
 * GenerateSession — 宿主 Agent 驱动的 Bootstrap 会话状态管理
 *
 * 会话状态会写入 dataRoot/.asd/bootstrap-sessions/active-sessions.json。
 * 这让 host-agent 在 MCP/Core 进程重启后仍可通过 bootstrapSessionRef
 * 恢复同一条会话，同时用项目级 lease 阻止并发重建覆盖已有会话。
 *
 * @module bootstrap/GenerateSession
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DimensionDef } from '../../../../types/ProjectSnapshot.js';
import type { SessionCacheShape } from '../../../../types/SnapshotViews.js';
import {
  type DimensionQualityReport,
  HostAgentSubmissionTracker,
  type HostAgentSubmissionTrackerSerialized,
} from './HostAgentSubmissionTracker.js';
import { MiningSessionStore, type MiningSessionStoreSerialized } from './MiningSessionStore.js';

// ── 本地类型定义 ─────────────────────────────────────────────

/** Bootstrap 会话构造参数 */
export interface GenerateSessionOpts {
  projectRoot: string;
  dimensions: DimensionDef[];
  projectContext?: Record<string, unknown>;
  id?: string;
  startedAt?: number;
  expiresAt?: number;
  completedDimensions?: Record<string, DimensionCompletion>;
  crossDimensionHints?: Record<string, CrossDimensionHint[]>;
  snapshotCache?: SessionCacheShape | null;
  sessionStore?: MiningSessionStoreSerialized;
  submissionTracker?: HostAgentSubmissionTrackerSerialized;
  onChange?: () => void;
}

/** 维度完成报告 */
interface DimensionReport {
  analysisText?: string;
  findings?: string[];
  keyFindings?: string[];
  referencedFiles?: string[];
  recipeIds?: string[];
  candidateCount?: number;
  [key: string]: unknown;
}

/** 维度完成记录（带时间戳） */
export interface DimensionCompletion extends DimensionReport {
  completedAt: number;
}

/** 跨维度 hint 条目 */
export interface CrossDimensionHint {
  fromDim: string;
  hint: string;
}

export interface GenerateSessionSnapshot {
  id: string;
  projectRoot: string;
  dimensions: DimensionDef[];
  projectContext: Record<string, unknown>;
  startedAt: number;
  expiresAt: number;
  completedDimensions: Record<string, DimensionCompletion>;
  crossDimensionHints: Record<string, CrossDimensionHint[]>;
  snapshotCache: SessionCacheShape | null;
  sessionStore: MiningSessionStoreSerialized;
  submissionTracker: HostAgentSubmissionTrackerSerialized;
  savedAt: number;
}

export interface GenerateSessionManagerOptions {
  dataRoot?: string | null;
}

export interface GenerateSessionLookupOptions {
  projectRoot?: string;
}

export type GenerateSessionPublicState =
  | 'active'
  | 'bootstrap_in_progress'
  | 'complete'
  | 'expired'
  | 'session_not_found'
  | 'session_project_mismatch';

export interface GenerateSessionStatus {
  state: GenerateSessionPublicState;
  reason: string;
  sessionId?: string;
  activeSessionId?: string;
  projectRoot?: string;
  activeProjectRoot?: string;
  expiresAt?: number;
  errorCode?: string;
  failureKind?: string;
  httpStatus?: number;
  mcpErrorCode?: string;
  problemClass?: string;
  reasonCode?: string;
  retryable?: boolean;
  statusCode?: number;
}

interface GenerateSessionStoreFile {
  version: 1;
  savedAt: number;
  sessions: GenerateSessionSnapshot[];
}

// ── 常量 ────────────────────────────────────────────────────

export const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 小时

const STORE_RELATIVE_PATH = path.join('.asd', 'bootstrap-sessions', 'active-sessions.json');

// ── GenerateSession errors ─────────────────────────────────

export class GenerateSessionLeaseError extends Error {
  readonly code = 'BOOTSTRAP_IN_PROGRESS';
  readonly errorCode = 'BOOTSTRAP_IN_PROGRESS';
  readonly failureKind = 'core.failure.conflict';
  readonly httpStatus = 409;
  readonly mcpErrorCode = 'core.failure.conflict';
  readonly problemClass = 'state-conflict';
  readonly reasonCode = 'conflict';
  readonly retryable = true;
  readonly state = 'bootstrap_in_progress';
  readonly statusCode = 409;
  readonly activeSessionId: string;
  readonly activeProjectRoot: string;
  readonly expiresAt: number;

  constructor(activeSession: GenerateSession) {
    super(
      `Bootstrap already in progress for project "${activeSession.projectRoot}" with session "${activeSession.id}".`
    );
    this.name = 'GenerateSessionLeaseError';
    this.activeSessionId = activeSession.id;
    this.activeProjectRoot = activeSession.projectRoot;
    this.expiresAt = activeSession.expiresAt;
  }

  toJSON(): GenerateSessionStatus {
    return {
      state: this.state,
      reason: 'bootstrap_in_progress',
      activeSessionId: this.activeSessionId,
      activeProjectRoot: this.activeProjectRoot,
      expiresAt: this.expiresAt,
      errorCode: this.errorCode,
      failureKind: this.failureKind,
      httpStatus: this.httpStatus,
      mcpErrorCode: this.mcpErrorCode,
      problemClass: this.problemClass,
      reasonCode: this.reasonCode,
      retryable: this.retryable,
      statusCode: this.statusCode,
    };
  }
}

// ── GenerateSession ────────────────────────────────────────

export class GenerateSession {
  expiresAt: number;
  id: string;
  projectRoot: string;
  startedAt: number;
  _activeSession: GenerateSession | null;
  completedDimensions: Map<string, DimensionCompletion>;
  crossDimensionHints: Record<string, CrossDimensionHint[]>;
  dimensions: DimensionDef[];
  snapshotCache: SessionCacheShape | null;
  sessionStore: MiningSessionStore;
  submissionTracker: HostAgentSubmissionTracker;
  #onChange: (() => void) | null;
  #projectContext: Record<string, unknown>;

  /**
   * @param opts.projectRoot 项目根目录
   * @param opts.dimensions 激活的维度定义列表
   * @param [opts.projectContext] 传给 EpisodicMemory 的项目元数据
   */
  constructor({
    projectRoot,
    dimensions,
    projectContext = {},
    id,
    startedAt,
    expiresAt,
    completedDimensions,
    crossDimensionHints,
    snapshotCache,
    sessionStore,
    submissionTracker,
    onChange,
  }: GenerateSessionOpts) {
    this.#onChange = onChange ?? null;
    const initialProjectContext = cloneProjectContext(projectContext);
    this.#projectContext = initialProjectContext;
    this.id = id ?? `bs-${crypto.randomUUID()}`;
    this.projectRoot = normalizeProjectRoot(projectRoot);
    this.dimensions = dimensions;
    this.completedDimensions = new Map<string, DimensionCompletion>(
      Object.entries(completedDimensions ?? {})
    );
    this.sessionStore = sessionStore
      ? MiningSessionStore.fromJSON(sessionStore as unknown as Record<string, unknown>)
      : new MiningSessionStore(initialProjectContext);

    /** 宿主 Agent 提交追踪 (v2: 对标内部 Agent 的 EvidenceCollector) */
    this.submissionTracker = submissionTracker
      ? HostAgentSubmissionTracker.fromJSON(submissionTracker, {
          onChange: () => this.#emitChange(),
        })
      : new HostAgentSubmissionTracker({ onChange: () => this.#emitChange() });

    /** Phase 1-4 分析结果缓存，供 wiki_plan 复用 */
    this.snapshotCache = snapshotCache ?? null;

    /** 跨维度 hints 收集 */
    this.crossDimensionHints = normalizeHints(crossDimensionHints);

    this._activeSession = null;

    this.startedAt = startedAt ?? Date.now();
    this.expiresAt = expiresAt ?? Date.now() + SESSION_TTL_MS;
  }

  setOnChange(onChange?: (() => void) | null): void {
    this.#onChange = onChange ?? null;
    this.submissionTracker.setOnChange(() => this.#emitChange());
  }

  // ── 状态查询 ──────────────────────────────────────────────

  get isExpired() {
    return Date.now() > this.expiresAt;
  }

  get isComplete() {
    return this.completedDimensions.size >= this.dimensions.length;
  }

  get isBlockingLease() {
    return !this.isExpired && !this.isComplete;
  }

  getProgress() {
    return {
      completed: this.completedDimensions.size,
      total: this.dimensions.length,
      completedDimIds: [...this.completedDimensions.keys()],
      remainingDimIds: this.dimensions
        .map((d: DimensionDef) => d.id)
        .filter((id: string) => !this.completedDimensions.has(id)),
    };
  }

  /** 检查某个维度是否已完成 */
  isDimensionComplete(dimId: string): boolean {
    return this.completedDimensions.has(dimId);
  }

  extendTtl(minimumTtlMs = 60 * 60 * 1000): void {
    this.expiresAt = Math.max(this.expiresAt, Date.now() + minimumTtlMs);
    this.#emitChange();
  }

  /**
   * 原地替换会话携带的项目上下文，并沿用既有 onChange 持久化边界。
   * 调用方不能借此更换 session/dataRoot，也不必等待其他状态变化才落盘。
   */
  replaceProjectContext(projectContext: Record<string, unknown>): void {
    const nextProjectContext = cloneProjectContext(projectContext);
    const previousProjectContext = this.#projectContext;
    this.#projectContext = nextProjectContext;
    try {
      this.#emitChange();
    } catch (error) {
      this.#projectContext = previousProjectContext;
      throw error;
    }
  }

  // ── 维度完成 ──────────────────────────────────────────────

  /**
   * 标记维度完成
   * @param report { analysisText, findings, referencedFiles, recipeIds, candidateCount }
   * @returns } - updated=true 表示覆盖了已有记录
   */
  markDimensionComplete(
    dimId: string,
    report: DimensionReport
  ): { updated: boolean; qualityReport: DimensionQualityReport } {
    const updated = this.completedDimensions.has(dimId);

    this.completedDimensions.set(dimId, {
      ...report,
      completedAt: Date.now(),
    });

    // 写入 SessionStore
    // keyFindings 是字符串数组，需转换为 SessionStore 期望的 { finding, importance } 格式
    this.sessionStore.storeDimensionReport(dimId, {
      analysisText: report.analysisText,
      findings: (report.keyFindings || []).map((f: string) => ({ finding: f, importance: 7 })),
      referencedFiles: report.referencedFiles || [],
      candidatesSummary: [],
    });

    // v2: 从 analysisText 提取负空间信号并计算质量报告
    this.submissionTracker.extractNegativeSignals(report.analysisText || '', dimId);
    const qualityReport = this.submissionTracker.buildQualityReport(
      dimId,
      report.analysisText,
      report.referencedFiles || []
    );

    this.#emitChange();
    return { updated, qualityReport };
  }

  // ── Cross-Dimension Hints ─────────────────────────────────

  /**
   * 存储跨维度 hints
   * @param fromDimId 来源维度
   * @param hints { targetDimId: hintText }
   */
  storeHints(
    fromDimId: string,
    hints: Record<string, string> | Record<string, unknown> | null | undefined
  ) {
    if (!hints || typeof hints !== 'object') {
      return;
    }

    for (const [targetDim, hintText] of Object.entries(hints)) {
      if (!this.crossDimensionHints[targetDim]) {
        this.crossDimensionHints[targetDim] = [];
      }
      // 去重：同源维度只保留最新 hint
      this.crossDimensionHints[targetDim] = this.crossDimensionHints[targetDim].filter(
        (h: CrossDimensionHint) => h.fromDim !== fromDimId
      );
      this.crossDimensionHints[targetDim].push({
        fromDim: fromDimId,
        hint: String(hintText),
      });
    }
    this.#emitChange();
  }

  /**
   * 收集与剩余维度相关的 accumulated hints
   * @returns >>}
   */
  getAccumulatedHints() {
    const progress = this.getProgress();
    const accumulated: Record<string, CrossDimensionHint[]> = {};

    for (const remainingDim of progress.remainingDimIds) {
      const hints = this.crossDimensionHints[remainingDim];
      if (hints?.length > 0) {
        accumulated[remainingDim] = hints;
      }
    }

    return accumulated;
  }

  // ── Snapshot 缓存 ──────────────────────────────────────────

  /**
   * 缓存 Phase 1-4 分析结果（ProjectSnapshot 的 session cache 形式）
   * @param cache toSessionCache(snapshot) 的返回值
   */
  setSnapshotCache(cache: SessionCacheShape | null) {
    this.snapshotCache = cache;
    this.#emitChange();
  }

  /** 获取 Snapshot 缓存（wiki_plan / dimension-complete 复用） */
  getSnapshotCache() {
    return this.snapshotCache;
  }

  // ── 序列化 ────────────────────────────────────────────────

  toSnapshot(): GenerateSessionSnapshot {
    return {
      id: this.id,
      projectRoot: this.projectRoot,
      dimensions: this.dimensions,
      projectContext: cloneProjectContext(this.#projectContext),
      startedAt: this.startedAt,
      expiresAt: this.expiresAt,
      completedDimensions: Object.fromEntries(this.completedDimensions),
      crossDimensionHints: normalizeHints(this.crossDimensionHints),
      snapshotCache: this.snapshotCache,
      sessionStore: this.sessionStore.toJSON(this.#projectContext),
      submissionTracker: this.submissionTracker.toJSON(),
      savedAt: Date.now(),
    };
  }

  toJSON() {
    return {
      id: this.id,
      projectRoot: this.projectRoot,
      startedAt: this.startedAt,
      expiresAt: this.expiresAt,
      state: this.isExpired ? 'expired' : this.isComplete ? 'complete' : 'active',
      progress: this.getProgress(),
      dimensionCount: this.dimensions.length,
    };
  }

  #emitChange(): void {
    this.#onChange?.();
  }
}

// ── Session 管理器（进程级单例）──────────────────────────────

/**
 * GenerateSessionManager — 管理 active session
 *
 * 设计为进程级 lazy lifecycle，通过 ServiceContainer 注册。
 * 每个项目同一时间只有一个未过期 session；dataRoot 可用时写入 durable
 * session index，使新进程能从 bootstrapSessionRef 重建同一条会话。
 */
export class GenerateSessionManager {
  _activeSession: GenerateSession | null;
  #sessionsByProject = new Map<string, GenerateSession>();
  #storePath: string | null;

  constructor(options: GenerateSessionManagerOptions = {}) {
    this._activeSession = null;
    this.#storePath = options.dataRoot
      ? path.join(normalizeProjectRoot(options.dataRoot), STORE_RELATIVE_PATH)
      : null;
    this.#loadFromDisk();
    this.#rememberNewestSession();
  }

  /**
   * 创建新的 bootstrap session。
   *
   * 同项目已有未过期 session 时抛出 GenerateSessionLeaseError，外层可将
   * errorCode/state 映射为 clean output 的 bootstrap_in_progress 状态。
   */
  createSession(opts: GenerateSessionOpts, options: { replace?: boolean } = {}): GenerateSession {
    this.#loadFromDisk();
    const projectKey = sessionProjectKey(opts.projectRoot);
    const existing = this.#sessionsByProject.get(projectKey);
    if (existing && !existing.isBlockingLease) {
      this.#sessionsByProject.delete(projectKey);
    } else if (existing && !options.replace) {
      throw new GenerateSessionLeaseError(existing);
    }

    const session = new GenerateSession({
      ...opts,
      onChange: () => this.#persist(),
    });
    this.#sessionsByProject.set(projectKey, session);
    this._activeSession = session;
    this.#persist();
    return session;
  }

  /**
   * 获取 active session。
   * @param [sessionId] 可选，用于验证 session ID
   */
  getSession(
    sessionId?: string,
    options: GenerateSessionLookupOptions = {}
  ): GenerateSession | null {
    const session = this.#findSession(sessionId, options);
    if (
      !session ||
      session.isExpired ||
      (options.projectRoot &&
        sessionProjectKey(options.projectRoot) !== sessionProjectKey(session.projectRoot))
    ) {
      return null;
    }
    return session;
  }

  /** 获取 active session，无论是否过期（用于兼容恢复场景） */
  getAnySession(
    sessionId?: string,
    options: GenerateSessionLookupOptions = {}
  ): GenerateSession | null {
    const session = this.#findSession(sessionId, options);
    if (
      session &&
      options.projectRoot &&
      sessionProjectKey(options.projectRoot) !== sessionProjectKey(session.projectRoot)
    ) {
      return null;
    }
    return session;
  }

  getSessionStatus(
    sessionId?: string,
    options: GenerateSessionLookupOptions = {}
  ): GenerateSessionStatus {
    const session = this.#findSession(sessionId, options);
    if (session) {
      if (
        options.projectRoot &&
        sessionProjectKey(options.projectRoot) !== sessionProjectKey(session.projectRoot)
      ) {
        return {
          state: 'session_project_mismatch',
          reason: 'session_project_mismatch',
          sessionId: session.id,
          projectRoot: normalizeProjectRoot(options.projectRoot),
          activeProjectRoot: session.projectRoot,
          errorCode: 'BOOTSTRAP_SESSION_PROJECT_MISMATCH',
          failureKind: 'core.failure.invalid-input',
          problemClass: 'request-problem',
        };
      }
      if (session.isExpired) {
        return {
          state: 'expired',
          reason: 'session_expired',
          sessionId: session.id,
          projectRoot: session.projectRoot,
          expiresAt: session.expiresAt,
          errorCode: 'BOOTSTRAP_SESSION_EXPIRED',
          failureKind: 'core.failure.invalid-input',
          problemClass: 'request-problem',
        };
      }
      if (session.isComplete) {
        return {
          state: 'complete',
          reason: 'session_complete',
          sessionId: session.id,
          projectRoot: session.projectRoot,
          expiresAt: session.expiresAt,
        };
      }
      return {
        state: 'active',
        reason: 'session_active',
        sessionId: session.id,
        projectRoot: session.projectRoot,
        expiresAt: session.expiresAt,
      };
    }

    if (options.projectRoot) {
      const activeForProject = this.#sessionsByProject.get(sessionProjectKey(options.projectRoot));
      if (activeForProject?.isBlockingLease) {
        return new GenerateSessionLeaseError(activeForProject).toJSON();
      }
    }

    return {
      state: 'session_not_found',
      reason: 'session_not_found',
      ...(sessionId ? { sessionId } : {}),
      ...(options.projectRoot ? { projectRoot: normalizeProjectRoot(options.projectRoot) } : {}),
      errorCode: 'BOOTSTRAP_SESSION_NOT_FOUND',
      failureKind: 'core.failure.invalid-input',
      problemClass: 'request-problem',
    };
  }

  /** 清除 active session；传 sessionId 时只释放对应 lease。 */
  clearSession(sessionId?: string): void {
    if (!sessionId) {
      this.#sessionsByProject.clear();
      this._activeSession = null;
      this.#persist();
      return;
    }

    for (const [projectKey, session] of this.#sessionsByProject) {
      if (session.id === sessionId) {
        this.#sessionsByProject.delete(projectKey);
      }
    }
    this.#rememberNewestSession();
    this.#persist();
  }

  releaseProjectLease(projectRoot: string): boolean {
    const deleted = this.#sessionsByProject.delete(sessionProjectKey(projectRoot));
    this.#rememberNewestSession();
    if (deleted) {
      this.#persist();
    }
    return deleted;
  }

  #findSession(
    sessionId?: string,
    options: GenerateSessionLookupOptions = {}
  ): GenerateSession | null {
    if (sessionId) {
      for (const session of this.#sessionsByProject.values()) {
        if (session.id === sessionId) {
          return session;
        }
      }
      return null;
    }

    if (options.projectRoot) {
      return this.#sessionsByProject.get(sessionProjectKey(options.projectRoot)) ?? null;
    }

    return this.#selectNewestSession({ includeExpired: false });
  }

  #rememberNewestSession(): void {
    this._activeSession = this.#selectNewestSession({ includeExpired: true });
  }

  #selectNewestSession({ includeExpired }: { includeExpired: boolean }): GenerateSession | null {
    let newest: GenerateSession | null = null;
    for (const session of this.#sessionsByProject.values()) {
      if (!includeExpired && session.isExpired) {
        continue;
      }
      if (!newest || session.startedAt > newest.startedAt) {
        newest = session;
      }
    }
    return newest;
  }

  #loadFromDisk(): void {
    if (!this.#storePath || !fs.existsSync(this.#storePath)) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.#storePath, 'utf8'));
    } catch {
      return;
    }
    if (!isStoreFile(parsed)) {
      return;
    }

    const sessionsByProject = new Map<string, GenerateSession>();
    for (const snapshot of parsed.sessions) {
      if (!isSessionSnapshot(snapshot)) {
        continue;
      }
      const session = new GenerateSession({
        ...snapshot,
        onChange: () => this.#persist(),
      });
      sessionsByProject.set(sessionProjectKey(session.projectRoot), session);
    }
    this.#sessionsByProject = sessionsByProject;
    this.#rememberNewestSession();
  }

  #persist(): void {
    if (!this.#storePath) {
      return;
    }

    const payload: GenerateSessionStoreFile = {
      version: 1,
      savedAt: Date.now(),
      sessions: [...this.#sessionsByProject.values()].map((session) => session.toSnapshot()),
    };
    const dir = path.dirname(this.#storePath);
    fs.mkdirSync(dir, { recursive: true });
    const tempPath = path.join(
      dir,
      `.active-sessions.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`
    );
    fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tempPath, this.#storePath);
  }
}

function sessionProjectKey(projectRoot: string): string {
  return normalizeProjectRoot(projectRoot);
}

function normalizeProjectRoot(projectRoot: string): string {
  return path.resolve(projectRoot);
}

function cloneProjectContext(projectContext: Record<string, unknown>): Record<string, unknown> {
  try {
    const detached = structuredClone(projectContext);
    const serialized = JSON.stringify(detached);
    const cloned = JSON.parse(serialized) as unknown;
    if (!isRecord(cloned)) {
      throw new TypeError('Project context must be a record.');
    }
    return cloned;
  } catch (error) {
    throw new TypeError(
      'Generate session project context must be JSON-serializable structural data.',
      { cause: error }
    );
  }
}

function normalizeHints(
  hints: Record<string, CrossDimensionHint[]> | null | undefined
): Record<string, CrossDimensionHint[]> {
  const normalized: Record<string, CrossDimensionHint[]> = {};
  if (!hints || typeof hints !== 'object') {
    return normalized;
  }
  for (const [targetDim, entries] of Object.entries(hints)) {
    if (!Array.isArray(entries)) {
      continue;
    }
    normalized[targetDim] = entries
      .filter(isRecord)
      .map((entry) => ({
        fromDim: typeof entry.fromDim === 'string' ? entry.fromDim : '',
        hint: typeof entry.hint === 'string' ? entry.hint : '',
      }))
      .filter((entry) => entry.fromDim.length > 0 && entry.hint.length > 0);
  }
  return normalized;
}

function isStoreFile(value: unknown): value is GenerateSessionStoreFile {
  return (
    isRecord(value) &&
    value.version === 1 &&
    Array.isArray(value.sessions) &&
    typeof value.savedAt === 'number'
  );
}

function isSessionSnapshot(value: unknown): value is GenerateSessionSnapshot {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.projectRoot === 'string' &&
    Array.isArray(value.dimensions) &&
    typeof value.startedAt === 'number' &&
    typeof value.expiresAt === 'number' &&
    isRecord(value.projectContext) &&
    isRecord(value.completedDimensions) &&
    isRecord(value.crossDimensionHints) &&
    isRecord(value.sessionStore) &&
    isRecord(value.submissionTracker)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export default GenerateSession;
