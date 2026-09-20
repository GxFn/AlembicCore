import { KnowledgeEntry, type KnowledgeEntryProps } from '../../domain/knowledge/KnowledgeEntry.js';
import { inferKind, isValidTransition, Lifecycle } from '../../domain/knowledge/Lifecycle.js';
import Logger from '../../infrastructure/logging/Logger.js';
import type { KnowledgeFileStore } from '../../repository/knowledge/KnowledgeFileStore.js';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors/index.js';
import { commitKnowledgeWrite } from './commitKnowledgeWrite.js';
import type {
  AfterPublishHook,
  AuditLoggerLike,
  EdgeRepoLike,
  EventBusLike,
  GroundedSourcePathsPort,
  KnowledgeGraphWriter,
  KnowledgeRoutingPolicy,
  KnowledgeServiceOptions,
  KnowledgeServiceRepository,
  ProposalRepoLike,
  QualityScorerLike,
  RetrievalReadinessEvaluator,
  SkillHooksLike,
} from './KnowledgeServiceDependencies.js';
import { RECIPE_RETRIEVAL_PROFILE_UPDATE_SCHEMA } from './KnowledgeUpdateSchema.js';
import { persistKnowledgeUpdate } from './persistKnowledgeUpdate.js';
import { projectKnowledgeQualityFields } from './projectKnowledgeQualityFields.js';
import {
  evaluateRecipeRetrievalReadiness,
  type RetrievalReadinessReport,
} from './RecipeRetrieval.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 按旧可选链语义读 unknown hook：保留 Proxy/getter/可调用对象及原始值的 receiver。 */
function readHookResultField(result: unknown, field: 'block' | 'reason'): unknown {
  return result === null || result === undefined
    ? undefined
    : Reflect.get(Object(result), field, result);
}

/**
 * 显式保留旧 DB-only 在实体投影处的 TypeError；不把可空 update/transition
 * 提前改为失败。file-first 的回读分歧仍由 commitKnowledgeWrite 先行分类。
 */
function requireLegacyWriteReadback(
  entry: KnowledgeEntry | null,
  property: 'id' | 'toJSON'
): KnowledgeEntry {
  if (entry === null || entry === undefined) {
    throw new TypeError(`Cannot read properties of ${entry} (reading '${property}')`);
  }
  return entry;
}

// 宿主操作名保持兼容；计数持久化只使用 Stats 已有字段，不以类型断言创造新计数器。
const USAGE_COUNTERS = {
  adoption: 'adoptions',
  application: 'applications',
  view: 'views',
  adoptions: 'adoptions',
  applications: 'applications',
  views: 'views',
  guardHits: 'guardHits',
  searchHits: 'searchHits',
} as const;

interface ServiceContext {
  userId: string;
}

interface ListFilters {
  lifecycle?: string;
  kind?: string;
  language?: string;
  dimensionId?: string;
  category?: string;
  knowledgeType?: string;
  source?: string;
  tag?: string;
  scope?: string;
}

interface PaginationOptions {
  page?: number;
  pageSize?: number;
}

/**
 * KnowledgeService — 统一知识服务
 *
 * 替代 CandidateService + RecipeService。
 * 全链路使用 KnowledgeEntry 实体 + wire format，
 * 无需 promote、无需 metadata 袋子、无需打平映射。
 *
 * 生命周期操作委托给 KnowledgeEntry 实体方法，
 * Service 负责编排 Repository / FileWriter / AuditLog / Graph / SkillHooks。
 */
export class KnowledgeService {
  // 只跟踪正在执行的任务，不累积永久删除墓碑；删除计数防止较新失败掩盖仍在途的较早删除。
  #relationTasks = new Map<string, symbol>();
  #activeDeletes = new Map<string, number>();
  _confidenceRouter: KnowledgeRoutingPolicy | null;
  _edgeRepo: EdgeRepoLike | null;
  _eventBus: EventBusLike | null;
  _fileWriter: KnowledgeFileStore | null;
  _knowledgeGraphService: KnowledgeGraphWriter | null;
  _proposalRepo: ProposalRepoLike | null;
  _qualityScorer: QualityScorerLike | null;
  _skillHooks: SkillHooksLike | null;
  _afterPublish: AfterPublishHook | null;
  /** P0/C7: 接地投影 port(宿主注入)；null 时评分退化为旧行为。 */
  _groundedSourcePaths: GroundedSourcePathsPort | null;
  _retrievalReadinessEvaluator: RetrievalReadinessEvaluator;
  auditLogger: AuditLoggerLike;
  gateway: unknown;
  logger: ReturnType<typeof Logger.getInstance>;
  repository: KnowledgeServiceRepository;
  constructor(
    repository: KnowledgeServiceRepository,
    auditLogger: AuditLoggerLike,
    gateway: unknown,
    knowledgeGraphService: KnowledgeGraphWriter | null,
    options: KnowledgeServiceOptions = {}
  ) {
    this.repository = repository;
    this.auditLogger = auditLogger;
    this.gateway = gateway;
    this._knowledgeGraphService = knowledgeGraphService || null;
    this._fileWriter = options.fileWriter || null;
    this._skillHooks = options.skillHooks || null;
    this._confidenceRouter = options.confidenceRouter || null;
    this._qualityScorer = options.qualityScorer || null;
    this._eventBus = options.eventBus || null;
    this._edgeRepo = options.edgeRepo || null;
    this._proposalRepo = options.proposalRepo || null;
    this._afterPublish = options.afterPublish || null;
    this._groundedSourcePaths = options.groundedSourcePaths || null;
    this._retrievalReadinessEvaluator =
      options.retrievalReadinessEvaluator ?? evaluateRecipeRetrievalReadiness;
    this.logger = Logger.getInstance();
  }

  /* ═══ CRUD ══════════════════════════════════════════════ */

  /**
   * 创建知识条目
   *
   * MCP 参数 = wire format → KnowledgeEntry.fromJSON() 直接构造。
   * 新条目从 pending 开始；ConfidenceRouter 可选择 staging 或 deprecated。
   *
   * @param data wire format 数据
   * @param context { userId }
   */
  async create(data: KnowledgeEntryProps, context: ServiceContext) {
    try {
      this._validateCreateInput(data);

      // ── 标题去重：防止跨维度/跨调用创建同名条目 ──
      if (data.title) {
        const existing = await this.repository.findByTitle(data.title);
        if (existing) {
          throw new ConflictError(
            `Knowledge entry with title "${data.title}" already exists (id: ${existing.id})`,
            { existingId: existing.id, title: data.title }
          );
        }
      }

      const entry = KnowledgeEntry.fromJSON({
        ...data,
        lifecycle: Lifecycle.PENDING,
        source: data.source || 'manual',
        createdBy: context.userId,
      });

      if (!entry.isValid()) {
        throw new ValidationError('title + content required');
      }

      // ── SkillHooks: onKnowledgeSubmit ──
      if (this._skillHooks) {
        const hookResult = await this._skillHooks.run('onKnowledgeSubmit', entry, {
          userId: context.userId,
        });
        // 只消费原有 truthy block；不能先用 in 检查而遗漏 Proxy 提供的虚拟属性。
        if (readHookResultField(hookResult, 'block')) {
          const reason = readHookResultField(hookResult, 'reason');
          throw new ValidationError(`SkillHook blocked: ${reason || 'unknown'}`);
        }
        this.logger.debug('Knowledge submit hook returned no blocking decision', {
          entryId: entry.id,
          resultType: typeof hookResult,
        });
      }

      // ── ConfidenceRouter — staging 路由 ──
      if (this._confidenceRouter) {
        const route = await this._confidenceRouter.route(entry);
        if (route.action === 'auto_approve') {
          entry.autoApprovable = true;
          // 六态状态机：高置信度条目进入 staging
          if (route.targetState === 'staging' && route.gracePeriod) {
            entry.lifecycle = Lifecycle.STAGING;
            entry.stagingDeadline = Date.now() + route.gracePeriod;
          }
        } else if (route.action === 'reject' && route.targetState === 'deprecated') {
          entry.lifecycle = Lifecycle.DEPRECATED;
        }
        // pending 保持不变
      }

      // 注意: staging 条目由 StagingManager.checkAndPromote() 在到期后自动转为 active。
      // autoApprovable 标记保留，供前端显示「推荐批准」徽章。
      // 外层交付 hook 可自行决定是否交付高置信度 staging/pending 条目。

      const persisted = await commitKnowledgeWrite({
        entry,
        fileStore: this._fileWriter,
        operation: 'knowledge.create',
        commit: () => this.repository.create(entry),
        fileFailureMessage: `Knowledge file persist failed for "${entry.title}" — aborting create (file-first source of truth; see fileWriter error log)`,
        dbFailureMessage:
          'Knowledge file persisted but DB insert failed — run knowledge sync to rebuild DB truth',
      });
      const saved = requireLegacyWriteReadback(persisted, 'id');

      // 同步 relations → knowledge_edges
      await this._syncRelationsToGraph(saved.id, saved.relations);

      // 自动发现同域条目建立 related 边（best effort, 不阻塞）
      this._autoDiscoverRelations(saved.id, saved).catch((err) =>
        this.logger.warn('_autoDiscoverRelations error', { id: saved.id, error: err.message })
      );

      // 审计日志
      await this._audit('create_knowledge', saved.id, context.userId, {
        title: saved.title,
        lifecycle: saved.lifecycle,
        kind: saved.kind,
      });

      this.logger.info('Knowledge entry created', {
        id: saved.id,
        lifecycle: saved.lifecycle,
        kind: saved.kind,
        createdBy: context.userId,
      });

      // ── SkillHooks: onKnowledgeCreated (fire-and-forget) ──
      if (this._skillHooks) {
        this._skillHooks
          .run('onKnowledgeCreated', saved, {
            userId: context.userId,
          })
          .catch((err: unknown) =>
            this.logger.warn('SkillHook onKnowledgeCreated error', {
              error: err instanceof Error ? err.message : String(err),
            })
          );
      }

      // ── EventBus: 通知 VectorService 同步向量索引 ──
      if (this._eventBus) {
        this._eventBus.emit('knowledge:changed', {
          action: 'create',
          entryId: saved.id,
          entry: saved.toJSON(),
        });
      }

      return saved;
    } catch (error: unknown) {
      this.logger.error('Error creating knowledge entry', {
        error: error instanceof Error ? error.message : String(error),
        data,
      });
      throw error;
    }
  }

  /** 获取单个知识条目 */
  async get(id: string) {
    const entry = await this.repository.findById(id);
    if (!entry) {
      throw new NotFoundError('Knowledge entry not found', 'knowledge', id);
    }
    return entry;
  }

  /** Producer-facing view of the exact readiness report used by active transitions. */
  async evaluateRetrievalReadiness(id: string): Promise<RetrievalReadinessReport> {
    return this._evaluateRetrievalReadiness(await this._findOrThrow(id));
  }

  /**
   * 更新知识条目（仅允许白名单字段）
   * @param data 部分字段（camelCase）
   * @param context { userId }
   */
  async update(id: string, data: Partial<KnowledgeEntryProps>, context: ServiceContext) {
    try {
      // CO3 W3: lifecycle state is managed exclusively by the transition
      // guard (_lifecycleTransition → KnowledgeEntry._transition validity
      // check). Passing lifecycle-managed fields to update() used to be
      // silently dropped; it is now rejected as a typed error so callers
      // learn the supported route instead of believing the write happened.
      const LIFECYCLE_MANAGED = [
        'lifecycle',
        'lifecycleHistory',
        'publishedAt',
        'publishedBy',
        'reviewedBy',
        'reviewedAt',
        'rejectionReason',
        'autoApprovable',
      ];
      const bypassFields = LIFECYCLE_MANAGED.filter(
        (key) => (data as Record<string, unknown>)[key] !== undefined
      );
      if (bypassFields.length > 0) {
        throw new ValidationError(
          `Lifecycle fields cannot be set via update(): ${bypassFields.join(', ')} — use the lifecycle transition methods (publish/deprecate/reactivate/stage/evolve/decay/restore)`,
          { reason: 'lifecycle-transition-bypass', fields: bypassFields }
        );
      }

      const _entry = await this._findOrThrow(id);

      if (data.retrievalProfile !== undefined) {
        const result = RECIPE_RETRIEVAL_PROFILE_UPDATE_SCHEMA.safeParse(data.retrievalProfile);
        if (!result.success) {
          throw new ValidationError('Invalid retrievalProfile update', {
            reason: 'retrieval-profile-invalid',
            issues: result.error.issues.map((issue) => ({
              field: ['retrievalProfile', ...issue.path].join('.'),
              message: issue.message,
            })),
          });
        }
      }

      const UPDATABLE = [
        'title',
        'description',
        'trigger',
        'language',
        'dimensionId',
        'category',
        'knowledgeType',
        'complexity',
        'scope',
        'difficulty',
        'content',
        'relations',
        'constraints',
        'reasoning',
        'tags',
        'headers',
        'headerPaths',
        'moduleName',
        'includeHeaders',
        'agentNotes',
        'aiInsight',
        // Cursor 交付字段
        'topicHint',
        'whenClause',
        'doClause',
        'dontClause',
        'coreCode',
        'usageGuide',
        'retrievalProfile',
      ];

      const dbUpdates: Record<string, unknown> = {};

      for (const key of UPDATABLE) {
        if (data[key] === undefined) {
          continue;
        }

        switch (key) {
          case 'knowledgeType':
            dbUpdates.knowledgeType = data.knowledgeType;
            dbUpdates.kind = inferKind(data.knowledgeType ?? '');
            break;

          // tags 需要特殊处理：API 返回时已过滤系统标签，保存时需要合并回来
          case 'tags': {
            const existingSystemTags = (_entry.tags || []).filter((t: string) =>
              KnowledgeEntry.isSystemTag(t)
            );
            const incomingUserTags = (data.tags || []).filter(
              (t: string) => !KnowledgeEntry.isSystemTag(t)
            );
            dbUpdates.tags = [...incomingUserTags, ...existingSystemTags];
            break;
          }
          // 其余白名单字段直接交给实体/Repository 做同一套值对象归一化。
          default:
            dbUpdates[key] = data[key];
        }
      }

      if (Object.keys(dbUpdates).length === 0) {
        throw new ValidationError('No updatable fields provided');
      }

      dbUpdates.updatedAt = Math.floor(Date.now() / 1000);

      const updated = await this.#persistUpdate(
        _entry,
        dbUpdates,
        'knowledge.update',
        `Knowledge file persist failed for "${_entry.title}" — aborting update (file-first source of truth; see fileWriter error log)`
      );

      // 若 relations 变更，同步到 knowledge_edges
      if (dbUpdates.relations) {
        await this._syncRelationsToGraph(id, data.relations);
      }

      await this._audit('update_knowledge', id, context.userId, {
        fields: Object.keys(dbUpdates),
      });

      this.logger.info('Knowledge entry updated', {
        id,
        updatedBy: context.userId,
        fields: Object.keys(dbUpdates),
      });

      // ── EventBus: 通知 VectorService 同步向量索引 ──
      if (this._eventBus) {
        this._eventBus.emit('knowledge:changed', {
          action: 'update',
          entryId: id,
          entry: requireLegacyWriteReadback(updated, 'toJSON').toJSON(),
        });
      }

      return updated;
    } catch (error: unknown) {
      this.logger.error('Error updating knowledge entry', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 删除知识条目
   * @param context { userId }
   * @returns >}
   */
  async delete(id: string, context: ServiceContext) {
    this.#activeDeletes.set(id, (this.#activeDeletes.get(id) ?? 0) + 1);
    this.#relationTasks.delete(id);
    try {
      const entry = await this._findOrThrow(id);

      await commitKnowledgeWrite({
        entry,
        fileStore: this._fileWriter,
        fileOperation: 'remove',
        operation: 'knowledge.delete',
        reconcileVia: 'KnowledgeService.delete',
        fileFailureMessage: `Knowledge file removal failed — aborting delete: ${id}`,
        dbFailureMessage: 'Knowledge file removed but DB cleanup failed — retry knowledge deletion',
        commit: async () => {
          // 先完成反向引用的持久化清理再删主行；中途失败时仍可用相同 id 重试整个删除。
          await this.#removeReverseRelationsDurably(id);
          const deleted = await this.repository.delete(id);
          if (!deleted && (await this.repository.findById(id))) {
            throw new Error(`KNOWLEDGE_DELETE_NOT_APPLIED: ${id}`);
          }
          // 删除没有实体读回；受影响行或确认已不存在就是这次写入的完成凭据。
          return { id };
        },
      });

      // 正式仓储在同步事务内处理 FK 从表；下面保留旧 adapter 的派生索引清理。
      this._removeAllEdges(id);
      this._removeRelatedProposals(id);

      await this._audit('delete_knowledge', id, context.userId, {
        title: entry.title,
      });

      this.logger.info('Knowledge entry deleted', {
        id,
        deletedBy: context.userId,
        title: entry.title,
      });

      // ── EventBus: 通知 VectorService 移除向量索引 ──
      if (this._eventBus) {
        this._eventBus.emit('knowledge:deleted', { entryId: id });
      }

      return { success: true, id };
    } catch (error: unknown) {
      this.logger.error('Error deleting knowledge entry', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      const remaining = this.#activeDeletes.get(id)! - 1;
      if (remaining > 0) {
        this.#activeDeletes.set(id, remaining);
      } else {
        this.#activeDeletes.delete(id);
      }
    }
  }

  /* ═══ 生命周期操作 ══════════════════════════════════════ */

  /** 发布 (pending → active) — 仅开发者可执行 */
  async publish(id: string, context: ServiceContext) {
    const result = await this._lifecycleTransition(id, 'publish', context, {
      entityArgs: [context.userId],
    });

    // 发布后触发外层注入的交付/刷新 hook（非阻塞）
    this._triggerAfterPublishAsync();

    return result;
  }

  /**
   * 触发外层发布后 hook（非阻塞、容错）。
   * Core 不依赖 Cursor Delivery / ServiceContainer，避免把交付渠道带入内核。
   */
  _triggerAfterPublishAsync() {
    if (!this._afterPublish) {
      return;
    }
    Promise.resolve()
      .then(() => this._afterPublish?.())
      .catch((error: unknown) => {
        this.logger.warn('afterPublish hook error', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  /** 弃用 (pending|active → deprecated) */
  async deprecate(id: string, reason: string, context: ServiceContext) {
    if (!reason || reason.trim().length === 0) {
      throw new ValidationError('Deprecation reason is required');
    }
    return this._lifecycleTransition(id, 'deprecate', context, {
      entityArgs: [reason],
    });
  }

  /** 重新激活 (deprecated|staging → pending) */
  async reactivate(id: string, context: ServiceContext) {
    return this._lifecycleTransition(id, 'reactivate', context);
  }

  /** 进入暂存期 (pending → staging) */
  async stage(id: string, context: ServiceContext) {
    return this._lifecycleTransition(id, 'stage', context);
  }

  /** 进入进化态 (active → evolving) */
  async evolve(id: string, context: ServiceContext) {
    return this._lifecycleTransition(id, 'evolve', context);
  }

  /** 进入衰退观察 (active|evolving → decaying) */
  async decay(id: string, context: ServiceContext) {
    return this._lifecycleTransition(id, 'decay', context);
  }

  /** 恢复为已发布 (decaying|evolving → active) */
  async restore(id: string, context: ServiceContext) {
    return this._lifecycleTransition(id, 'restore', context);
  }

  // ── 向后兼容别名 ──

  /** @deprecated 简化后所有条目直接进 pending */
  async submit(id: string, _context: ServiceContext) {
    return this.get(id);
  }

  /** @deprecated 简化后 approve = publish */
  async approve(id: string, context: ServiceContext) {
    return this.publish(id, context);
  }

  /** @deprecated 简化后无需 autoApprove */
  async autoApprove(id: string, _context: ServiceContext) {
    return this.get(id);
  }

  /** @deprecated 简化后 reject = deprecate */
  async reject(id: string, reason: string, context: ServiceContext) {
    return this.deprecate(id, reason, context);
  }

  /** @deprecated 简化后 toDraft = reactivate */
  async toDraft(id: string, context: ServiceContext) {
    return this.reactivate(id, context);
  }

  /** @deprecated 简化后 fastTrack = publish */
  async fastTrack(id: string, context: ServiceContext) {
    return this.publish(id, context);
  }

  /* ═══ 查询 ══════════════════════════════════════════════ */

  /**
   * 查询列表
   * @param filters { lifecycle, kind, language, dimensionId, category, knowledgeType, source, tag }
   * @param pagination { page, pageSize }
   */
  async list(filters: ListFilters = {}, pagination: PaginationOptions = {}) {
    try {
      const {
        lifecycle,
        kind,
        language,
        dimensionId,
        category,
        knowledgeType,
        source,
        tag,
        scope,
      } = filters;
      const { page = 1, pageSize = 20 } = pagination;

      const dbFilters: Record<string, unknown> = {};
      if (lifecycle) {
        dbFilters.lifecycle = lifecycle;
      }
      if (kind) {
        dbFilters.kind = kind;
      }
      if (language) {
        dbFilters.language = language;
      }
      if (dimensionId) {
        dbFilters.dimensionId = dimensionId;
      }
      if (category) {
        dbFilters.category = category;
      }
      if (knowledgeType) {
        dbFilters.knowledgeType = knowledgeType;
      }
      if (source) {
        dbFilters.source = source;
      }
      if (scope) {
        dbFilters.scope = scope;
      }
      if (tag) {
        dbFilters._tagLike = tag;
      }

      return this.repository.findWithPagination(dbFilters, { page, pageSize });
    } catch (error: unknown) {
      this.logger.error('Error listing knowledge entries', {
        error: error instanceof Error ? error.message : String(error),
        filters,
      });
      throw error;
    }
  }

  /** 按 Kind 查询 */
  async listByKind(kind: string, pagination: PaginationOptions = {}) {
    try {
      const { page = 1, pageSize = 20 } = pagination;
      return this.repository.findByKind(kind, { page, pageSize });
    } catch (error: unknown) {
      this.logger.error('Error listing by kind', {
        kind,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** 搜索 */
  async search(keyword: string, pagination: PaginationOptions = {}) {
    try {
      const { page = 1, pageSize = 20 } = pagination;
      return this.repository.search(keyword, { page, pageSize });
    } catch (error: unknown) {
      this.logger.error('Error searching knowledge', {
        keyword,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** 获取统计信息 */
  async getStats() {
    try {
      return this.repository.getStats();
    } catch (error: unknown) {
      this.logger.error('Error getting knowledge stats', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /* ═══ 使用/质量 ═════════════════════════════════════ */

  /**
   * 增加使用计数
   * @param [options] { actor, feedback }
   */
  async incrementUsage(
    id: string,
    type = 'adoption',
    options: { actor?: string; feedback?: string } = {}
  ) {
    try {
      const counter = Object.hasOwn(USAGE_COUNTERS, type)
        ? USAGE_COUNTERS[type as keyof typeof USAGE_COUNTERS]
        : null;
      if (type !== 'feedback' && counter === null) {
        throw new ValidationError(`Unknown knowledge usage type: ${type}`, {
          field: 'type',
          value: type,
          allowedTypes: [...Object.keys(USAGE_COUNTERS), 'feedback'],
        });
      }
      const entry = await this._findOrThrow(id);
      if (counter) {
        entry.stats.increment(counter);
        // 计数也是 Markdown 真相的一部分；只写 DB 会在下次文件同步时归零。
        await persistKnowledgeUpdate(
          this.repository,
          this._fileWriter,
          id,
          { stats: entry.stats.toJSON(), updatedAt: Math.floor(Date.now() / 1000) },
          'knowledge-usage'
        );
      }
      // feedback 保持已有审计语义，无计数变化时不产生额外文件写入。

      await this._audit(`knowledge_${type}`, id, options.actor || 'system', {
        feedback: options.feedback,
      });

      this.logger.debug('Knowledge usage recorded', {
        id,
        type,
        counter,
        persisted: counter !== null,
      });

      return entry;
    } catch (error: unknown) {
      this.logger.error(`Error incrementing knowledge ${type}`, {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 更新质量评分
   * @param [context] { userId }
   */
  async updateQuality(id: string, context: Partial<ServiceContext> = {}) {
    try {
      const entry = await this._findOrThrow(id);

      if (!this._qualityScorer) {
        throw new ValidationError('QualityScorer not configured');
      }

      // P0/C7: 若宿主注入了接地 port，重算该 entry 的真接地集(与门禁字节同源)喂给 scorer 做深度覆盖判定；
      // 未注入则空集 → depthCoverage 退化为 0，旧评分路径不变(additive/向后兼容)。
      // P5/C8: groundingAvailable 标记「接地 port 是否就位」——scorer 据此决定走深度加权公式还是 legacy
      // 公式(未就位时字节不变、零回归)，区别于「port 就位但本条 recipe 恰好零接地」。
      const groundingAvailable = Boolean(this._groundedSourcePaths);
      const grounding = this._groundedSourcePaths
        ? this._groundedSourcePaths(this._groundingItemFromEntry(entry))
        : { validSourcePaths: [], validRanges: [] };

      // 为 QualityScorer 适配输入字段
      const scorerInput = this._adaptForScorer(entry, grounding, groundingAvailable);
      const result = this._qualityScorer.score(scorerInput);

      // 更新 Quality 值对象；同步计算 authority（0‑5）
      const qualityJson = {
        completeness: result.dimensions.completeness,
        adaptation: result.dimensions.deliveryReady,
        documentation: result.dimensions.contentDepth,
        overall: result.score,
        grade: result.grade,
      };

      // 当 authority 从未手动设置（仍为 0）时，从 quality.overall 自动推导
      const currentAuthority = entry.stats?.authority ?? 0;
      const updatePayload: Record<string, unknown> = {
        quality: qualityJson,
        updatedAt: Math.floor(Date.now() / 1000),
      };
      if (currentAuthority === 0 && result.score > 0) {
        const statsObj =
          entry.stats?.toJSON?.() ?? (typeof entry.stats === 'object' ? { ...entry.stats } : {});
        updatePayload.stats = {
          ...statsObj,
          authority: Math.round(result.score * 5),
        };
      }

      await this.#persistUpdate(
        entry,
        updatePayload,
        'knowledge.quality',
        `Knowledge file persist failed for "${entry.title}" — aborting quality update`
      );

      if (context.userId) {
        await this._audit('update_knowledge_quality', id, context.userId, {
          score: result.score,
          grade: result.grade,
        });
      }

      this.logger.info('Knowledge quality updated', {
        id,
        score: result.score,
        grade: result.grade,
      });

      return result;
    } catch (error: unknown) {
      this.logger.error('Error updating knowledge quality', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /* ═══ 私有方法 ══════════════════════════════════════════ */

  /** 统一生命周期转换编排 */
  async _lifecycleTransition(
    id: string,
    method: string,
    context: ServiceContext,
    options: { entityArgs?: unknown[] } = {}
  ) {
    try {
      const entry = await this._findOrThrow(id);
      const prevLifecycle = entry.lifecycle;

      if (
        (method === 'publish' || method === 'restore') &&
        isRecipeRetrievalSubject(entry) &&
        isValidTransition(entry.lifecycle, Lifecycle.ACTIVE)
      ) {
        const readiness = this._evaluateRetrievalReadiness(entry);
        if (!readiness.ready) {
          throw new ValidationError('Recipe retrieval readiness blocks active transition', {
            readiness,
          });
        }
      }

      const entityArgs = options.entityArgs || [];
      const result = (
        entry as unknown as Record<
          string,
          (...args: unknown[]) => { success: boolean; error?: string }
        >
      )[method](...entityArgs);

      if (!result.success) {
        throw new ConflictError(result.error || 'Lifecycle transition failed', {
          detail: `Lifecycle ${method} failed for ${id}`,
        });
      }

      // 标记操作人到最后一条 lifecycleHistory 条目
      entry.stampLastTransition(context.userId);

      // 构建 DB 更新
      // 注意: 不在此处 JSON.stringify — repository.update() 内部
      // 通过 _entityToRow() 统一执行序列化, 传入原始值即可
      const dbUpdates: Record<string, unknown> = {
        lifecycle: entry.lifecycle,
        lifecycleHistory: entry.lifecycleHistory,
        updatedAt: entry.updatedAt,
      };

      // 审核字段
      if (entry.reviewedBy) {
        dbUpdates.reviewedBy = entry.reviewedBy;
      }
      if (entry.reviewedAt) {
        dbUpdates.reviewedAt = entry.reviewedAt;
      }
      // 驳回原因（含清除：reactivate 后 rejectionReason = null 需写入 DB）
      dbUpdates.rejectionReason = entry.rejectionReason;

      // 发布字段
      if (entry.publishedAt) {
        dbUpdates.publishedAt = entry.publishedAt;
      }
      if (entry.publishedBy) {
        dbUpdates.publishedBy = entry.publishedBy;
      }
      if (entry.autoApprovable !== undefined) {
        dbUpdates.autoApprovable = entry.autoApprovable ? 1 : 0;
      }

      const updated = await this.#persistUpdate(
        entry,
        dbUpdates,
        `knowledge.${method}`,
        `Knowledge file lifecycle move failed for "${entry.title}" — aborting DB transition`,
        'moveOnLifecycleChange'
      );

      await this._audit(`${method}_knowledge`, id, context.userId, {
        from: prevLifecycle,
        to: entry.lifecycle,
      });

      this.logger.info(`Knowledge entry ${method}`, {
        id,
        from: prevLifecycle,
        to: entry.lifecycle,
        actor: context.userId,
      });

      // EventBus: 通知生命周期状态转换（Dashboard 实时更新 + SignalBus）
      if (this._eventBus) {
        this._eventBus.emit('lifecycle:transition', {
          entryId: id,
          from: prevLifecycle,
          to: entry.lifecycle,
          method,
          actor: context.userId,
          entry: requireLegacyWriteReadback(updated, 'toJSON').toJSON(),
        });
      }

      return updated;
    } catch (error: unknown) {
      this.logger.error(`Error in lifecycle ${method}`, {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** 已读实体复用，避免为写协调再次读取；业务字段白名单和生命周期判断留在调用者。 */
  #persistUpdate(
    entry: KnowledgeEntry,
    updates: Record<string, unknown>,
    operation: string,
    fileFailureMessage: string,
    fileOperation: 'persist' | 'moveOnLifecycleChange' = 'persist'
  ) {
    // 普通编辑恢复值对象；生命周期调用者已经完成合法转换，搬移使用同一实体。
    const prospective =
      this._fileWriter && fileOperation === 'persist'
        ? KnowledgeEntry.fromJSON({ ...entry.toJSON(), ...updates })
        : entry;
    return commitKnowledgeWrite({
      entry: prospective,
      fileStore: this._fileWriter,
      operation,
      fileOperation,
      fileFailureMessage,
      commit: () => {
        // 文件写入可能改变路径，只有成功之后才能把路径交给 DB。
        if (this._fileWriter && prospective.sourceFile) {
          updates.sourceFile = prospective.sourceFile;
        }
        return this.repository.update(entry.id, updates);
      },
    });
  }

  /** 查找或抛出 NotFoundError */
  async _findOrThrow(id: string): Promise<KnowledgeEntry> {
    const entry = await this.repository.findById(id);
    if (!entry) {
      throw new NotFoundError('Knowledge entry not found', 'knowledge', id);
    }
    return entry;
  }

  _evaluateRetrievalReadiness(entry: KnowledgeEntry): RetrievalReadinessReport {
    return this._retrievalReadinessEvaluator(entry);
  }

  /** 验证创建输入 */
  _validateCreateInput(data: KnowledgeEntryProps) {
    if (!data.title || !data.title.trim()) {
      throw new ValidationError('Title is required');
    }

    // 内容至少需要 content 对象有内容
    const c = (data.content || {}) as Record<string, unknown>;
    if (
      !c.pattern &&
      !c.rationale &&
      !((c.steps as unknown[] | undefined)?.length && (c.steps as unknown[]).length > 0) &&
      !c.markdown
    ) {
      throw new ValidationError('Content is required (pattern, rationale, steps, or markdown)');
    }
  }

  /**
   * 为 QualityScorer 适配输入
   * QualityScorer v2 needs: title, trigger, description, language, category,
   * doClause, dontClause, whenClause, coreCode, usageGuide,
   * contentMarkdown, contentRationale, reasoningWhyStandard, reasoningSources,
   * reasoningConfidence, source, headers, tags, views, clicks, rating
   */
  _adaptForScorer(
    entry: KnowledgeEntry,
    grounding: { validSourcePaths: string[]; validRanges: string[] } = {
      validSourcePaths: [],
      validRanges: [],
    },
    groundingAvailable = false
  ): Record<string, unknown> {
    // 从 Stats 值对象提取 engagement 指标
    const stats =
      entry.stats && typeof entry.stats === 'object'
        ? (entry.stats as unknown as Record<string, number>)
        : ({} as Record<string, number>);
    // 从 Content 值对象提取深度字段
    const content =
      entry.content && typeof entry.content === 'object'
        ? (entry.content as unknown as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    // 从 Reasoning 值对象提取溯源字段
    const reasoning =
      entry.reasoning && typeof entry.reasoning === 'object'
        ? (entry.reasoning as unknown as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    // P0/C7: 从 Constraints 值对象提取深度维度字段(边界/前置/副作用)，供 C8 depthCoverage 判定。
    const constraints =
      entry.constraints && typeof entry.constraints === 'object'
        ? (entry.constraints as unknown as Record<string, unknown>)
        : ({} as Record<string, unknown>);

    const fields = projectKnowledgeQualityFields(entry);
    return {
      ...fields,
      // 质量重算沿用 doClause 回退；创建前路由只接受显式用法或 Markdown。
      usageGuide: fields.usageGuide || entry.doClause || '',
      views: (stats.views ?? 0) + (stats.searchHits ?? 0),
      clicks: (stats.adoptions ?? 0) + (stats.applications ?? 0) + (stats.guardHits ?? 0),
      rating: stats.authority ?? 0,
      // ── P0/C7 additive: 深度维度字段 + 真接地集(C8 depthCoverage 只在接地时计分；此阶段 scorer 尚未
      //    消费，加字段安全——旧维度不受影响)。 ──
      contentSteps: (content.steps as unknown[]) ?? [],
      contentVerification: content.verification ?? null,
      constraintsBoundaries: (constraints.boundaries as string[]) ?? [],
      constraintsPreconditions: (constraints.preconditions as string[]) ?? [],
      constraintsSideEffects: (constraints.sideEffects as string[]) ?? [],
      reasoningAlternatives: (reasoning.alternatives as string[]) ?? [],
      groundedSourcePaths: grounding.validSourcePaths,
      groundedRanges: grounding.validRanges,
      // P5/C8: 接地 port 是否就位——scorer 据此在深度加权 / legacy 公式间分流。
      groundingAvailable,
    };
  }

  /**
   * P0/C7: 从持久化 entry 组装门禁 `collectSourceRefs` 认得的最小 item——结构化 refs 落在
   * `reasoning.sources`(与 submit 期 item 同字段)。仅用于喂接地 port 重算真接地集，不参与评分字段。
   */
  _groundingItemFromEntry(entry: KnowledgeEntry): Record<string, unknown> {
    const reasoning =
      entry.reasoning && typeof entry.reasoning === 'object'
        ? (entry.reasoning as unknown as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    return {
      title: entry.title,
      reasoning: { sources: (reasoning.sources as string[]) || [] },
    };
  }

  /* ═══ Knowledge Graph 同步 ═══════════════════════════ */

  /**
   * 自动发现同 category/moduleName/tags 的已有条目并建立 'related' 边
   * @param id 新创建的条目 ID
   * @param entry 条目实体
   */
  async _autoDiscoverRelations(id: string, entry: KnowledgeEntry) {
    const gs = this._knowledgeGraphService;
    if (!gs) {
      return;
    }

    if (this.#activeDeletes.has(id)) {
      this.logger.info('Auto-discover relations skipped: deletion in progress', { id });
      return;
    }
    const task = Symbol('relations');
    this.#relationTasks.set(id, task);

    try {
      const candidates: { target: string; relation: string; weight: number }[] = [];

      // 与可消费 Recipe（active/staging/evolving）建立关联
      const consumableFilter = {
        lifecycle: [Lifecycle.ACTIVE, Lifecycle.STAGING, Lifecycle.EVOLVING],
      };

      // 按 moduleName 查同模块可消费条目
      if (entry.moduleName) {
        const sameModule = await this.repository.findWithPagination(
          { ...consumableFilter, moduleName: entry.moduleName },
          { page: 1, pageSize: 20 }
        );
        for (const r of sameModule.data) {
          if (r.id !== id) {
            candidates.push({ target: r.id, relation: 'related', weight: 0.8 });
          }
        }
      }

      // 按 category 查同类可消费条目（弱关联）
      if (entry.category && candidates.length < 10) {
        const sameCat = await this.repository.findWithPagination(
          { ...consumableFilter, category: entry.category },
          { page: 1, pageSize: 10 }
        );
        for (const r of sameCat.data) {
          if (r.id !== id && !candidates.some((c) => c.target === r.id)) {
            candidates.push({ target: r.id, relation: 'related', weight: 0.4 });
          }
        }
      }

      const selected = candidates.slice(0, 3);
      if (selected.length > 0) {
        // 查询候选期间条目可能被编辑；以最新实体合并，避免后台关联覆盖刚保存的正文。
        const current = await this.repository.findById(id);
        // 读出的实体可能在 await 期间已被删除；删除使既有任务失效，不能再用旧快照写回文件。
        if (!current || this.#relationTasks.get(id) !== task) {
          this.logger.info('Auto-discover relations skipped: entry deleted or task superseded', {
            id,
          });
          return;
        }
        const existing = current.relations.toJSON();
        const related = [...existing.related];
        for (const candidate of selected) {
          if (!related.some((relation) => relation.target === candidate.target)) {
            related.push({ target: candidate.target, description: 'auto-discovered' });
          }
        }
        await this.#persistUpdate(
          current,
          { relations: { ...existing, related }, updatedAt: Math.floor(Date.now() / 1000) },
          'knowledge.auto-relate',
          `Knowledge relation file write failed: ${id}`
        );
        // 派生边只能在关系真相成功写入后更新；addEdge 自身返回并记录失败诊断。
        for (const candidate of selected) {
          if (this.#relationTasks.get(id) !== task) {
            this.logger.info('Auto-discover edge projection cancelled by a newer mutation', { id });
            return;
          }
          await gs.addEdge(id, 'knowledge', candidate.target, 'knowledge', candidate.relation, {
            weight: candidate.weight,
          });
        }
      }
    } catch (err: unknown) {
      this.logger.warn('Auto-discover relations failed (non-blocking)', {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (this.#relationTasks.get(id) === task) {
        this.#relationTasks.delete(id);
      }
    }
  }

  /** 将 relations 同步到 knowledge_edges 表 */
  async _syncRelationsToGraph(id: string, relations: unknown) {
    const gs = this._knowledgeGraphService;
    if (!gs) {
      return;
    }

    try {
      if (this._edgeRepo) {
        await this._edgeRepo.deleteOutgoing(id, 'knowledge');
      }

      if (!relations || typeof relations !== 'object') {
        return;
      }

      // Relations 可能是 Relations 值对象或普通对象
      const relObj = (
        typeof (relations as { toJSON?: () => Record<string, unknown> }).toJSON === 'function'
          ? (relations as { toJSON: () => Record<string, unknown> }).toJSON()
          : relations
      ) as Record<string, unknown[]>;

      for (const [relType, targets] of Object.entries(relObj)) {
        if (!Array.isArray(targets)) {
          continue;
        }
        for (const t of targets) {
          const item = t as Record<string, unknown>;
          const target =
            (item.target as string) || (item.id as string) || (typeof t === 'string' ? t : null);
          const targetId = this._normalizeKnowledgeRelationTarget(target);
          if (targetId && UUID_RE.test(targetId)) {
            await gs.addEdge(id, 'knowledge', targetId, 'knowledge', relType, {
              weight: (item.weight as number) || 1.0,
              description: typeof item.description === 'string' ? item.description : '',
              source: 'knowledge-entry-relations',
            });
          }
        }
      }
    } catch (err: unknown) {
      this.logger.warn('Failed to sync relations to knowledge_edges', {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  _normalizeKnowledgeRelationTarget(target: unknown): string | null {
    if (typeof target !== 'string') {
      return null;
    }
    const trimmed = target.trim();
    if (UUID_RE.test(trimmed)) {
      return trimmed;
    }
    const knowledgeRef = trimmed.match(
      /^knowledge:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
    );
    return knowledgeRef?.[1] ?? null;
  }

  /** 删除所有关联边 */
  _removeAllEdges(id: string) {
    if (!this._edgeRepo) {
      return;
    }

    try {
      this._edgeRepo.deleteByEntryId(id).catch((error: unknown) => {
        this.logger.warn('Failed to remove edges', {
          id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    } catch (err: unknown) {
      this.logger.warn('Failed to remove edges', {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 删除关联的 evolution_proposals（target_recipe_id 无 CASCADE） */
  _removeRelatedProposals(id: string) {
    if (!this._proposalRepo) {
      return;
    }

    try {
      this._proposalRepo.deleteByTargetRecipeId(id);
    } catch (err: unknown) {
      this.logger.warn('Failed to remove related proposals', {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 兼容旧的非阻塞调用；正式删除等待同一实现完成，避免同步恢复已删除的反向引用。 */
  _removeReverseRelations(id: string) {
    void this.#removeReverseRelationsDurably(id).catch((error: unknown) => {
      this.logger.warn('Failed to remove reverse relations', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  async #removeReverseRelationsDurably(id: string): Promise<void> {
    if (typeof this.repository.findByRelationLike !== 'function') {
      // 老的独立 adapter 没有反向索引能力；保持既有行为并明确说明未做该清理。
      this.logger.warn('Reverse relation cleanup unavailable on legacy repository', { id });
      return;
    }
    for (const row of await this.repository.findByRelationLike(id, id)) {
      const parsed = JSON.parse(row.relations);
      let changed = false;
      for (const bucket of Object.keys(parsed)) {
        if (!Array.isArray(parsed[bucket])) {
          continue;
        }
        const before = parsed[bucket].length;
        parsed[bucket] = parsed[bucket].filter((relation: unknown) => {
          const target =
            typeof relation === 'string'
              ? relation
              : relation && typeof relation === 'object' && 'target' in relation
                ? relation.target
                : null;
          return target !== id && this._normalizeKnowledgeRelationTarget(target) !== id;
        });
        changed ||= parsed[bucket].length !== before;
      }
      if (changed) {
        await persistKnowledgeUpdate(
          this.repository,
          this._fileWriter,
          row.id,
          { relations: parsed },
          'knowledge.remove-reference'
        );
      }
    }
  }

  /* ═══ 文件落盘 ═════════════════════════════════ */

  /** 落盘到 .md 文件 + 回写 sourceFile */
  _persistToFile(entry: KnowledgeEntry) {
    if (!this._fileWriter) {
      return;
    }
    try {
      const oldSourceFile = entry.sourceFile;
      this._fileWriter.persist(entry);
      if (entry.sourceFile && entry.sourceFile !== oldSourceFile) {
        this.repository.update(entry.id, { sourceFile: entry.sourceFile }).catch((err: unknown) => {
          this.logger.warn('Failed to update sourceFile in DB', {
            id: entry.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    } catch (err: unknown) {
      this.logger.warn('Knowledge file persist failed (non-blocking)', {
        id: entry?.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 删除 .md 文件 */
  _removeFile(entry: KnowledgeEntry) {
    if (!this._fileWriter) {
      return;
    }
    try {
      this._fileWriter.remove(entry);
    } catch (err: unknown) {
      this.logger.warn('Knowledge file remove failed (non-blocking)', {
        id: entry?.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /* ═══ 审计日志 ═══════════════════════════════════════ */

  async _audit(
    action: string,
    id: string,
    actor: string,
    details: Record<string, unknown> | string = {}
  ) {
    try {
      await this.auditLogger.log({
        action,
        resourceType: 'knowledge',
        resourceId: id,
        resource: `knowledge:${id}`,
        actor: actor || 'system',
        result: 'success',
        details: typeof details === 'string' ? details : JSON.stringify(details),
        timestamp: Math.floor(Date.now() / 1000),
      });
    } catch (err: unknown) {
      this.logger.warn('Audit log failed (non-blocking)', {
        action,
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function isRecipeRetrievalSubject(entry: KnowledgeEntry): boolean {
  return entry.knowledgeType !== 'boundary-constraint' && entry.category !== 'guard';
}

export default KnowledgeService;
