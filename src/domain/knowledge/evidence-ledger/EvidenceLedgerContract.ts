/**
 * 证据台账（Evidence Ledger）领域契约 — 冷启动证据保真主线（Wave A E1）。
 *
 * 背景：in-process 冷启动中模型凭记忆手写 file:line 引用会发生捏造（2026-07-04 真机事故：
 * 引用了从未存在的路径，提交门禁只能在最后一关拦截）。台账把「证据」升级为运行时自动
 * 落盘、条目化、可寻址的一等对象：
 *   - 采集侧（AlembicAgent 运行时）在工具结果收口处自动写入条目，模型无参与；
 *   - 引用侧（note_finding / producer submit）只允许携带台账条目 ID（evidenceRefs），
 *     file:line 由条目机械展开，模型不再手写——捏造从「提示词劝阻」变为语法层面不可能。
 *
 * 本模块是纯领域契约：类型、ID/引用语法、结构守卫；不含 fs / crypto / 宿主逻辑。
 * 存储实现与内容哈希在宿主运行时（AlembicAgent EvidenceLedgerStore）。
 * 提交门禁语义（gateRules 九拒因）不因台账放松：fs 解析仍是最终权威，台账是前置保真层。
 */

/** 证据类工具全集 —— 只有这些工具的返回会被采集落账（memory/meta/knowledge 不属证据源） */
export const EVIDENCE_TOOL_IDS = [
  'code.read',
  'code.search',
  'code.outline',
  'code.structure',
  'graph.overview',
  'graph.query',
  'terminal.exec',
] as const;

export type EvidenceToolId = (typeof EVIDENCE_TOOL_IDS)[number];

export function isEvidenceToolId(value: string): value is EvidenceToolId {
  return (EVIDENCE_TOOL_IDS as readonly string[]).includes(value);
}

/** 行区间：1-indexed 闭区间，与门禁 SOURCE_REF 的 file:start-end 语义一致 */
export interface EvidenceRange {
  start: number;
  end: number;
}

/**
 * 台账条目。content 是 verbatim 原文（read=范围切片；search=命中行+上下文；
 * graph/terminal=结构化结果序列化）。contentHash 对「落盘后的 content」计算，
 * E5 新鲜度终检用同一尺子（重切同范围、同截断策略后比对）。
 */
export interface EvidenceEntry {
  /** ^E-\d+$，session+dimension 内单调递增 */
  id: string;
  sessionId: string;
  dimensionId: string;
  tool: EvidenceToolId;
  /** 关联原始工具调用（诊断/审计链路） */
  callId: string;
  /** repo-relative 路径；read/search 命中必填，graph/terminal 可缺省 */
  file?: string;
  range?: EvidenceRange;
  content: string;
  contentHash: string;
  capturedAt: number;
}

export const EVIDENCE_ID_RE = /^E-\d+$/;

/** 单条 content 上限（CG-1 初值）；超限保头截断并附显式标记，hash 按截断后内容计算 */
export const EVIDENCE_ENTRY_MAX_CHARS = 8000;

export function makeEvidenceId(seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error(`evidence seq must be a positive integer, got ${String(seq)}`);
  }
  return `E-${seq}`;
}

/**
 * 引用语法：`E-12`（整条）或 `E-12@5-20`（条目内/文件内 1-indexed 子区间）。
 * 用 `@` 而非 `:` 作分隔，避免与 file:line 引用混淆。
 */
const EVIDENCE_REF_RE = /^(E-\d+)(?:@(\d+)-(\d+))?$/;

export interface ParsedEvidenceRef {
  id: string;
  range?: EvidenceRange;
}

export function parseEvidenceRef(raw: string): ParsedEvidenceRef | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const match = EVIDENCE_REF_RE.exec(raw.trim());
  if (!match) {
    return null;
  }
  if (!match[2] || !match[3]) {
    return { id: match[1] };
  }
  const start = Number(match[2]);
  const end = Number(match[3]);
  if (start < 1 || end < start) {
    return null;
  }
  return { id: match[1], range: { start, end } };
}

function isValidRange(value: unknown): value is EvidenceRange {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const range = value as Partial<EvidenceRange>;
  return (
    Number.isInteger(range.start) &&
    Number.isInteger(range.end) &&
    (range.start as number) >= 1 &&
    (range.end as number) >= (range.start as number)
  );
}

/** 结构守卫：JSONL 回读/跨进程归一化用（宽进严出——不合法行整条丢弃并留诊断） */
export function isValidEvidenceEntry(value: unknown): value is EvidenceEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const entry = value as Partial<EvidenceEntry>;
  if (typeof entry.id !== 'string' || !EVIDENCE_ID_RE.test(entry.id)) {
    return false;
  }
  if (typeof entry.sessionId !== 'string' || entry.sessionId.length === 0) {
    return false;
  }
  if (typeof entry.dimensionId !== 'string' || entry.dimensionId.length === 0) {
    return false;
  }
  if (typeof entry.tool !== 'string' || !isEvidenceToolId(entry.tool)) {
    return false;
  }
  if (typeof entry.callId !== 'string') {
    return false;
  }
  if (entry.file !== undefined && (typeof entry.file !== 'string' || entry.file.length === 0)) {
    return false;
  }
  if (entry.range !== undefined && !isValidRange(entry.range)) {
    return false;
  }
  if (typeof entry.content !== 'string') {
    return false;
  }
  if (typeof entry.contentHash !== 'string' || entry.contentHash.length === 0) {
    return false;
  }
  return Number.isFinite(entry.capturedAt);
}
