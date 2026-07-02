# 双宿主分叉登记表(fork registry)

- 生效:2026-07-02(全空间统一重构 W2 收尾)
- 语义:main(Alembic)↔ Plugin 的**有意/暂存分叉**登记。凡在此表=已知分叉+有理由,
  不是遗漏;改动任一侧时先查本表。字节同者不在此表(它们该 Core 化,见 wire-contract
  的收编记录);skills/templates 等资产分叉由 shared-asset-manifest 门禁管辖。

## 工具与协议面(有意分叉,禁止合并)

| 文件 | 分叉本质 | 证据 |
|---|---|---|
| lib/shared/schemas/mcp-tools.ts | 双宿主 MCP 工具面本质不同(main:alembic_guard 系;plugin:alembic_code_guard+26 codex 工具);同名 Input(SubmitKnowledgeInput 等 12 个)仅 3 个字节同 | 主仓 CLAUDE.md 差异声明表:工具契约段是已验证有意分叉 |
| lib/shared/schemas/http-requests.ts | 同名 23 导出中 9 个显式分叉;"字节同"14 个中 Batch 系依赖分叉的内部 BatchIds(main 多 confirmed 字段)——展开引用链后真同一者零散,Core 化收益塌缩,整文件保留分叉 | W2 三层亲验(2026-07-02) |

## 宿主路径依赖(参数化后可 Core 化,W5 评估)

| 文件 | 阻塞依赖 |
|---|---|
| lib/infrastructure/config/AppConfigLoader.ts | 宿主 PACKAGE_ROOT |
| lib/service/skills/SkillHooks.ts | 宿主 PACKAGE_SKILLS_DIR(代码零差异,注释措辞差) |
| lib/infrastructure/audit/AuditLogger.ts | 依赖 64% 分叉的 AuditStore |

## 结构性分叉(同名同职责,绑定集不同;改动须两侧对照)

| 文件 | diff 度 |
|---|---|
| lib/injection/{ServiceContainer,ServiceMap,modules/*}(9 同名) | 23-43% |
| lib/cli/SetupService.ts | 13% |
| lib/service/cleanup/CleanupService.ts | 17.5% |
| lib/recipe-*/generate/GenerateTaskManager.ts | 18.6% |
| lib/recipe-*/generate/GenerateEventEmitter.ts | 11%(payload 基础契约已 Core 化 20fefe0,实现留双) |
| lib/service/module/ModuleService.ts | 47% |
| lib/infrastructure/database/SqliteDatabaseAccess.ts | 76% |
| lib/infrastructure/audit/AuditStore.ts | 64% |
| lib/injection/modules/VectorModule.ts | 61%(main 有 ContextualEnricher 完整实现,plugin 已退化 pass-through——能力级差待决策) |

## 语义分叉(切换=行为变化,独立验证批)

| 项 | 差异 |
|---|---|
| Agent shared/tokenUtils vs Core shared/tokenUtils | token 权重不同(0.5/0.25 vs Core 版);Agent kernel 另有 len/4 故意粗估 |
| Agent shared/concurrency vs Core shared/concurrency | 实现不同(手写 vs p-limit) |
