/**
 * RecipePipelineEventPayloads — 生成链进度事件 payload 基础契约(W2,2026-07-02 全空间统一)。
 *
 * 与 pipelineEvents.ts(事件名 wire 常量)同域:此前主体与 Plugin 各维护一份
 * generate-event-types(共享 7 个 payload 骨架+ProgressPayload),且同概念异名
 * (主体 DimensionHostCompletePayload vs Plugin DimensionHostAgentCompletePayload)。
 * 本文件收编基础骨架;宿主专属观测字段(efficiency 等)在基础契约放宽为 unknown,
 * 主体侧本地收窄为具体类型(TS interface extends 兼容收窄),daemon 专属类型
 * (ProcessEventDraft 等)留主体。
 */

// ── DimensionComplete payload variants(discriminated union by `type`) ──

export interface DimensionSkippedPayload {
  type: 'skipped';
  reason: string;
}

export interface DimensionRestoredPayload {
  type: 'incremental-restored';
  reason: string;
}

export interface DimensionCheckpointRestoredPayload {
  type: 'checkpoint-restored';
  [key: string]: unknown;
}

export interface DimensionErrorPayload {
  type: 'error';
  reason: string;
}

export interface DimensionPipelineCompletePayload {
  type: 'candidate' | 'skill';
  extracted: number;
  created: number;
  status: string;
  reason?: string;
  degraded: boolean;
  durationMs: number;
  diagnostics?: unknown;
  toolCallCount: number;
  tokenUsage?: { input: number; output: number };
  /** 宿主观测字段:主体侧收窄为 AgentEfficiencySummary | null */
  efficiency?: unknown;
  source: string;
}

export interface DimensionSkillPayload {
  type: 'skill';
  /** 宿主观测字段:主体侧收窄为 ProjectSkillDeliveryReceipt 系 */
  deliveryReceipt?: unknown;
  deliveryReceiptSummary?: string;
  deliveryReceiptValidation?: unknown;
  skillName: string;
  sourceCount: number;
}

/** 统一名(此前主体叫 DimensionHostCompletePayload、Plugin 叫 DimensionHostAgentCompletePayload)。 */
export interface DimensionHostCompletePayload {
  type: 'skill' | 'candidate';
  extracted: number;
  skillCreated: boolean;
  recipesBound: number;
  progress: string;
  isBootstrapComplete: boolean;
  source: string;
}

/** 旧异名兼容(Plugin 消费者用名),同一类型。 */
export type DimensionHostAgentCompletePayload = DimensionHostCompletePayload;

/** Discriminated union — 通过 `type` 字段区分 */
export type DimensionCompletePayload =
  | DimensionSkippedPayload
  | DimensionRestoredPayload
  | DimensionCheckpointRestoredPayload
  | DimensionErrorPayload
  | DimensionPipelineCompletePayload
  | DimensionSkillPayload
  | DimensionHostCompletePayload;

// ── Other event payloads ─────────────────────────────────────

export interface ProgressPayload {
  [key: string]: unknown;
}
