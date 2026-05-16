# AlembicCore Agent Instructions

**重要**：本项目是 Alembic 的 Core 子仓库，不是用户项目环境，也不是空壳接口仓库。

Agent 不够聪明。

Agent 可以制定目标和计划，但目标和计划必须服务于用户提出的真实任务，不能被 Agent 自己偏好的“干净”“薄”“轻量”“空壳”“先搭框架”等路线替换。

Agent 不得把完整实现改成薄实现，不得把成熟能力改成空壳接口，不得把迁移、整理、重构、优化或插件化解释成削减功能。

当 Agent 的计划涉及删减、替换、降级、延期、只做部分、只搭框架、只保留接口、暂不接入或改变完整范围时，必须先向用户确认。

## Core 仓库边界

- Core 必须承载真实、可运行、可复用的确定性能力，不是“先放类型以后再接”的占位仓库。
- Core 的迁移原则是功能保持优先；从外层迁入能力时，不做删减、不做降级、不用玩具 smoke 替代真实链路验证。
- Core 可以包含知识模型、workspace、storage、repository、workflow、scan contract、search/vector、Guard、jobs/events、project analysis、context payload 等共享内核。
- Core 不应直接包含 Codex MCP schema、Codex Skill 文案、CLI 命令交互、Dashboard UI、IDE 文件投递、release 发布壳等宿主 adapter。
- 如果某个能力是否应进 Core 不确定，先保留完整能力与真实调用链判断，不要为了边界好看先裁掉。

## 需要测试时

- `npm run build:check`：TypeScript no-emit 检查。
- `npm run build`：构建 `dist/`。
- `npm run boundary:check`：检查 package root-only exports、根导出边界、`dist/` 未被 git 跟踪。
- `npm run test:unit`：当前等价于 boundary check；不能把它当成完整业务单元测试。
- 需要验证真实迁移时，应使用来自 `Alembic` / `AlembicPlugin` 的真实调用数据或 fixtures，不要只造极小样例。

## 文件存放约定

- 正式 Core 源码：`src/`。
- 正式脚本：`scripts/`。
- 构建产物：`dist/`，必须保持 ignored，不提交。
- Core README/checklist 可以保存在仓库根目录。
- workspace 级迁移文档保存在 `/Users/gaoxuefeng/Documents/AlembicWorkspace/docs/`，不要写到 `/Users/gaoxuefeng/Documents/github`。

## 技术栈与编码约定

- 语言：TypeScript，Node.js >= 22。
- 模块系统：ESM (`"type": "module"`)，import 路径必须带 `.js` 后缀。
- Core 当前没有 Alembic 主仓库的 `#shared/*` 等 package imports 别名，新增代码使用相对路径或先明确配置。
- 当前没有 Biome/Vitest 完整配置；不要声称 lint/unit test 已覆盖真实业务。
- 编辑源码时保持类型明确，避免 `any`；确需兼容外层未知输入时，用 `unknown`、类型守卫和结构化归一化。

## 当前目录结构

```text
src/
├── analysis
├── candidate
├── config
├── context
├── discovery
├── domain
├── events
├── guard
├── jobs
├── knowledge
├── repository
├── scan
├── search
├── shared
├── storage
├── vector
├── workflows
└── workspace
```

## 迁移工作规则

- 先读外层真实实现和调用方，再抽取 Core。
- 抽取时保持数据结构、排序、预算、状态机、错误语义和持久化行为兼容。
- 不要因为“Core 不做宿主 adapter”而删除共享链路所需的输入 contract、结果 contract、状态机或辅助扫描机制。
- 外层接入和删除任务可以写入 workspace docs 让其他窗口执行；本窗口如果被要求只做 Core，就不要顺手改外层实现。
