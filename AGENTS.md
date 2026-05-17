# AlembicCore Agent Instructions

**重要**：本项目是 Alembic 的长期 Core 子仓库，不是用户项目环境，也不是空壳接口仓库。

Agent 可以制定目标和计划，但目标和计划必须服务于用户提出的真实任务，不能被 Agent 自己偏好的“干净”“薄”“轻量”“空壳”“先搭框架”等路线替换。

Agent 不得把完整实现改成薄实现，不得把成熟能力改成空壳接口，不得把迁移、整理、重构、优化或插件化解释成削减功能。

当 Agent 的计划涉及删减、替换、降级、延期、只做部分、只搭框架、只保留接口、暂不接入或改变完整范围时，必须先向用户确认。

不要在旧工作区或旧克隆路径下工作；当前统一以本 workspace 内的 Alembic 系列仓库为准。

Core 相关的迁移计划、阶段验收、公开 API 边界、外层接入和删除任务文档，后续统一保存到 workspace 根目录的 `docs/AlembicCore/`。不要再把新的 AlembicCore 长期协作文档散落到 workspace `docs/` 根层级或各外层仓库内。

## 仓库定位

- `AlembicCore` 是 `@alembic/core` 的源码仓库，承载 Alembic 共享、确定性、可复用、可运行的 Headless 内核能力。
- Core 不是插件仓库、不是 CLI 仓库、不是 Dashboard 仓库、不是宿主 Agent 仓库。
- Core 可以包含完整共享链路所需的模型、类型、配置、workspace/path/io、SQLite/Drizzle/migrations、repository、service、search/vector、Guard、AST/grammar、project intelligence、workflow contract、planning、persistence、session/briefing/context payload 等能力。
- Core 需要支持“由宿主 Agent 分析和扫描代码”的完整闭环，但 Core 只实现可复用的 workflow/session/briefing/persistence/contract，不实现宿主 Agent 本体、工具系统或多渠道交付。
- Core 不包含 Codex MCP schema、Codex Skill 文案、Codex marketplace/channel、CLI 交互、Dashboard UI、IDE 文件投递、release 发布壳、native/macOS/Lark 集成、AI provider/API key 管理、internal agent、tool system、tool policy。

## 外层接入规则

- 外层仓库通过 `vendor/AlembicCore` 子仓库接入本仓库，并通过 `@alembic/core: file:vendor/AlembicCore` 使用 npm 包入口。
- 修改 Core 能力时，优先在本 workspace 的 `AlembicCore` 仓库完成、验证、提交，再由 `Alembic` / `AlembicPlugin` 更新子仓库指针。
- 不要把外层仓库中的 `vendor/AlembicCore` 当普通目录随手改散；如果必须在 vendor 内修 Core，也要按独立 Core commit 处理，并同步回 Core 源仓库。
- Core 的 `dist/` 是构建产物，外层接入前可以构建它，但不得提交 `dist/`。

## Package 入口规则

- `package.json` 的 `exports` 是外层长期接入契约。新增公共模块时必须同步更新 `exports`、`src/**/index.ts` 和对应测试。
- 根入口 `src/index.ts` 只暴露外层常用的稳定契约；不要为了省事把 `repository`、`types`、`workflows` 等大目录全部 `export *` 到根入口，避免同名 DTO 冲突。
- 完整模块接入优先使用子路径，例如 `@alembic/core/repository/knowledge`、`@alembic/core/workflows/capabilities/project-intelligence`。
- 不要绕过包入口从外层直接引用 `vendor/AlembicCore/src/**`。

## 需要测试时

- `npm run build:check`：TypeScript no-emit 检查。
- `npm run test`：全量 Vitest。
- `npm run build`：构建 `dist/`。
- `npm run lint`：Biome 检查。
- `npm run check`：组合检查。

边界测试必须保持存在并通过：

- `test/CoreDeliveryBoundary.test.ts`
- `test/CoreToolSystemBoundary.test.ts`
- `test/CoreCodexBoundary.test.ts`
- `test/core-package.test.ts`

## 文件存放约定

- 正式 Core 源码：`src/`。
- 测试：`test/`。
- 正式脚本：`scripts/`。
- 构建产物：`dist/`，必须保持 ignored，不提交。
- workspace 级 Core 迁移和协作文档保存在 workspace 根目录的 `docs/AlembicCore/`。

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

## 技术栈与编码约定

- 语言：TypeScript，Node.js >= 22。
- 模块系统：ESM (`"type": "module"`)，import 路径必须带 `.js` 后缀。
- Lint / Format：Biome。
- 测试框架：Vitest。
- Core 代码不要依赖外层仓库的 `#shared/*`、`#repo/*` 等 package imports 别名；新增代码使用相对路径或先在 Core 内明确配置。
- 保持类型明确，避免 `any`；确需兼容未知输入时，用 `unknown`、类型守卫和结构化归一化。
- 可以使用中文注释解释迁移边界、业务语义、持久化兼容或非显然状态机；不要给自解释代码堆注释。

## 长期维护规则

- 先读外层真实调用方和 Core 现有实现，再改 Core。
- 保持数据结构、排序、预算、状态机、错误语义和持久化行为兼容。
- 修复 shared/domain/repository/service/workflow 内核问题时，应优先在 Core 完成；外层只保留 adapter、wiring 和宿主能力。
- 如果某个能力是否属于 Core 不确定，先做边界判断并记录理由；不要为了边界好看先裁掉真实链路。
- 任何删除都必须有扫描结果、替代入口和测试证据。
