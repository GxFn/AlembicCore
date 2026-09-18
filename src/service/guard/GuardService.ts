import { v4 as uuidv4 } from 'uuid';
import { KnowledgeEntry } from '../../domain/knowledge/KnowledgeEntry.js';
import { isSqliteBusyError } from '../../infrastructure/database/DatabaseConnection.js';
import Logger from '../../infrastructure/logging/Logger.js';
import type { KnowledgeFileStore } from '../../repository/knowledge/KnowledgeFileStore.js';
import { FileWriteError } from '../../repository/knowledge/KnowledgeUnitOfWork.js';
import { CORE_DIAGNOSTIC_CODES } from '../../shared/DiagnosticCodes.js';
import {
  ConflictError,
  DivergenceError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/index.js';
import { unixNow } from '../../shared/utils/common.js';
import { persistKnowledgeUpdate } from '../knowledge/persistKnowledgeUpdate.js';

interface KnowledgeRepositoryLike {
  create(entry: unknown): Promise<{ id: string; title?: string }>;
  findById(id: string): Promise<{
    id: string;
    title?: string;
    lifecycle?: string;
    constraints?: { guards?: { pattern?: string; severity?: string; message?: string }[] };
  } | null>;
  update(id: string, data: Record<string, unknown>): Promise<unknown>;
  findActiveRules(): Promise<
    {
      id: string;
      title: string;
      language?: string;
      constraints?: { guards?: { pattern: string; severity?: string; message?: string }[] };
    }[]
  >;
  findWithPagination(
    filter: Record<string, string>,
    opts: { page: number; pageSize: number }
  ): Promise<unknown>;
  search(
    keyword: string,
    opts: { page: number; pageSize: number }
  ): Promise<{ data: { kind: string; knowledgeType: string }[]; total: number }>;
  getStats(): Promise<unknown>;
}

interface AuditLoggerLike {
  log(entry: Record<string, unknown>): Promise<void>;
}

interface GuardCheckEngineLike {
  clearCache?(): void;
  checkCode(
    code: string,
    language: string,
    options?: Record<string, unknown>
  ): {
    ruleId: string;
    severity?: string;
    message?: string;
    line?: number;
    snippet?: string;
    fixSuggestion?: string;
    reasoning?: Record<string, unknown>;
  }[];
}

interface CreateRuleData {
  name: string;
  description: string;
  pattern?: string;
  languages?: string[];
  category?: string;
  severity?: string;
  note?: string;
  sourceReason?: string;
  type?: string;
  astQuery?: { queryType: string; params?: Record<string, string> };
  fixSuggestion?: string;
}

interface ActionContext {
  userId: string;
}

/**
 * GuardService
 * 管理 Guard 约束规则的生命周期 (V3: 使用 KnowledgeEntry / knowledgeRepository)
 * Guard 规则 = kind='rule' + knowledgeType='boundary-constraint' 的 KnowledgeEntry,
 * 具体 pattern 存在 constraints.guards[] 里
 */
export class GuardService {
  #fileStore: KnowledgeFileStore | null;
  _engine: GuardCheckEngineLike | null;
  auditLogger: AuditLoggerLike;
  gateway: unknown;
  knowledgeRepository: KnowledgeRepositoryLike;
  logger: ReturnType<typeof Logger.getInstance>;
  /**
   * @param [deps] 可选依赖注入
   * @param [deps.guardCheckEngine] 核心引擎实例
   * @param [deps.fileStore] 正式宿主的文件真相写入器；省略时保留旧 DB-only 行为并诊断
   */
  constructor(
    knowledgeRepository: KnowledgeRepositoryLike,
    auditLogger: AuditLoggerLike,
    gateway: unknown,
    deps: { guardCheckEngine?: GuardCheckEngineLike; fileStore?: KnowledgeFileStore } = {}
  ) {
    this.knowledgeRepository = knowledgeRepository;
    this.auditLogger = auditLogger;
    this.gateway = gateway;
    this.logger = Logger.getInstance();
    this._engine = deps.guardCheckEngine || null;
    this.#fileStore = deps.fileStore ?? null;
  }

  /** 创建新规则 → 创建一个 kind=rule, knowledgeType=boundary-constraint 的 KnowledgeEntry */
  async createRule(data: CreateRuleData, context: ActionContext) {
    try {
      this._validateCreateInput(data);

      const entry = KnowledgeEntry.fromJSON({
        id: uuidv4(),
        title: data.name,
        description: data.description,
        language: (data.languages || [])[0] || '',
        category: data.category || 'guard',
        kind: 'rule',
        knowledgeType: 'boundary-constraint',
        content: {
          // AST 约束本身就是规则正文；不能要求冗余 regex 或虚构占位代码才能入库。
          ...(data.type === 'ast'
            ? {
                markdown: `${data.description}\n\n\`\`\`json\n${JSON.stringify(data.astQuery, null, 2)}\n\`\`\``,
              }
            : { pattern: data.pattern || '' }),
          rationale: data.note || data.sourceReason || '',
        },
        constraints: {
          boundaries: [],
          preconditions: [],
          sideEffects: [],
          guards: [
            {
              ...(data.pattern ? { pattern: data.pattern } : {}),
              severity: data.severity || 'warning',
              message: data.description || '',
              type: data.type || 'regex',
              ...(data.astQuery ? { ast_query: data.astQuery } : {}),
              ...(data.fixSuggestion ? { fix_suggestion: data.fixSuggestion } : {}),
            },
          ],
        },
        tags: data.languages || [],
        lifecycle: 'active',
        createdBy: context.userId,
      });

      const created = await this.#createEntry(entry);
      this._engine?.clearCache?.();

      await this.auditLogger.log({
        action: 'create_guard_rule',
        resourceType: 'knowledge_entry',
        resourceId: created.id,
        actor: context.userId,
        details: `Created guard rule: ${data.name}`,
        timestamp: unixNow(),
      });

      return created;
    } catch (error: unknown) {
      this.logger.error('Error creating guard rule', { error: (error as Error).message, data });
      throw error;
    }
  }

  /** 启用规则（将 lifecycle 设为 active） */
  async enableRule(ruleId: string, context: ActionContext) {
    try {
      const entry = await this.knowledgeRepository.findById(ruleId);
      if (!entry) {
        throw new NotFoundError('Guard rule not found', 'knowledge_entry', ruleId);
      }
      if (entry.lifecycle === 'active') {
        throw new ConflictError('Rule is already enabled', {
          reason: 'Cannot enable an already enabled rule',
        });
      }

      await this.#updateEntry(ruleId, { lifecycle: 'active' }, 'guard.enable');

      await this.auditLogger.log({
        action: 'enable_guard_rule',
        resourceType: 'knowledge_entry',
        resourceId: ruleId,
        actor: context.userId,
        details: `Enabled guard rule: ${entry.title}`,
        timestamp: unixNow(),
      });

      return this.knowledgeRepository.findById(ruleId);
    } catch (error: unknown) {
      this.logger.error('Error enabling guard rule', { ruleId, error: (error as Error).message });
      throw error;
    }
  }

  /** 禁用规则（将 lifecycle 设为 deprecated） */
  async disableRule(ruleId: string, reason: string, context: ActionContext) {
    try {
      const entry = await this.knowledgeRepository.findById(ruleId);
      if (!entry) {
        throw new NotFoundError('Guard rule not found', 'knowledge_entry', ruleId);
      }
      if (entry.lifecycle === 'deprecated') {
        throw new ConflictError('Rule is already disabled', {
          reason: 'Cannot disable an already disabled rule',
        });
      }

      if (!reason || reason.trim().length === 0) {
        throw new ValidationError('Disable reason is required');
      }

      await this.#updateEntry(
        ruleId,
        {
          lifecycle: 'deprecated',
          rejectionReason: reason,
        },
        'guard.disable'
      );

      await this.auditLogger.log({
        action: 'disable_guard_rule',
        resourceType: 'knowledge_entry',
        resourceId: ruleId,
        actor: context.userId,
        details: `Disabled guard rule: ${reason}`,
        timestamp: unixNow(),
      });

      return this.knowledgeRepository.findById(ruleId);
    } catch (error: unknown) {
      this.logger.error('Error disabling guard rule', { ruleId, error: (error as Error).message });
      throw error;
    }
  }

  /** 旧构造保留 DB-only；宿主注入 writer 后，新规则先写文件，DB 失败显式报告可修复分歧。 */
  async #createEntry(entry: KnowledgeEntry) {
    if (!this.#fileStore) {
      this.logger.warn('Guard creation uses legacy DB-only persistence: fileStore not configured', {
        entryId: entry.id,
        operation: 'guard.create',
      });
      return this.knowledgeRepository.create(entry);
    }
    try {
      if (this.#fileStore.persist(entry) === null) {
        throw new Error('Knowledge file store returned null');
      }
    } catch (error) {
      this.logger.error('Guard creation aborted before DB insert: file persistence failed', {
        entryId: entry.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new FileWriteError(`Knowledge file write failed during guard.create: ${entry.id}`, {
        cause: error,
      });
    }
    try {
      const created = await this.knowledgeRepository.create(entry);
      if (created?.id !== entry.id) {
        throw new Error(
          `KNOWLEDGE_CREATE_READBACK_MISMATCH: expected=${entry.id}, actual=${created?.id ?? 'missing'}`
        );
      }
      return created;
    } catch (error) {
      const details = {
        code: CORE_DIAGNOSTIC_CODES.knowledgeFileDbDivergence,
        entryIds: [entry.id],
        fileOpsCompleted: 1,
        operation: 'guard.create',
        reconcileVia: 'KnowledgeSyncService.sync',
        sqliteBusy: isSqliteBusyError(error),
      };
      this.logger.error('Guard creation left file/DB divergence', {
        ...details,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DivergenceError(
        'Guard file persisted but DB insert failed — run knowledge sync to rebuild DB truth',
        details,
        { cause: error }
      );
    }
  }

  async #updateEntry(id: string, updates: Record<string, unknown>, operation: string) {
    // 旧结构化 repository 可返回 void；只有启用 file-first 的新路径要求完整实体读回。
    // 不能把旧接口的局部 DTO 伪装成 KnowledgeEntry，否则会覆盖未读出的知识字段。
    await persistKnowledgeUpdate(
      {
        findById: async (entryId) => {
          const entry = await this.knowledgeRepository.findById(entryId);
          if (entry === null || entry instanceof KnowledgeEntry) {
            return entry;
          }
          throw new ValidationError(
            'Guard file-first mutation requires a complete KnowledgeEntry',
            {
              entryId,
              operation,
            }
          );
        },
        update: async (entryId, data) => {
          const saved = await this.knowledgeRepository.update(
            entryId,
            data instanceof KnowledgeEntry ? data.toJSON() : data
          );
          return saved instanceof KnowledgeEntry ? saved : null;
        },
      },
      this.#fileStore,
      id,
      updates,
      operation
    );
    this._engine?.clearCache?.();
  }

  /**
   * 检查代码是否匹配 Guard 规则
   * 优先代理到 GuardCheckEngine（完整管线: 内置 + DB + EP + Code-Level + AST），
   * 若引擎不可用则降级为仅 DB 规则的简化检查
   */
  async checkCode(code: string, options: { language?: string | null } = {}) {
    try {
      if (!code || code.trim().length === 0) {
        throw new ValidationError('Code is required');
      }

      const { language = null } = options;

      // ── 优先路径: 代理到 GuardCheckEngine（完整管线）──
      if (this._engine) {
        try {
          const violations = this._engine.checkCode(code, language || 'unknown', {
            scope: 'file',
          });
          return violations.map((v) => ({
            ruleId: v.ruleId,
            ruleName: v.ruleId,
            severity: v.severity || 'warning',
            message: v.message || '',
            line: v.line,
            snippet: v.snippet,
            matchCount: 1,
            ...(v.fixSuggestion ? { fixSuggestion: v.fixSuggestion } : {}),
            ...(v.reasoning ? { reasoning: v.reasoning } : {}),
          }));
        } catch (engineErr: unknown) {
          this.logger.debug('GuardCheckEngine.checkCode failed, falling back to DB-only check', {
            error: (engineErr as Error).message,
          });
        }
      }

      // ── 降级路径: 仅 DB 规则简化检查 ──
      return this._checkCodeDbOnly(code, { language });
    } catch (error: unknown) {
      this.logger.error('Error checking code against rules', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * 仅 DB 规则的简化检查（降级路径）
   */
  private async _checkCodeDbOnly(code: string, options: { language?: string | null } = {}) {
    const { language = null } = options;

    // V3: 使用 findActiveRules() 查询 kind='rule' + lifecycle='active'
    let guardEntries = await this.knowledgeRepository.findActiveRules();

    // 按语言过滤
    if (language) {
      guardEntries = guardEntries.filter((e) => !e.language || e.language === language);
    }

    const matches: {
      ruleId: string;
      ruleName: string;
      severity: string;
      message: string;
      matches: { match: string; index: number | undefined; line: number }[];
      matchCount: number;
    }[] = [];
    for (const entry of guardEntries) {
      const guards = entry.constraints?.guards || [];
      for (const guard of guards) {
        if (!guard.pattern) {
          // DB-only 降级没有 AST 执行器；缺失 regex 不能被 RegExp(undefined) 当作空匹配。
          this.logger.debug('DB-only Guard skipped rule without a regex pattern', {
            entryId: entry.id,
          });
          continue;
        }
        try {
          const regex = new RegExp(guard.pattern, 'gm');
          const codeMatches = [...code.matchAll(regex)];
          if (codeMatches.length > 0) {
            matches.push({
              ruleId: entry.id,
              ruleName: entry.title,
              severity: guard.severity || 'warning',
              message: guard.message || '',
              matches: codeMatches.map((m) => ({
                match: m[0],
                index: m.index,
                line: code.substring(0, m.index).split('\n').length,
              })),
              matchCount: codeMatches.length,
            });
          }
        } catch (e: unknown) {
          this.logger.warn('Error matching guard pattern', {
            entryId: entry.id,
            error: (e as Error).message,
          });
        }
      }
    }

    return matches;
  }

  /** 查询规则列表 (kind='rule' + knowledgeType='boundary-constraint') */
  async listRules(
    filters: Record<string, unknown> = {},
    pagination: { page?: number; pageSize?: number } = {}
  ) {
    try {
      const { page = 1, pageSize = 20 } = pagination;
      return this.knowledgeRepository.findWithPagination(
        { kind: 'rule', knowledgeType: 'boundary-constraint' },
        { page, pageSize }
      );
    } catch (error: unknown) {
      this.logger.error('Error listing rules', { error: (error as Error).message, filters });
      throw error;
    }
  }

  /** 搜索规则 */
  async searchRules(keyword: string, pagination: { page?: number; pageSize?: number } = {}) {
    try {
      const { page = 1, pageSize = 20 } = pagination;
      const result = await this.knowledgeRepository.search(keyword, { page, pageSize });
      result.data = (result.data || []).filter(
        (r) => r.kind === 'rule' && r.knowledgeType === 'boundary-constraint'
      );
      result.total = result.data.length;
      return result;
    } catch (error: unknown) {
      this.logger.error('Error searching rules', { keyword, error: (error as Error).message });
      throw error;
    }
  }

  /** 获取规则统计 */
  async getRuleStats() {
    try {
      return this.knowledgeRepository.getStats();
    } catch (error: unknown) {
      this.logger.error('Error getting rule stats', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * 验证创建输入
   * type='regex' 时 pattern 必须提供；type='ast' 时 astQuery 必须提供
   */
  _validateCreateInput(data: CreateRuleData) {
    if (!data.name || data.name.trim().length === 0) {
      throw new ValidationError('Rule name is required');
    }
    if (!data.description || data.description.trim().length === 0) {
      throw new ValidationError('Rule description is required');
    }

    const ruleType = data.type || 'regex';
    if (ruleType === 'ast') {
      if (!data.astQuery || !data.astQuery.queryType) {
        throw new ValidationError('AST query with queryType is required for type=ast rules');
      }
    } else {
      if (!data.pattern || data.pattern.trim().length === 0) {
        throw new ValidationError('Pattern is required for regex rules');
      }
    }
  }
}

export default GuardService;
