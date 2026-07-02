/**
 * Drizzle ORM Schema — Single Source of Truth
 *
 * 所有表定义从 active migrations 忠实翻译。
 * DB 列名与 migration 保持一致；实体映射由 repository 层处理。
 *
 * 表清单 (19 个业务表 + schema_migrations):
 *   001: knowledge_entries, knowledge_edges, guard_violations, audit_logs,
 *        sessions, token_usage, semantic_memories, bootstrap_snapshots,
 *        bootstrap_dim_files, code_entities
 *   004: evolution_proposals (+ knowledge_entries.staging_deadline)
 *   005: recipe_source_refs
 *   006: lifecycle_transition_events
 *   008: recipe_warnings
 *   009: knowledge_entries.dimensionId
 *   010: source_graph_generations, source_graph_files,
 *        source_graph_symbols, source_graph_edges
 *   013: git_diff_checkpoints
 *   内部: schema_migrations
 *
 * 注: Task 系统为纯内存 + JSONL 信号架构，不使用数据库表。
 */

import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ═══════════════════════════════════════════════════════════════
// 内部 — schema_migrations
// ═══════════════════════════════════════════════════════════════

export const schemaMigrations = sqliteTable('schema_migrations', {
  version: text('version').primaryKey(),
  appliedAt: text('applied_at').notNull(),
});

// ═══════════════════════════════════════════════════════════════
// 1. knowledge_entries — 核心知识条目
// ═══════════════════════════════════════════════════════════════

export const knowledgeEntries = sqliteTable(
  'knowledge_entries',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull().default(''),
    description: text('description').default(''),

    lifecycle: text('lifecycle').notNull().default('pending'),
    lifecycleHistory: text('lifecycleHistory').default('[]'),
    autoApprovable: integer('autoApprovable').default(0),

    language: text('language').notNull().default(''),
    dimensionId: text('dimensionId').default(''),
    category: text('category').notNull().default('general'),
    kind: text('kind').default('pattern'),
    knowledgeType: text('knowledgeType').default('code-pattern'),
    complexity: text('complexity').default('intermediate'),
    scope: text('scope').default('universal'),
    difficulty: text('difficulty'),
    tags: text('tags').default('[]'),

    // 插件适配字段
    trigger: text('trigger').default(''),
    topicHint: text('topicHint').default(''),
    whenClause: text('whenClause').default(''),
    doClause: text('doClause').default(''),
    dontClause: text('dontClause').default(''),
    coreCode: text('coreCode').default(''),

    // 值对象 (JSON)
    content: text('content').default('{}'),
    relations: text('relations').default('{}'),
    constraints: text('constraints').default('{}'),
    reasoning: text('reasoning').default('{}'),
    quality: text('quality').default('{}'),
    stats: text('stats').default('{}'),

    // ObjC/Swift headers
    headers: text('headers').default('[]'),
    headerPaths: text('headerPaths').default('[]'),
    moduleName: text('moduleName').default(''),
    includeHeaders: integer('includeHeaders').default(0),

    // 宿主分析元数据
    agentNotes: text('agentNotes'),
    aiInsight: text('aiInsight'),

    // Review
    reviewedBy: text('reviewedBy'),
    reviewedAt: integer('reviewedAt'),
    rejectionReason: text('rejectionReason'),

    // Source
    source: text('source').default('agent'),
    sourceFile: text('sourceFile'),
    sourceCandidateId: text('sourceCandidateId'),

    // Timestamps
    createdBy: text('createdBy').default('agent'),
    createdAt: integer('createdAt').notNull(),
    updatedAt: integer('updatedAt').notNull(),
    publishedAt: integer('publishedAt'),
    publishedBy: text('publishedBy'),

    // Content hash
    contentHash: text('contentHash'),

    // M2: Staging support (migration 004)
    stagingDeadline: integer('staging_deadline'),
  },
  (table) => [
    index('idx_ke3_lifecycle').on(table.lifecycle),
    index('idx_ke3_language').on(table.language),
    index('idx_ke3_dimensionId').on(table.dimensionId),
    index('idx_ke3_category').on(table.category),
    index('idx_ke3_kind').on(table.kind),
    index('idx_ke3_createdAt').on(table.createdAt),
    index('idx_ke3_trigger').on(table.trigger),
    index('idx_ke3_title').on(table.title),
    index('idx_ke3_source').on(table.source),
    index('idx_ke3_guard_active').on(table.kind, table.lifecycle),
    index('idx_ke3_topicHint').on(table.topicHint),
  ]
);

// ═══════════════════════════════════════════════════════════════
// 2. knowledge_edges — 知识关系图谱边
// ═══════════════════════════════════════════════════════════════

export const knowledgeEdges = sqliteTable(
  'knowledge_edges',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fromId: text('from_id').notNull(),
    fromType: text('from_type').notNull().default('recipe'),
    toId: text('to_id').notNull(),
    toType: text('to_type').notNull().default('recipe'),
    relation: text('relation').notNull(),
    weight: real('weight').default(1.0),
    metadataJson: text('metadata_json').default('{}'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('knowledge_edges_unique').on(
      table.fromId,
      table.fromType,
      table.toId,
      table.toType,
      table.relation
    ),
    index('idx_ke_from').on(table.fromId, table.fromType),
    index('idx_ke_to').on(table.toId, table.toType),
    index('idx_ke_relation').on(table.relation),
  ]
);

// ═══════════════════════════════════════════════════════════════
// 3. guard_violations — Guard 违反记录
// ═══════════════════════════════════════════════════════════════

export const guardViolations = sqliteTable(
  'guard_violations',
  {
    id: text('id').primaryKey(),
    filePath: text('file_path').notNull(),
    triggeredAt: text('triggered_at').notNull(),
    violationCount: integer('violation_count').default(0),
    summary: text('summary'),
    violationsJson: text('violations_json').default('[]'),
    createdAt: integer('created_at').notNull(),
    // Writer attribution (migration 011): which tool/surface wrote the row.
    // Nullable — pre-011 rows and writers that don't know their tool stay NULL.
    tool: text('tool'),
    surface: text('surface'),
  },
  (table) => [
    index('idx_guard_violations_file').on(table.filePath),
    index('idx_guard_violations_time').on(table.triggeredAt),
  ]
);

// ═══════════════════════════════════════════════════════════════
// 4. audit_logs — 审计日志
// ═══════════════════════════════════════════════════════════════

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    timestamp: integer('timestamp').notNull(),
    actor: text('actor').notNull(),
    actorContext: text('actor_context').default('{}'),
    action: text('action').notNull(),
    resource: text('resource'),
    operationData: text('operation_data').default('{}'),
    result: text('result').notNull(),
    errorMessage: text('error_message'),
    duration: integer('duration'),
  },
  (table) => [
    index('idx_audit_actor').on(table.actor),
    index('idx_audit_action').on(table.action),
    index('idx_audit_result').on(table.result),
    index('idx_audit_timestamp').on(table.timestamp),
  ]
);

// ═══════════════════════════════════════════════════════════════
// 5. sessions — 会话管理
// ═══════════════════════════════════════════════════════════════

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    scope: text('scope').notNull(),
    scopeId: text('scope_id'),
    context: text('context').default('{}'),
    metadata: text('metadata').default('{}'),
    actor: text('actor'),
    createdAt: integer('created_at').notNull(),
    lastActiveAt: integer('last_active_at'),
    expiredAt: integer('expired_at'),
  },
  (table) => [
    index('idx_sessions_scope').on(table.scope),
    index('idx_sessions_actor').on(table.actor),
    index('idx_sessions_expired').on(table.expiredAt),
  ]
);

// ═══════════════════════════════════════════════════════════════
// 6. token_usage — AI Token 消耗记录
// ═══════════════════════════════════════════════════════════════

export const tokenUsage = sqliteTable(
  'token_usage',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    timestamp: integer('timestamp').notNull(),
    source: text('source').notNull().default('unknown'),
    dimension: text('dimension'),
    provider: text('provider'),
    model: text('model'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    durationMs: integer('duration_ms'),
    toolCalls: integer('tool_calls').default(0),
    sessionId: text('session_id'),
  },
  (table) => [
    index('idx_token_usage_timestamp').on(table.timestamp),
    index('idx_token_usage_source').on(table.source),
  ]
);

// ═══════════════════════════════════════════════════════════════
// 7. semantic_memories — 项目级语义记忆
// ═══════════════════════════════════════════════════════════════

export const semanticMemories = sqliteTable(
  'semantic_memories',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull().default('fact'),
    content: text('content').notNull().default(''),
    source: text('source').notNull().default('bootstrap'),
    importance: real('importance').notNull().default(5.0),
    accessCount: integer('access_count').notNull().default(0),
    lastAccessedAt: text('last_accessed_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    expiresAt: text('expires_at'),
    relatedEntities: text('related_entities').default('[]'),
    relatedMemories: text('related_memories').default('[]'),
    sourceDimension: text('source_dimension'),
    sourceEvidence: text('source_evidence'),
    bootstrapSession: text('bootstrap_session'),
    tags: text('tags').default('[]'),
  },
  (table) => [
    index('idx_semantic_memories_type').on(table.type),
    index('idx_semantic_memories_source').on(table.source),
    index('idx_semantic_memories_importance').on(table.importance),
    index('idx_semantic_memories_updated_at').on(table.updatedAt),
    index('idx_semantic_memories_source_dimension').on(table.sourceDimension),
  ]
);

// ═══════════════════════════════════════════════════════════════
// 8. bootstrap_snapshots — Bootstrap 快照主表
// ═══════════════════════════════════════════════════════════════

export const generateSnapshots = sqliteTable(
  'bootstrap_snapshots',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id'),
    projectRoot: text('project_root').notNull(),
    createdAt: text('created_at').notNull(),
    durationMs: integer('duration_ms').default(0),
    fileCount: integer('file_count').default(0),
    dimensionCount: integer('dimension_count').default(0),
    candidateCount: integer('candidate_count').default(0),
    primaryLang: text('primary_lang'),
    fileHashes: text('file_hashes').notNull().default('{}'),
    dimensionMeta: text('dimension_meta').notNull().default('{}'),
    episodicData: text('episodic_data'),
    isIncremental: integer('is_incremental').default(0),
    parentId: text('parent_id'),
    changedFiles: text('changed_files').default('[]'),
    affectedDims: text('affected_dims').default('[]'),
    status: text('status').default('complete'),
  },
  (table) => [
    index('idx_snapshots_project').on(table.projectRoot, table.createdAt),
    index('idx_snapshots_status').on(table.status),
  ]
);

// ═══════════════════════════════════════════════════════════════
// 9. bootstrap_dim_files — 维度-文件关联表
// ═══════════════════════════════════════════════════════════════

export const generateDimFiles = sqliteTable(
  'bootstrap_dim_files',
  {
    snapshotId: text('snapshot_id')
      .notNull()
      .references(() => generateSnapshots.id, { onDelete: 'cascade' }),
    dimId: text('dim_id').notNull(),
    filePath: text('file_path').notNull(),
    role: text('role').default('referenced'),
  },
  (table) => [
    // composite primary key emulated via unique index
    uniqueIndex('bootstrap_dim_files_pk').on(table.snapshotId, table.dimId, table.filePath),
    index('idx_dim_files_file').on(table.filePath),
    index('idx_dim_files_dim').on(table.dimId),
  ]
);

// ═══════════════════════════════════════════════════════════════
// 10. code_entities — 代码实体节点 (AST)
// ═══════════════════════════════════════════════════════════════

export const codeEntities = sqliteTable(
  'code_entities',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    entityId: text('entity_id').notNull(),
    entityType: text('entity_type').notNull(),
    projectRoot: text('project_root').notNull(),
    name: text('name').notNull(),
    filePath: text('file_path'),
    lineNumber: integer('line_number'),
    superclass: text('superclass'),
    protocols: text('protocols').default('[]'),
    metadataJson: text('metadata_json').default('{}'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('code_entities_unique').on(table.entityId, table.entityType, table.projectRoot),
    index('idx_ce_project').on(table.projectRoot),
    index('idx_ce_type').on(table.entityType),
    index('idx_ce_name').on(table.name),
    index('idx_ce_file').on(table.filePath),
    index('idx_ce_superclass').on(table.superclass),
  ]
);

// ═══════════════════════════════════════════════════════════════
// 11. evolution_proposals — 知识进化提案 (M2 Recipe 治理)
// ═══════════════════════════════════════════════════════════════

export const evolutionProposals = sqliteTable(
  'evolution_proposals',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    targetRecipeId: text('target_recipe_id').notNull(),
    relatedRecipeIds: text('related_recipe_ids').default('[]'),
    confidence: real('confidence').notNull().default(0),
    source: text('source').notNull(),
    description: text('description').default(''),
    evidence: text('evidence').default('[]'),
    status: text('status').notNull().default('pending'),
    proposedAt: integer('proposed_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    resolvedAt: integer('resolved_at'),
    resolvedBy: text('resolved_by'),
    resolution: text('resolution'),
  },
  (table) => [
    index('idx_ep_status').on(table.status),
    index('idx_ep_target').on(table.targetRecipeId),
    index('idx_ep_expires').on(table.expiresAt),
    index('idx_ep_source').on(table.source),
  ]
);

// ═══════════════════════════════════════════════════════════════
// 12. recipe_source_refs — Recipe 来源引用桥接表 (可信度证据链)
// ═══════════════════════════════════════════════════════════════

export const recipeSourceRefs = sqliteTable(
  'recipe_source_refs',
  {
    recipeId: text('recipe_id').notNull(),
    sourcePath: text('source_path').notNull(),
    status: text('status').notNull().default('active'),
    newPath: text('new_path'),
    verifiedAt: integer('verified_at').notNull(),
    // U6 内容级保鲜：源文件 region 内容指纹（独立于 .md 的 computeKnowledgeHash）。
    // 可空：migration 后全 NULL，由 SourceRefReconciler 首轮 reconcile 回填（CG⑥a：首填只回填不改 status）。
    contentFp: text('content_fp'),
  },
  (table) => [index('idx_rsr_path').on(table.sourcePath), index('idx_rsr_status').on(table.status)]
);

// ═══════════════════════════════════════════════════════════════
// 13. lifecycle_transition_events — Recipe 生命周期转移事件 (migration 006)
// ═══════════════════════════════════════════════════════════════

export const lifecycleTransitionEvents = sqliteTable(
  'lifecycle_transition_events',
  {
    id: text('id').primaryKey(),
    recipeId: text('recipe_id').notNull(),
    fromState: text('from_state').notNull(),
    toState: text('to_state').notNull(),
    trigger: text('trigger').notNull(),
    operatorId: text('operator_id').notNull().default('system'),
    evidenceJson: text('evidence_json'),
    proposalId: text('proposal_id'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_lte_recipe_id').on(table.recipeId),
    index('idx_lte_created_at').on(table.createdAt),
    index('idx_lte_trigger').on(table.trigger),
  ]
);

// ═══════════════════════════════════════════════════════════════
// 14. recipe_warnings — 知识新陈代谢警告持久化 (migration 008)
// ═══════════════════════════════════════════════════════════════

export const recipeWarnings = sqliteTable(
  'recipe_warnings',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    targetRecipeId: text('target_recipe_id').notNull(),
    relatedRecipeIds: text('related_recipe_ids').notNull().default('[]'),
    confidence: real('confidence').notNull().default(0),
    description: text('description').notNull().default(''),
    evidence: text('evidence').notNull().default('[]'),
    status: text('status').notNull().default('open'),
    detectedAt: integer('detected_at').notNull(),
    resolvedAt: integer('resolved_at'),
    resolvedBy: text('resolved_by'),
    resolution: text('resolution'),
  },
  (table) => [
    index('idx_rw_target').on(table.targetRecipeId),
    index('idx_rw_type').on(table.type),
    index('idx_rw_status').on(table.status),
    index('idx_rw_detected').on(table.detectedAt),
  ]
);

// ═══════════════════════════════════════════════════════════════
// 16. source_graph_generations — deterministic source graph snapshots
// ═══════════════════════════════════════════════════════════════

export const sourceGraphGenerations = sqliteTable(
  'source_graph_generations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    generationId: text('generation_id').notNull(),
    projectRoot: text('project_root').notNull(),
    repoId: text('repo_id').notNull().default('default'),
    graphRoot: text('graph_root').notNull(),
    projectScope: text('project_scope'),
    status: text('status').notNull().default('indexed'),
    extractionVersion: text('extraction_version').notNull().default('source-graph-v1'),
    startedAt: integer('started_at').notNull(),
    completedAt: integer('completed_at'),
    indexedAt: integer('indexed_at'),
    freshnessStatus: text('freshness_status').notNull().default('fresh'),
    freshnessCheckedAt: integer('freshness_checked_at').notNull(),
    freshnessReason: text('freshness_reason'),
    freshnessNextAction: text('freshness_next_action'),
    pendingFileCount: integer('pending_file_count').notNull().default(0),
    staleFileCount: integer('stale_file_count').notNull().default(0),
    degradedReason: text('degraded_reason'),
    languageCoverageJson: text('language_coverage_json').notNull().default('[]'),
    fileCount: integer('file_count').notNull().default(0),
    symbolCount: integer('symbol_count').notNull().default(0),
    edgeCount: integer('edge_count').notNull().default(0),
    parseErrorCount: integer('parse_error_count').notNull().default(0),
    metadataJson: text('metadata_json').notNull().default('{}'),
  },
  (table) => [
    uniqueIndex('source_graph_generations_generation_unique').on(table.generationId),
    index('idx_sgg_project').on(table.projectRoot, table.repoId),
    index('idx_sgg_status').on(table.status),
    index('idx_sgg_indexed_at').on(table.indexedAt),
  ]
);

// ═══════════════════════════════════════════════════════════════
// 17. source_graph_files — indexed source files per generation
// ═══════════════════════════════════════════════════════════════

export const sourceGraphFiles = sqliteTable(
  'source_graph_files',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    generationId: text('generation_id').notNull(),
    projectRoot: text('project_root').notNull(),
    repoRelativePath: text('repo_relative_path').notNull(),
    language: text('language').notNull().default('unknown'),
    contentHash: text('content_hash').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    mtimeMs: integer('mtime_ms').notNull().default(0),
    indexedAt: integer('indexed_at').notNull(),
    classification: text('classification').notNull().default('source'),
    parseStatus: text('parse_status').notNull().default('parsed'),
    parseErrorsJson: text('parse_errors_json').notNull().default('[]'),
    lineCount: integer('line_count'),
    metadataJson: text('metadata_json').notNull().default('{}'),
  },
  (table) => [
    uniqueIndex('source_graph_files_generation_path_unique').on(
      table.generationId,
      table.repoRelativePath
    ),
    index('idx_sgf_project_path').on(table.projectRoot, table.repoRelativePath),
    index('idx_sgf_generation').on(table.generationId),
    index('idx_sgf_hash').on(table.contentHash),
    index('idx_sgf_classification').on(table.classification),
    index('idx_sgf_parse_status').on(table.parseStatus),
  ]
);

// ═══════════════════════════════════════════════════════════════
// 18. source_graph_symbols — source symbols per generation
// ═══════════════════════════════════════════════════════════════

export const sourceGraphSymbols = sqliteTable(
  'source_graph_symbols',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    generationId: text('generation_id').notNull(),
    projectRoot: text('project_root').notNull(),
    symbolId: text('symbol_id').notNull(),
    displayName: text('display_name').notNull(),
    qualifiedName: text('qualified_name'),
    kind: text('kind').notNull(),
    filePath: text('file_path').notNull(),
    startLine: integer('start_line').notNull(),
    startColumn: integer('start_column').notNull().default(0),
    endLine: integer('end_line').notNull(),
    endColumn: integer('end_column').notNull().default(0),
    selectionStartLine: integer('selection_start_line'),
    selectionStartColumn: integer('selection_start_column'),
    selectionEndLine: integer('selection_end_line'),
    selectionEndColumn: integer('selection_end_column'),
    signature: text('signature'),
    containerSymbolId: text('container_symbol_id'),
    exported: integer('exported').notNull().default(0),
    imported: integer('imported').notNull().default(0),
    metadataJson: text('metadata_json').notNull().default('{}'),
    provenanceJson: text('provenance_json').notNull().default('{}'),
  },
  (table) => [
    uniqueIndex('source_graph_symbols_generation_symbol_unique').on(
      table.generationId,
      table.symbolId
    ),
    index('idx_sgs_project').on(table.projectRoot),
    index('idx_sgs_generation').on(table.generationId),
    index('idx_sgs_file').on(table.filePath),
    index('idx_sgs_kind').on(table.kind),
    index('idx_sgs_display_name').on(table.displayName),
    index('idx_sgs_container').on(table.containerSymbolId),
  ]
);

// ═══════════════════════════════════════════════════════════════
// 19. source_graph_edges — deterministic and heuristic source relations
// ═══════════════════════════════════════════════════════════════

export const sourceGraphEdges = sqliteTable(
  'source_graph_edges',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    generationId: text('generation_id').notNull(),
    projectRoot: text('project_root').notNull(),
    edgeId: text('edge_id').notNull(),
    kind: text('kind').notNull(),
    fromSymbolId: text('from_symbol_id'),
    toSymbolId: text('to_symbol_id'),
    fromFilePath: text('from_file_path'),
    toFilePath: text('to_file_path'),
    siteFilePath: text('site_file_path'),
    siteStartLine: integer('site_start_line'),
    siteStartColumn: integer('site_start_column'),
    siteEndLine: integer('site_end_line'),
    siteEndColumn: integer('site_end_column'),
    provenance: text('provenance').notNull().default('deterministic'),
    confidence: real('confidence').notNull().default(1),
    source: text('source'),
    metadataJson: text('metadata_json').notNull().default('{}'),
  },
  (table) => [
    uniqueIndex('source_graph_edges_generation_edge_unique').on(table.generationId, table.edgeId),
    index('idx_sge_project').on(table.projectRoot),
    index('idx_sge_generation').on(table.generationId),
    index('idx_sge_kind').on(table.kind),
    index('idx_sge_from_symbol').on(table.fromSymbolId),
    index('idx_sge_to_symbol').on(table.toSymbolId),
    index('idx_sge_from_file').on(table.fromFilePath),
    index('idx_sge_to_file').on(table.toFilePath),
    index('idx_sge_provenance').on(table.provenance),
  ]
);

// ═══════════════════════════════════════════════════════════════
// 20. git_diff_checkpoints — durable git diff route checkpoints (migration 013)
// ═══════════════════════════════════════════════════════════════

export const gitDiffCheckpoints = sqliteTable(
  'git_diff_checkpoints',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectRoot: text('project_root').notNull(),
    scopeId: text('scope_id').notNull(),
    folderId: text('folder_id').notNull(),
    checkpointCommit: text('checkpoint_commit'),
    initialFromPlanCommit: text('initial_from_plan_commit'),
    mergeBaseCommit: text('merge_base_commit'),
    targetCommit: text('target_commit'),
    lastRouteStatus: text('last_route_status').notNull().default('initialized'),
    lastRouteReason: text('last_route_reason'),
    lastScannedAt: integer('last_scanned_at'),
    advancedAt: integer('advanced_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('git_diff_checkpoints_scope_unique').on(
      table.projectRoot,
      table.scopeId,
      table.folderId
    ),
    index('idx_git_diff_checkpoints_project').on(table.projectRoot),
    index('idx_git_diff_checkpoints_updated_at').on(table.updatedAt),
  ]
);

// ═══════════════════════════════════════════════════════════════
// 21. coverage_ledger — deepMining 多轮覆盖账本 (migration 015)
//     per module×dimension cell 覆盖状态持久化；刻意不含计划/会话字段（U2 红线）。
// ═══════════════════════════════════════════════════════════════

export const coverageLedger = sqliteTable(
  'coverage_ledger',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectRoot: text('project_root').notNull(),
    moduleId: text('module_id').notNull(),
    dimensionId: text('dimension_id').notNull(),
    coveredCount: integer('covered_count').notNull().default(0),
    totalCandidateCount: integer('total_candidate_count').notNull().default(0),
    grade: text('grade').notNull().default('empty'),
    exhausted: integer('exhausted', { mode: 'boolean' }).notNull().default(false),
    exhaustedReason: text('exhausted_reason'),
    exhaustedSource: text('exhausted_source'),
    coveredSourceRefs: text('covered_source_refs', { mode: 'json' }).$type<string[]>(),
    uncoveredHints: text('uncovered_hints', { mode: 'json' }).$type<string[]>(),
    valueScore: real('value_score'),
    lastRound: integer('last_round'),
    deferred: integer('deferred', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('coverage_ledger_cell_unique').on(
      table.projectRoot,
      table.moduleId,
      table.dimensionId
    ),
    index('idx_coverage_ledger_project').on(table.projectRoot),
    index('idx_coverage_ledger_module').on(table.projectRoot, table.moduleId),
  ]
);

// ═══════════════════════════════════════════════════════════════
// 22. deep_mining_rounds — deepMining 轮次边际产出 (migration 015/016)
//     供 CoverageLedgerAdvisor 判收益递减/轮次上限；rescan_id 只做运行对账/幂等键。
// ═══════════════════════════════════════════════════════════════

export const deepMiningRounds = sqliteTable(
  'deep_mining_rounds',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectRoot: text('project_root').notNull(),
    rescanId: text('rescan_id'),
    roundIndex: integer('round_index').notNull(),
    startedAt: integer('started_at'),
    completedAt: integer('completed_at'),
    newRecipesThisRound: integer('new_recipes_this_round').notNull().default(0),
    triggerActor: text('trigger_actor'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('deep_mining_rounds_unique').on(table.projectRoot, table.roundIndex),
    index('idx_deep_mining_rounds_project').on(table.projectRoot),
  ]
);
