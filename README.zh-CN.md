# AlembicCore

[English](./README.md) | **简体中文**

`@alembic/core` 是 Alembic 运行时家族共享的、无头（headless）、确定性的知识内核。
它承载所有 Alembic 宿主共同依赖的模型、持久化、分析、搜索与 workflow 契约——
并且刻意不包含任何宿主形态的能力：没有 Agent 运行时、没有工具系统、没有
AI provider、没有 CLI / Dashboard UI、没有 Codex/MCP 交付面。四道边界墙测试
（`test/CoreDeliveryBoundary.test.ts`、`test/CoreToolSystemBoundary.test.ts`、
`test/CoreCodexBoundary.test.ts`、`test/CorePackage.test.ts`）在每次 check
运行中强制守护这一定位。

它是 Alembic 发布链中的第一个包：`@alembic/agent` 与主包 `alembic-ai`
的下游发布封版（release staging）消费已发布的 `@alembic/core` registry 版本。

## 能力总览

- **知识生命周期** —— 单一 `KnowledgeEntry` 聚合，用 `lifecycle` 字段区分
  *candidate*（已提交、未发布）与 *recipe*（已发布、可执行）。统一候选校验
  （`validateCandidatesUnified`：批内去重 → V3 结构校验 → 字段/质量/唯一性
  检查）、只作咨询绝不作门禁的质量评分，以及六态进化状态机
  （staging → evolving → active → decaying → deprecated，外加 proposal
  生成与 GC 清扫）。
- **Guard** —— `GuardCheckEngine` 用真实 AST 分析将代码对照已发布 Recipe
  标准检查，返回结构化裁定。
- **项目智能** —— ProjectContext 装配（space → repo → module → file 查询
  阶梯）、模块/入口点发现、源码关系图、新鲜度/部分性标注，以及只投射事实、
  不排序不推荐的 plan-facts 投影（选择权交给宿主 Agent）。
- **AST 分析叶子** —— 基于 `web-tree-sitter` 的多语言解析与调用图分析，
  内置 11 个 WASM 语法（TypeScript、TSX、JavaScript、Swift、Objective-C、
  Kotlin、Java、Dart、Python、Go、Rust），语法缺失时优雅降级。
- **搜索 + 向量** —— Recipe/知识搜索、排序、语义向量检索与 AST 感知分块。
- **宿主 Agent workflow** —— 冷启动与知识重扫编排：任务简报（mission
  briefing）、带稳定 unit key 的预算化分析包、逐维度完成与覆盖写回，
  以及 session → snapshot 持久化。
- **持久化** —— 基于 `better-sqlite3` + `drizzle-orm` 的 SQLite 与版本化
  迁移、仓储契约与实现，以及 file-first 知识存储：`.md` 文件是真相源，
  数据库只是索引缓存，两者分歧以带类型的错误显式暴露并附有文档化的
  修复路径。
- **运行时契约** —— daemon-less 的作业/运行时展示与常驻服务契约、带诚实
  截断信号的输出预算、稳定诊断码，以及失败/字段分类学。

## 架构

`src/` 划分为九个源码区域加根门面（root facades），受强制依赖契约约束
（`config/layer-contract.json`，人类可读版本 `docs/layer-contract.md`，
阻断式 lint `scripts/lint-layer-contract.mjs`）。运行时 import 只允许向下；
`import type` 作为类型桥豁免。

| 区域 | 职责 | 允许运行时 import |
| --- | --- | --- |
| `shared/` | 叶子工具：错误、schema、分类学、相似度、路径守卫、语言画像、输出预算 | — |
| `types/` | 跨层类型桥（快照、视图、wire 契约） | shared |
| `domain/` | 实体与领域契约（knowledge、dimension、evolution、snippet、source-graph） | shared, types |
| `core/` | 多语言 AST / 发现 / 能力**分析叶子** | shared, types, infrastructure |
| `infrastructure/` | 数据库（drizzle/迁移）、io、日志、信号、报告、向量、配置管道 | shared, types |
| `repository/` | 持久化契约与实现（SQLite + `.md` 文件存储） | shared, types, domain, infrastructure |
| `service/` | 业务编排与规则 | 另加 core*、repository |
| `workflows/` | 高层编排（冷启动、重扫、host-agent、planning、coverage） | 另加 service |
| `daemon/` | 作业/运行时展示与常驻服务契约 | shared, types |
| `src/*.ts` | 根门面 —— 公共包入口 | 任意层 |

`core*` 标记受祝福的分析叶子例外：`service/` 与 `workflows/` 可以直接
import `core/`（如 `GuardCheckEngine`、AST 分块），不必再造一层 adapter。
每条例外都在契约配置中附有书面理由。

## 包入口

包通过 `package.json` `exports` 子路径暴露 API（v0.2.0 共 65 条）——
根门面加上按领域、按层、按 workflow 分组的入口：

```ts
import { applyOutputBudget, DivergenceError } from '@alembic/core';
import { validateCandidatesUnified } from '@alembic/core/knowledge';
import { createGuardCheckEngine } from '@alembic/core/guard';
import { createAlembicRepositories } from '@alembic/core/repositories';
import { runHostAgentDimensionCompletionWorkflow } from '@alembic/core/host-agent-workflows';
```

每条导出子路径都在 `config/public-api-boundary.json` 中分级：
**stable**（长期契约，只收敛不扩张）、**provisional**（窄度预算，未经受控
授权只能收窄）、**transitional**（迁移期表面，标注目标门面）。分级由
`scripts/check-public-api-boundary.mjs` 在每次 check 中强制执行；消费仓库
另由 `scripts/lint-consumer-core-imports.mjs` 按各自 allowlist 反向扫描。

根门面（`src/index.ts`）刻意保持窄：小区域整体再导出，大区域
（repositories、types、workflows）只逐一具名导出，避免同名 DTO 冲突。
已发布的兼容别名保持公开：`HostAgent*` ↔ `IDEAgent*`、`Bootstrap` ↔
`AppRuntime`。

## 快速开始

要求：Node.js >= 22、npm。

```bash
npm ci
npm run build:check   # TypeScript no-emit 检查
npm run test          # 全量 Vitest
npm run build         # 构建 dist/
npm run check         # 完整门禁链（见下）
```

接入方式：

- **Workspace 日常开发** —— 下游仓库链接同级源码：
  `"@alembic/core": "file:../AlembicCore"`。链接前先本地构建 `dist/`；
  绝不提交 `dist/`。
- **发布封版** —— 发布 manifest 必须消费 registry 版本而非同级链接。
  `AlembicPlugin` 可移植运行时快照可按源码元数据固定
  `file:vendor/AlembicCore`。

## 质量门禁

`npm run check` 运行阻断式门禁链：

```text
build:check → lint:public-api-boundary → lint:layer-contract
→ lint:consumer-core-imports → lint:scope-resolution → smoke:public-api
→ check:output-budgets → check:space-edges → lint:doctrine → lint:naming
→ test → lint
```

要点：

- **边界墙** —— 四道 `Core*Boundary`/`CorePackage` 测试拒绝宿主形态代码
  （禁目录、禁导出前缀、禁具名实现文件）。
- **层契约** —— `src/` 区域之间的运行时 import 方向。
- **公共 API 边界** —— 导出分级、窄度预算，以及不得复活的已移除导出。
- **输出预算** —— 逐工具字节预算与诚实的 `truncated` 信号，按真实
  fixture 实测背书。
- **教条与命名 lint** —— 代码注释与命名规范。

## 发布

Core 发布由以下命令守护：

```text
npm run check
npm run build
npm run smoke:public-api
npm run release:check
```

发布 workflow 支持手动 dry-run 封版路径，且只从 `v<package.version>` tag
发布并启用 npm provenance。完整流程、失败处理与下游封版顺序见
[RELEASE-PLAYBOOK.md](./RELEASE-PLAYBOOK.md)。

## 仓库角色

`AlembicCore` 不得依赖本地完整 Alembic 应用或 Codex 插件仓库。依赖方向为：

```text
AlembicCore
  ^
  |- AlembicAgent
  |- Alembic
  |- AlembicPlugin 可移植运行时快照
```

共享能力的修复优先落在本仓库；下游仓库只保留 adapter、wiring、transport
与宿主体验。

## 延伸阅读

- [docs/layer-contract.md](./docs/layer-contract.md) —— 层契约、受祝福
  例外与已知技术债。
- [docs/semantic-glossary.md](./docs/semantic-glossary.md) —— candidate vs
  recipe、dimension key vs concept、session vs snapshot、validate vs score。
- [docs/public-api-gates.md](./docs/public-api-gates.md) —— 导出边界策略。
- [docs/entrypoint-effects.md](./docs/entrypoint-effects.md)、
  [docs/realtime-delivery-contract.md](./docs/realtime-delivery-contract.md)、
  [docs/foundational-health-register.md](./docs/foundational-health-register.md)。

## 许可证

MIT
