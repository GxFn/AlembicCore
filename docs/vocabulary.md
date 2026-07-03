# Alembic 全空间统一词汇表

- 生效:2026-07-02;定稿:2026-07-03(全空间统一重构 W0-W8 全批收官;wire-contract.md 的姊妹篇,增量随各批追加)
- 语义:本表定义每个核心词在全空间(AlembicCore/Alembic/AlembicAgent/AlembicPlugin/AlembicDashboard)的**唯一含义**与命名边界。新代码命名前先查本表;与 wire-contract.md 冲突时以 wire 冻结为准(wire 名是机器契约,本表管概念层)。
- 执行依据:W3 底稿 `Design/docs/current/alembic-w3-vocabulary-map-2026-07-02.md`(工作区文档);判定与方案预测不一致处以底稿实测为准。

## 生命周期四环(域词)

| 词 | 唯一含义 |
|---|---|
| **Plan** | 规划环:项目事实采集→维度候选→规模决策(PlanSelectionGate→runPlanAgent)。目录 `recipe-pipeline/plan`、`service/plan` |
| **Generate** | 生成环:coldStart/deepMining/moduleMining 三 stage 的 Recipe 生产(旧词 bootstrap,仅 wire 层保留)。日志前缀统一 `[generate]` |
| **Curate** | 甄选环:validateAgainst 门禁→KnowledgeService.create→publish 晋级 |
| **Sustain** | 维护环:DecayDetector/ProposalExecutor/LifecycleStateMachine/rescan。Core facade=`@alembic/core/sustain`(`./evolution` 是 wire 冻结 shim) |

## 域词 vs 机制词(进化族判定)

- **evolution 不再是域词**(域词=Sustain),但作为**机制词保留**:指「Recipe 进化提案-决策-执行机制」本体(EvolutionPolicy/EvolutionAction/EvolutionDecision/EvolutionCandidate*/runEvolutionAudit/ReactiveEvolution*/PluginOpportunisticEvolution* 等 18 族)。判据:①机制本体;②持久化/wire 锚(`evolution_proposals` 表、`/api/v1/evolution/*`、`'evolution-gateway'`、`'rescan-evolution'`)——符号层强行 sustain 化会造成「符号叫 sustain、数据叫 evolution」双词撕裂;③仅作 sustain 域归属标签的杂项才去 evolution 化(如已删的 Evolution*Repository 别名)。
- **proposal / decay / consolidation / enhancement**:sustain 环内机制词,保留。
- **Gateway**:「统一入口」正词(ProposalGateway)。

## session(十二义收敛后)

| 义 | 正解 |
|---|---|
| **义①(canonical)** | 一次 Generate 生成运行的可恢复会话:Core `GenerateSession`(bs_ 前缀、`.asd/bootstrap-sessions/` wire 冻结)及其投影(SessionRepository/`sessions` 表、MiningSessionStore、ProduceSession*、RecipeSessionScope、DimensionExecutionSession) |
| **义②(Agent)** | agent 运行会话:`@alembic/agent/memory` 的 SessionStore(一次 agent run 的记忆/预算) |
| 非会话概念 | 不得用 session:MCP transport 连接=**McpConnection**;SSE 客户端连接=**SseConnection***(HTTP 载荷字段 `sessionId` 与 `createStreamSession` 是 wire 术语保留) |
| 消歧规则 | 任务管理器内部记录=GenerateTaskSession(非 Core 类);IDE 全局 rename GenerateSession 必炸(多重同名),只能按定义点逐个改 |

## 维度族

| 词 | 唯一含义 |
|---|---|
| **UnifiedDimension** | 维度唯一实体(Core domain/dimension) |
| **DimensionDef** | 全空间投影单源=`@alembic/core/types` ProjectSnapshot.ts(testMode 副本已删,泛型化) |
| **ModuleDimensionTarget** | Core KnowledgeRescanIntent 单源(三重定义已收敛) |
| **BaseDimension** | 旧格式过渡层(有 toBaseDimension 转换器+具名消费者),合并归后续批 |
| **CandidateDimension** | alembic_plan draft 候选维度(plan 无状态终稿词) |

## capability(四义收敛后)

| 站点 | 含义 |
|---|---|
| **CapabilityProbe**(`@alembic/core/capability`) | 唯一正解:写权限探针(infra) |
| Core `workflows/surfaces/` | 旧 workflows/capabilities,「工作流能力面」已改名 |
| Agent `tools/runtime/toolsets/` | 旧 runtime/capabilities,「按场景打包工具集」已改名(类名 Capability/RuntimeCapability→Toolset 待 W6 别名层删除后) |
| wire 冻结 | MCP 字段 `toolCapabilities`、HTTP `GET /api/v1/ai/agent/capabilities`、daemon 能力 id `jobs.*`、exports `./project-context-capabilities`/`./recipe-context-capabilities` |

## 执行三层与工具

| 词 | 唯一含义 |
|---|---|
| **job** | daemon 排程单位(`job.kind: 'bootstrap'\|'rescan'` wire) |
| **task** | generate 环内维度任务(GenerateTaskManager) |
| **run** | Agent 一次执行(runs/;PlanAgentRun/EvolutionAgentRun) |
| **ToolSpec** | 工具契约单源(Agent kernel) |

## 采集动词五分工

| 词 | 分工 |
|---|---|
| **scan(coldstart)** | 冷启动全量扫 |
| **rescan** | 增量重扫(CLI `alembic rescan` wire) |
| **sweep** | 维护清扫(EvolutionMaintenanceSweep) |
| **mining** | 深挖(deepMining/moduleMining stage 值 wire) |
| **analysis** | 静态 AST 分析 |

## 实体后缀

| 后缀 | 语义 |
|---|---|
| ***Wire** | 跨进程/LLM 投影权威形状(Core 单源,KnowledgeEntryWire 族;与 exports `./types/search-wire` 同族) |
| ***JSON** | 宿主 handler 层投影(过渡态,应逐步并入 Wire;KnowledgeEntryJSON 双胞胎登记 W5) |
| ***Like** | 依赖倒置结构 port(惯例保留;同名异物须消歧,先例 SimilarityRecipeLike) |
| ***Lite** | 有损轻量投影(RecipeRecordLite) |
| ***View** | UI/socket 层投影(Dashboard 侧) |

## insight(四义并存,不收敛)

| 站点 | 层 |
|---|---|
| preset `'insight'`(深度洞察预设) | 半持久化保留(process events 断言) |
| 记忆类型 `type: 'insight'` | B 层冻结(EpisodicConsolidator) |
| `aiInsight`/`ai_insight` 列+载荷 | B/C 层冻结 |
| 日志前缀 | 已改 `[generate]`(旧 `[Insight-v3]` 退役) |

## KnowledgeEntry

唯一知识实体;**candidate/recipe 是 lifecycle 视图词**(不是独立实体)。HTTP `/api/v1/candidates/*` 等 wire 保留,词汇表注明视图词语义。

## 宿主层词(W5 增补)

| 词 | 唯一含义 |
|---|---|
| **host-runtime** | Plugin 宿主运行时层(L2;原 lib/runtime+#codex,双宿主后旧名退役);分组 mcp/host-adapter/context/status/diagnostics/policy |
| **recipe-pipeline** | 两宿主同名镜像目录(主体 in-process API Agent 皮/Plugin 宿主 Agent 皮);四环子目录同型 |
| **project-facts** | 主体共用事实层(原 workflows/project-context+lib/project-context;与 Core `@alembic/core/project-context` 服务消歧) |
| **HostRuntimeStatus** | Plugin 恒 null 假 daemon 状态(载荷键 `daemon`/磁盘 daemon.json 族 wire 冻结);**主体同名 DaemonStatus 是真 daemon 进程状态,同名异物并存正当**——此类同名异物不入 retired 词表 |
| **RecipePipelineFacade** | daemon 调 pipeline 的唯一入口(主体;kind/generationStage→执行器分派收拢) |

## Agent 层词(W6 增补)

| 词 | 唯一含义 |
|---|---|
| **preset** | profile 的「运行时默认块」(Capability+Strategy+Policy 命名组合,含工厂/闭包,受 assertSerializableProfile 序列化门约束不可内联)——不是第二套 profile;三 id chat/insight/evolution 冻结 |
| **profile** | 可序列化声明层(11 个 definition),经 basePreset 回指 preset 展开 |
| **evaluation/** | 质量门+工件构建+gate evaluator+stage builder 层(自 prompts 拆出;prompt 文本≠门禁逻辑) |
| **prompts/** | 只装 persona/prompt 文本与 retry/repair 修复文案 |
| **evidence/ memory/** | 证据供给(EvidenceCollector)/记忆三层+固化引擎(EpisodicConsolidator)——原 agent/domain 拆归 |
| **能力键** | 'code_analysis' 等 7 个字面串=半 wire(profile defaults/skills 值+特判+主体断言),类的安置与别名变化不动键 |
