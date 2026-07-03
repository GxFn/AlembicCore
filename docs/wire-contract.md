# Wire 契约冻结表(Recipe pipeline 概念层重命名的保留名单)

- 生效:2026-07-02(Recipe 全链路统一重构 S4;设计:workspace `Design/docs/current/alembic-recipe-pipeline-unification-2026-07-02.md`)
- 语义:下列名字是**机器读的跨进程/持久化契约**,概念层重命名(bootstrap→Generate、evolution 重载消歧等)**不改它们**。每项标注所属概念层新名。改动本表任一项=显式产品决策,需数据迁移/别名兼容方案。
- 概念四环:Plan(规划)→ Generate(生成)→ Curate(甄选)→ Sustain(维护)。

## SQLite 表与列(现场数据,绝不可改)

| Wire 名 | 概念层归属 | 定义 |
|---|---|---|
| `bootstrap_snapshots` / `bootstrap_dim_files` | Generate 快照 | migrations/001 |
| `deep_mining_rounds` / `coverage_ledger` | Generate deepMining 轮次/覆盖网格 | migrations/015、016 |
| `evolution_proposals`(status: pending/observing/executed/rejected/expired) | Sustain 提案 | migrations/004 |
| `lifecycle_transition_events` | Sustain 状态机审计 | migrations/006 |
| `knowledge_entries.lifecycle`(值: pending/staging/active/evolving/decaying/deprecated) | Curate/Sustain 生命周期 | migrations/001+004 |
| `recipe_warnings`(status: open/resolved) | Sustain 告警 | migrations/008 |

## 枚举与字段值(JSON/持久化)

| Wire 值 | 概念层归属 | 位置 |
|---|---|---|
| `generationStage: 'coldStart' \| 'deepMining' \| 'moduleMining'` | Generate 三 stage(名实相符,保留) | planIntent contracts;JobStore.request 快照 |
| `miningMode: 'deepMining' \| 'moduleMining' \| 'per-module'` | Generate | DaemonRescanWorkflowArgs |
| `job.kind: 'bootstrap' \| 'rescan'` | Generate/Sustain 作业类型 | ALEMBIC_JOB_KINDS;daemon job 持久化 |
| SignalBus `SignalType`(guard/search/usage/lifecycle/decay/quality/…) | Sustain 信号 | SignalBus.ts |
| `source: 'rescan-evolution'` 等 source 值 | Curate 来源标记 | knowledge_entries.source |
| session id 前缀 `bs_`;`.asd/bootstrap-sessions/`、`.asd/bootstrap-report.json` | Generate 会话/报告 | BootstrapSessionManager |

## 对外表面(MCP/HTTP/CLI/事件)

| Wire 名 | 概念层归属 | 备注 |
|---|---|---|
| MCP `alembic_bootstrap` / `alembic_rescan` / `alembic_submit_knowledge` / `alembic_dimension_complete` / `alembic_plan` | Generate/Curate 入口 | LLM 按字符串调用;job 历史 createdByTool |
| HTTP `/api/v1/modules/bootstrap`、`/api/v1/jobs/rescan`、`/api/v1/evolution/*`、`PATCH /api/v1/knowledge/:id/publish` | Generate/Sustain/Curate | Dashboard/外部消费 |
| CLI `alembic coldstart` / `alembic rescan` | Generate | 用户脚本/文档广泛引用 |
| Socket 事件 `bootstrap:*`(单源常量 `RECIPE_PIPELINE_EVENTS`,src/domain/knowledge/recipe-authoring-spec/pipelineEvents.ts) | Generate 进度 | 发射端已切常量;消费端字符串随 S4 批次切换 |
| 包导出路径 `@alembic/core/repository/bootstrap`、`…/service/bootstrap`、`…/workflows/cold-start`、`…/workflows/project-index` | Generate | 外层 import 契约;概念层类名改名不动 subpath(S4 批次逐个评估 alias) |

## 半 wire(跨仓字符串引用,改名需同批联动+旧名 alias 一个版本)

| 名 | 概念层新名 | 计划 |
|---|---|---|
| Agent profile id `'bootstrap-session'` / `'bootstrap-dimension'` | `generate-session` / `generate-dimension` | S4 bootstrap 批:registry 双 key 过渡 |
| profile id `'module-mining-session'` 等 | 保留(名实相符) | — |

## 概念层已改名对照(随批次追加)

| 旧名 | 新名 | 批次 |
|---|---|---|
| EvolutionGateway / 'evolutionGateway'(DI) | ProposalGateway / 'proposalGateway' | 批2 |
| Bootstrap* 137 符号(BootstrapSession(Manager)/BootstrapConsumers/BootstrapTaskManager/BootstrapEventEmitter/GenerateDedup 等,完整映射见 Design/docs/current/alembic-s4-bootstrap-symbol-map-2026-07-02.md) | Generate* | 批3a |
| profile id 'bootstrap-session'/'bootstrap-dimension';partitioner/merge/factory;DI 'bootstrapTaskManager'/'bootstrapSessionManager'/'bootstrapRepository' | 'generate-*' 系(原子切换,无 alias——工作区封闭) | 批3a |
| SkillHooks 'onBootstrapStart'/'onBootstrapComplete' | 'onGenerateStart'/'onGenerateComplete'(旧名 compat 注册保留一个版本) | 批3a |
| Dashboard i18n bootstrap.* | generate.* | 批3a |
| ProjectIndex* 27 符号(runProjectIndexWorkflow→runGenerateWorkflow 等;ColdStart* 名实相符保留) | Generate*/ScopedModuleMining* | 批3d |
| McpSession(+字段 session?)/SseSessionRegistry 族/私有 GenerateSession 双胞胎 | McpConnection(+connection?)/SseConnectionRegistry(HTTP 载荷 sessionId 与 createStreamSession wire 术语保留)/GenerateTaskSession | W3 |
| src/evolution.ts facade 本体 | src/sustain.ts(exports 新增 './sustain';'./evolution' wire 冻结留 shim 整体转发) | W3 |
| Evolution{Proposal,Warning,LifecycleEvent,GitDiffCheckpoint,CoverageLedger}Repository 5 个 type 别名 | 删除,消费方改直名(coverage_ledger 是 Generate 概念,别名挂 Evolution 名实不符) | W3 |
| RecipeSimilarity 的 RecipeLike | SimilarityRecipeLike(与 recipeStatus 侧 RecipeLike 消歧;补进 './sustain' 具名导出) | W3 |
| exports `./workflows/capabilities` 族 6 条+src 目录 | `./workflows/surfaces` 族(0 外部消费实证,原子切换无 alias;closeout/retired 历史记录保留旧名) | W3 |
| Agent src/tools/runtime/capabilities/ 目录 | tools/runtime/toolsets/(无独立 exports 子路径;类名 Capability/RuntimeCapability 待 W6 别名层删除后评估) | W3 |
| Plugin lib/workflows/capabilities/ 目录 | lib/workflows/surfaces/(#workflows/* package-imports 中段同批;stage 验证过) | W3 |
| 主体 PcvNodeEvidence.ts/Agent PcvNodeEvidence.ts(同名异物) | PcvStageNodeMap.ts(主体,stage node map 构建)/PcvNodeEvidenceRecorder.ts(Agent,运行时证据记录);契约值 'PCVGenerateStageNodeMap' 等冻结 | W3 |
| [Insight-v3] 日志前缀 | [generate](43 处/10 文件,纯 D 层) | W3 |
| 主体 lib/workflows 目录+#workflows 别名 | 消亡:completion/skill-delivery/wiki→recipe-pipeline/generate/;project-context→lib/project-facts | W5 |
| 主体 service/{planFacts→plan/facts 已在 W4;handler-runtime 解散;daemon 平铺} | types→lib/types/handler-runtime.ts;daemon 三群 jobs/observability/runtime | W5 |
| Plugin lib/recipe-generation+#recipe-generation | lib/recipe-pipeline+#recipe-pipeline(与主体同名镜像;四环 plan/generate/curate/sustain;RECIPE_GENERATION_* 符号词族缓议) | W5 |
| Plugin lib/runtime+#codex | lib/host-runtime+#host-runtime(双宿主后旧名退役;分组 mcp/host-adapter/context/status/diagnostics/policy) | W5 |
| Plugin DaemonStatus/DaemonStatusKind(恒 null 假状态) | HostRuntimeStatus(Kind)(载荷键 `daemon`、磁盘 daemon.json/pid/lock/log 冻结;**主体同名 DaemonStatus 是真 daemon 状态,正当保留**——故 retired 词表只收 Kind) | W5 |
| 事件消费端裸串(daemon 订阅 8 处+facts 3 处+两仓 GenerateTaskManager 六 emit) | RECIPE_PIPELINE_EVENTS 常量(wire 值恒为 bootstrap:*,预定的消费端切换完成) | W5 |

回流防护:`scripts/lint-retired-symbols.mjs` + `config/retired-symbols.json`(166 退役符号,五仓 npm run lint:retired-symbols,已接入 check)。

### 批3 新增冻结登记(3b 建议补表项)
- `.asd/bootstrap-checkpoint/`(DimensionCheckpoint/MiningSessionStore/SessionStore 持久化目录)
- `bootstrap-reports/`(WorkflowReportHistoryStore 运行时报告历史+HTTP 读取路径)
- env `ALEMBIC_BOOTSTRAP_CONCURRENCY`(用户可见 env,本批保留)
- workflow session source `'alembic-main-bootstrap'` / `'codex-host-bootstrap'`、intent kind `'bootstrap-host-agent'` / `'host-agent-bootstrap'`(真机运行时 JSON 实证含 'host-agent-bootstrap',全族冻结)
