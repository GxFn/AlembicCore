# AlembicCore Agent Instructions

<!-- wakeflow:scope:start -->
## Workspace Access Card

This section is maintained by the Wakeflow runtime installer. It records this window access coordinates and the minimum automation gate. Hard rules come from the parent AGENTS and this file; do not duplicate repository-specific rules here.

### Coordinates

- Wakeflow runtime: `..`
- Window name: `AlembicCore`
- Parent workspace AGENTS: `../AGENTS.md`
- Active workspace index: `../.workspace-active/workspace/index.md`
- Active workspace status: `../.workspace-active/workspace/current/workspace-current-status.md`
- Current plan directory: `../.workspace-active/workspace/current`
- Window ledger: `../wakeflow-ledger/AlembicCore`

### When claiming workspace work

1. Read this file first.
2. Then read parent `../AGENTS.md`.
3. Then read `../.workspace-active/workspace/index.md` and `../.workspace-active/workspace/current/workspace-current-status.md`.
4. If there is a current plan, task package, or direct-thread delivery, execute only the content under `../.workspace-active/workspace/current` explicitly assigned to `AlembicCore`.
5. Goals, scope, forbidden actions, validation commands, and backfill fields come from the current plan, task package, and repository rules. Prompts are only wakeup entrypoints, not the full task specification.

### Direct Thread Dispatch Minimum Gate

- Direct-thread delivery is the normal work transport. It does not change this window responsibility or expand task scope. Specific work comes from the dispatch packet, current plan, and repository rules.
- Delivery prompts carry only a few dynamic variables and a skill pointer. Do not treat the prompt as a full command manual. State-machine routes need only visible `currentWindow` / `taskId` / `stateRoot` / optional `dispatchGroup`. Machine fields such as `controllerWindow`, `returnPolicy`, `humanContextRef`, and `stateRevision` are read from the state root, dispatch group, and delivery envelope. Stop and report if `stateRoot` is missing or variables conflict.
- This window only handles dispatch packets for `AlembicCore` and returns `TargetResultEnvelope`. Do not claim, accept, or process other window tasks.
- Child windows do not create target-to-target next-hop delivery by default. Evidence repair, redispatch, and next phases are decided by controller review. If delivery has `returnRoute=controller` and `review-results` shows that `DispatchGroup.returnPolicy` allows a callback, create exactly one controller-return envelope with `build-controller-return`, returning by default to the original controller named by `DispatchGroup.controllerWindow`. Then complete the real direct-thread send, readback, and `record-delivery-run`. A controller return is complete only when a `DirectThreadDeliveryRun` exists with `status=sent` and `readback.ok=true`. The full group snapshot stays in the controller-return envelope; the visible prompt shows only non-empty exceptional targets and must not treat one target backfill as whole-group completion.
- Non-Test windows must not create, process, or verify Test delivery unless both the current plan and delivery envelope explicitly authorize it.
- Thread ids may only be written to Wakeflow local runtime. Do not write them to tracked documents, backfill text, or GitHub.

### Skill Assistance

- Codex subagents are recommended for bounded parallel assistance such as code search, log triage, test localization, and evidence summarization. Treat subagent output as evidence or advice only; it must not accept work, dispatch another window, write controller state, or expand repository boundaries.

### Document Destinations

- Long-term cross-repository collaboration docs, plans, acceptance records, scans, and boundary records go to `../wakeflow-ledger/AlembicCore`. This repository `docs/` is only for product, release, or user docs maintained with the source.
<!-- wakeflow:scope:end -->

## 本窗口最高停止卡

本仓库是 Alembic 长期 Core 子仓库，承载可复用、确定性、可运行的 Headless 内核。它不是用户项目环境，也不是空壳接口仓库。本节是仓库级执行前停止卡。

### 先停下

- 如果当前任务没有明确分配给 `AlembicCore`，或当前目录不是本仓库，停止并回报总控。
- 如果准备把完整能力改成类型空壳、接口占位、静态 mock、无真实生产方或消费方的 contract，停止。
- 如果新增 Core contract 但没有真实外层消费方、输入输出、状态变化和验证方式，停止。
- 如果准备把 Codex MCP、Skill、marketplace/channel、CLI、Dashboard UI、IDE/native、AI provider、internal agent 或 tool system 放进 Core，停止。
- 如果要破坏现有 exports、DTO、排序、预算、状态机、错误语义或持久化兼容，停止并先做兼容设计。
- 如果要删除外层仍在消费的 repository、service、workflow、search/vector、Guard、AST/grammar 或 Project Intelligence 能力，停止。
- 如果要修改外层仓库、vendor 指针或 release 快照，当前计划没有授权时停止。
- 如果没有提交 hash 或明确 no-commit 理由、验证命令、验证结果、遗留风险和下游接入建议，不能回填为完成。

### 正确顺序

1. 先读外层真实调用方和 Core 现有实现，确认能力是否属于 Core。
2. 再设计稳定 package 入口、类型、持久化和兼容边界。
3. 实现后跑 Core 自身验证和必要边界测试。
4. 最后回填下游消费方式、验证证据和遗留风险。

## 仓库定位

- `AlembicCore` 是 `@alembic/core` 的源码仓库，承载 Alembic 共享、确定性、可复用、可运行的 Headless 内核能力。
- Core 不是插件仓库、不是 CLI 仓库、不是 Dashboard 仓库、不是宿主 Agent 仓库。
- Core 可以包含完整共享链路所需的模型、类型、配置、workspace/path/io、SQLite/Drizzle/migrations、repository、service、search/vector、Guard、AST/grammar、project intelligence、workflow contract、planning、persistence、session/briefing/context payload 等能力。
- Core 需要支持“由宿主 Agent 分析和扫描代码”的完整闭环，但 Core 只实现可复用的 workflow/session/briefing/persistence/contract，不实现宿主 Agent 本体、工具系统或多渠道交付。
- Core 不包含 Codex MCP schema、Codex Skill 文案、Codex marketplace/channel、CLI 交互、Dashboard UI、IDE 文件投递、release 发布壳、native/macOS/Lark 集成、AI provider/API key 管理、internal agent、tool system、tool policy。

## 职责边界

- Core 可以承载模型、类型、配置、workspace/path/io、SQLite/Drizzle/migrations、repository、service、search/vector、Guard、AST/grammar、project intelligence、workflow contract、planning、persistence、session、briefing 和 context payload。
- Core 只做可复用 deterministic 能力，不做宿主窗口、UI、Codex 插件、发布壳或 AI provider runtime。
- 共享能力的修复优先在本仓库完成；外层仓库只保留 adapter、wiring、transport 和宿主体验。

## 外层接入规则

- 日常 workspace 本地开发优先让外层仓库通过 `@alembic/core: file:../AlembicCore` 使用本仓库包入口，确保只有一个 Core 源仓库承担真实修改。
- `vendor/AlembicCore` 只用于 release、portable runtime、vendor snapshot 或当前总控文档明确要求的封版场景；不要把 vendor/submodule 当作日常开发接入默认路径。
- 修改 Core 能力时，必须在本 workspace 的 `AlembicCore` 仓库完成、验证、提交，再由 `Alembic` / `AlembicPlugin` 按对应计划更新本地 file 依赖或 vendor 指针。
- 如果封版场景必须在外层仓库的 `vendor/AlembicCore` 内修 Core，也要按独立 Core commit 处理，并同步回 Core 源仓库。
- Core 的 `dist/` 是构建产物，外层接入前可以构建它，但不得提交 `dist/`。

## Package 入口规则

- `package.json` 的 `exports` 是外层长期接入契约。新增公共模块时必须同步更新 `exports`、`src/**/index.ts` 和对应测试。
- 根入口 `src/index.ts` 只暴露外层常用的稳定契约；不要为了省事把 `repository`、`types`、`workflows` 等大目录全部 `export *` 到根入口，避免同名 DTO 冲突。
- 完整模块接入优先使用子路径，例如 `@alembic/core/repository/knowledge`、`@alembic/core/workflows/capabilities/project-intelligence`。
- 不要绕过包入口从外层直接引用 `vendor/AlembicCore/src/**`。

## 验证与回填

- `npm run build:check`：TypeScript no-emit 检查。
- `npm run test`：全量 Vitest。
- `npm run build`：构建 `dist/`。
- `npm run lint`：Biome 检查。
- `npm run check`：组合检查。

边界测试必须保持存在并通过：

- `test/CoreDeliveryBoundary.test.ts`
- `test/CoreToolSystemBoundary.test.ts`
- `test/CoreCodexBoundary.test.ts`
- `test/CorePackage.test.ts`
- 回填必须写清完成范围、提交 hash、验证命令、验证结果、下游接入建议、遗留风险和下一步建议。
- 只改文档时也要说明为什么不需要产品构建，并至少运行 `git diff --check`。

## 文件地图

- 正式 Core 源码：`src/`。
- 测试：`test/`。
- 正式脚本：`scripts/`。
- 构建产物：`dist/`，必须保持 ignored，不提交。
- workspace 级长期协作文档按 Workspace 接入卡中的 `Window ledger` 归档。

当前主要源码分层：

```text
src/
├── core
├── daemon
├── domain
├── infrastructure
├── repository
├── service
├── shared
├── types
└── workflows
```

## 技术与代码规则

- 语言：TypeScript，Node.js >= 22。
- 模块系统：ESM (`"type": "module"`)，import 路径必须带 `.js` 后缀。
- Lint / Format：Biome。
- 测试框架：Vitest。
- Core 代码不要依赖外层仓库的 `#shared/*`、`#repo/*` 等 package imports 别名；新增代码使用相对路径或先在 Core 内明确配置。
- 保持类型明确，避免 `any`；确需兼容未知输入时，用 `unknown`、类型守卫和结构化归一化。
- 必须尽量多地在代码旁补充简体中文说明，优先解释迁移边界、业务语义、持久化兼容、状态机、分叉原因、降级原因、兼容路径和后续校验方式。
- 任何运行时分叉、fallback、降级、兼容转译、跳过、短路、重试、取消或错误归类，都必须打印足够明确的日志或诊断事件，日志要能看出触发条件、选择路径、关键输入、结果状态和后续校验依据。

## 长期维护规则

- 先读外层真实调用方和 Core 现有实现，再改 Core。
- 保持数据结构、排序、预算、状态机、错误语义和持久化行为兼容。
- 修复 shared/domain/repository/service/workflow 内核问题时，应优先在 Core 完成；外层只保留 adapter、wiring 和宿主能力。
- 如果某个能力是否属于 Core 不确定，先做边界判断并记录理由；不要为了边界好看先裁掉真实链路。
- 任何删除都必须有扫描结果、替代入口和测试证据。
