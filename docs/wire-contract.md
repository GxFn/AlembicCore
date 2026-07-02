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
| (待 S4 批次填充) | | |
