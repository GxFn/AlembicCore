import type { KnowledgeEntry } from '../../domain/knowledge/KnowledgeEntry.js';
import type { KnowledgeRepository } from '../../domain/knowledge/KnowledgeRepository.js';
import type { KnowledgeFileStore } from '../../repository/knowledge/KnowledgeFileStore.js';
import type { ConfidenceRouter } from './ConfidenceRouter.js';
import type { KnowledgeGraphService } from './KnowledgeGraphService.js';
import type { RetrievalReadinessReport } from './RecipeRetrieval.js';

/**
 * 知识用例依赖的能力契约；宿主负责提供实现，契约不承担装配或生命周期。
 * 保留旧 repository 查询能力，写入返回明确允许 null；旧 domain runtime 类仍独立兼容。
 */
export interface KnowledgeServiceRepository extends Omit<KnowledgeRepository, 'create' | 'update'> {
  create(entry: KnowledgeEntry): Promise<KnowledgeEntry | null>;
  update(
    id: string,
    updates: KnowledgeEntry | Record<string, unknown>
  ): Promise<KnowledgeEntry | null>;
}

export type KnowledgeGraphWriter = Pick<KnowledgeGraphService, 'addEdge'>;
export type KnowledgeRoutingPolicy = Pick<ConfidenceRouter, 'route'>;

export interface AuditLoggerLike {
  log(entry: Record<string, unknown>): Promise<void>;
}

export interface SkillHooksLike {
  run(hookName: string, ...args: unknown[]): Promise<unknown>;
}

export interface QualityScorerLike {
  score(input: Record<string, unknown>): {
    score: number;
    dimensions: Record<string, number>;
    grade: string;
  };
}

export interface EventBusLike {
  emit(event: string | symbol, ...args: unknown[]): boolean;
}

export type AfterPublishHook = () => void | Promise<void>;
export type RetrievalReadinessEvaluator = (entry: KnowledgeEntry) => RetrievalReadinessReport;

export interface EdgeRepoLike {
  deleteOutgoing(fromId: string, fromType: string): Promise<number>;
  deleteByEntryId(entryId: string): Promise<number>;
}

export interface ProposalRepoLike {
  deleteByTargetRecipeId(targetRecipeId: string): number;
}

/**
 * P0/C7: 宿主注入的「接地投影」port。把一个 recipe item 的结构化 sourceRefs 经宿主 fs resolver 解析成
 * 真接地集(validSourcePaths / validRanges)。宿主(AlembicPlugin / 主体 AlembicAgent)已绑定 projectRoot +
 * RecipeSourceRefResolver，闭包内部调用 Core 的 `resolveGroundedSourcePaths`(与门禁 validateAgainst 字节
 * 同源)，从而 Core 保持 fs-free。
 *
 * 断路背景：门禁在 submit 期算出 validSourcePaths 后只回 violations 就丢弃；而 updateQuality 对已持久化
 * entry 打分时拿不到那次结果。此 port 让评分侧(C8 depthCoverage)重算「哪些 file:line 真接地」，使
 * 「深度只在接地时计分」成立。未注入 → 退化为旧行为(接地集为空、深度覆盖为 0、旧评分路径不变)。
 */
export type GroundedSourcePathsPort = (item: Record<string, unknown>) => {
  validSourcePaths: string[];
  validRanges: string[];
};

export interface KnowledgeServiceOptions {
  fileWriter?: KnowledgeFileStore | null;
  skillHooks?: SkillHooksLike | null;
  confidenceRouter?: KnowledgeRoutingPolicy | null;
  qualityScorer?: QualityScorerLike | null;
  eventBus?: EventBusLike | null;
  edgeRepo?: EdgeRepoLike | null;
  proposalRepo?: ProposalRepoLike | null;
  /** Core 不内置交付渠道，外层可注入发布后的交付/刷新 hook。 */
  afterPublish?: AfterPublishHook | null;
  /** P0/C7: 宿主注入的接地投影 port；未注入则深度覆盖退化为 0(向后兼容)。 */
  groundedSourcePaths?: GroundedSourcePathsPort | null;
  /** Recipe active-transition gate. Inject only for deterministic diagnostic decoration. */
  retrievalReadinessEvaluator?: RetrievalReadinessEvaluator;
}
