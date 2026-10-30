# Atlas 文件架构与提交规则

本文件说明 Atlas 自身怎样组织、生成和验证内容。Core 的业务架构见 [maps](maps/README.md)。本目录是独立的 private npm 工程，Git 根仍是 AlembicCore；它不进入 `@alembic/core` 的 exports、依赖、默认构建或发布白名单。

## 1. 先区分三种使用方式

| 方式 | 所需输入 | 可以做什么 |
| --- | --- | --- |
| 阅读 / 静态构建 | 本目录、Atlas自己的依赖、已保存data快照 | `dev`、`build`、`preview`；允许没有Core源码、消费者仓库或原ledger |
| 内容维护 / 来源复验 | 完整Core checkout、源码/测试/配置、声明的消费者、原ledger、对应工具依赖 | 库存/结构/当前来源/原始出处/证据检查，以及显式生成 |
| 真实执行 / 交互验收 | 完整workspace与隔离fixture，或真实浏览器 | 显式执行选定测试、渲染图形、记录阅读交互；形成有范围的新回执 |

独立可阅读不表示维护测试也已自包含。`typecheck:probes`与`evidence:run`有意使用Core源码、类型、测试helper和Core安装的Vitest；不要为了“独立”复制产品源码或把宿主能力搬进Atlas。

## 2. 内容如何流动

1. `maps`、`journeys`、`objects`维护解释与显式关系；Core源码/测试/配置及声明的消费者提供只读依据，原审阅和执行材料位于workspace ledger。
2. `scripts/atlas.mjs`调用AST分析、来源规则、复审和书籍投影。`inventory:write`才显式更新派生JSON、Markdown生成区及索引；普通检查不签发新运行结论。
3. Vite插件读取已保存的九类浏览器数据，生成轻量bootstrap及按摘要命名的资源。`dev`在内存提供资源，`build`写入`.build/site/`。
4. `src/main.ts`按需通过loader读取资源，校验路径、身份、字节数与SHA。专题才加载Mermaid，F0按钮再加载Cytoscape/ELK。
5. 运行证据有另一条显式路径：场景定义 → Core Vitest与Atlas probe → ledger原始材料 → 仓内便携回执 → 维护复验 → book快照。执行结果不能由页面颜色或构建产生。

浏览器与维护脚本共享`book-model`、`deep-content`、`case-content`、`graph-model`等纯投影。`scripts/browser-assets.mjs`还消费`scripts/book.mjs`的导航投影；因此不能只拷贝`src/`便认为拿到了完整阅读器。

## 3. 目录职责与版本控制

| 路径 | 内容与权威 | 提交规则 |
| --- | --- | --- |
| `maps/<专题>/README.md` | frontmatter定义模块、图边、失败、来源；手写正文解释语义 | 提交正典及同文件生成区；只编辑正典/正文，生成区由工具维护 |
| `maps/README.md`、`00-diagram-standard.md` | 内容导航、关系与证据约定 | 提交手工文档 |
| `maps/01-file-index.md`、`02-diagram-register.md` | 全量文件与图的Git阅读入口 | 提交经过检查的派生稿；不独立手改 |
| `journeys/*.md` | 跨专题阅读路径，显式调用/绑定/宿主动作/选路 | 提交正典和生成区；示例与实际运行分开 |
| `objects/*.md` | 身份、生产/消费方、持久化、失效和阶段说明 | 提交正典和生成区；阅读阶段不自动变成产品状态枚举 |
| `evidence/scenarios.json` | 要执行哪些case、证明什么、fixture和限制 | 提交场景正典；它本身不是测试结果 |
| `evidence/runs/Vxx.json` | 有界便携回执及原材料引用/摘要 | 实际执行且复验后提交；保留实际failed/stale等状态，不手改passed |
| `evidence/README.md` | 从场景/回执生成的Git阅读稿 | 与相关正典和回执同批提交 |
| `reviews/records.json` | 追加的原始审阅定位与SHA索引 | 提交并保持追加历史；不重置、不改旧摘要 |
| `data/` | 手工控制输入、派生阅读快照与独立验收回执三类文件 | 按下一节分类保留；不能整目录忽略 |
| `src/`、`schemas/`、`scripts/` | 阅读器、共享模型、维护/构建/验证实现 | 提交正式工程源码；`scripts`也有构建必需依赖 |
| `test/` | Atlas自身逻辑与临时fixture测试 | 提交；通过不等于产品测试通过 |
| `probes/` | 显式运行的Core恢复夹具、受控观察输出、独立配置 | 提交；它们是可重验源码，不是测试输出 |
| 根配置与lock | 包、编译、格式、站点、构建与依赖锁定 | 提交；保持private和独立依赖边界 |
| `.build/`、`node_modules/` | 构建站点、临时报告、探针中间输出、一次性工作脚本、安装依赖 | 排除，不作为可提交源；不因此自动删除本地调试材料 |
| `reviews/.append.lock`、`records.json.tmp` | 短时排他锁和原子替换中间文件 | 排除；遗留锁先查owner，不自动抢占 |

### data 的三类文件

`data/`体积大，主要原因是保留了可脱离原workspace阅读的索引和内容快照。可生成不等于可以从当前版本中删除；静态构建直接读取其中九份文件。

| 文件 | 来源 / 消费者 | 编辑方式 |
| --- | --- | --- |
| `topic-ownership.json` | 文件唯一主归属；inventory/structure消费 | 明确复审后维护，新增源码不能自动获得归属 |
| `known-risks.json` | 已核实风险登记；历史页及派生摘要消费 | 人工维护，不从none或测试数量推断缺陷 |
| `provenance-inputs.json` | 原审阅/语义材料的固定SHA；provenance消费 | 原件确认后显式追加；不为消除错误重绑 |
| `product-boundary.json` | Core package/tsconfig隔离基线 | 受控维护，不能用重写基线掩盖越界修改 |
| `source-inventory.json` | Core路径/字节/归属/阅读投影 | `inventory:write`生成；文件页、搜索和身份检查消费 |
| `import-graph.json` | TypeScript静态导入分析 | 生成；F0/变更影响消费，不能解释为运行调用图 |
| `public-api.json` | Core exports政策与TS checker公开绑定 | 生成；API与搜索消费 |
| `source-symbols.json` | 文件声明与符号索引 | 生成；搜索消费，非全部公共API |
| `documents.json` | 专题正典与手写正文的快照 | 生成；专题资源、搜索消费 |
| `book-index.json` | 模块/失败/旅程/对象/case及显式引用 | 生成；book页面、导航、搜索和影响消费 |
| `topic-index.json` | 主题导航、归属数和入口 | 生成；bootstrap消费 |
| `validation-summary.json` | 来源观测、内容计数与Atlas版本 | 生成；bootstrap消费；checkedAt不是产品执行时间 |
| `review-summary.json` | 原记录、追加记录与历史产品测试范围 | 生成；历史页/bootstrap消费；历史不得冒充新执行 |
| `tool-versions.json` | 实际工具版本 | 生成并参与维护/阅读身份检查，不直接作为页面主体 |
| `render-receipt.json` | 显式浏览器渲染产生的观察与身份 | 真实渲染后提交；`inventory:write`不能替代 |
| `reader-receipt.json` | 真实交互观察与UI/内容身份 | 真实操作后记录并提交；构建不能自动签发 |

前四份是控制输入，中间十份是可再生成快照，最后两份是验收回执。删除、过期、原始材料缺失和未执行是不同状态。

## 4. 工程文件地图

### 阅读器和共享投影

| 文件 | 主要职责 |
| --- | --- |
| `src/main.ts` | shell、hash路由、搜索、索引页、专题编排与副作用管理 |
| `src/loader.ts` | 资源完整性、缓存/重试和旧请求失效 |
| `src/content.ts` | HTML转义、Markdown净化、标题slug |
| `src/book-content.ts` | 旅程、对象、失败与运行页HTML |
| `src/book-model.ts` | 稳定ID路由、引用校验、书籍索引、搜索与影响；脚本/浏览器共享 |
| `src/deep-content.ts` | 模块与失败说明的共同Markdown投影和校验 |
| `src/case-content.ts` | case结论、断言、实际观察与范围的共同投影 |
| `src/graph-model.ts` | 正典图、Mermaid、Cytoscape与依赖精选的共同身份 |
| `src/renderer.ts` | Mermaid渲染、净化、阅读/缩放/拖动/全屏和清理 |
| `src/interactive-graph.ts` | 延迟Cytoscape/ELK依赖图及布局 |
| `src/render-config.ts` | 阅读器与验证共同使用的图配置 |
| `src/verify.ts` | 显式图形验证与固定端点回执保存 |
| `src/styles.css` | 视口布局、主题、滚动容器与锚点 |
| `src/vendor.d.ts` | 第三方与虚拟模块的类型声明；不是第三方runtime副本 |

`schemas/model.ts`、`book.ts`、`browser.ts`定义编译期模型；`document.schema.json`只覆盖专题顶层结构，深层字段/来源/引用由专用检查器补充。

### 维护、构建与执行脚本

| 文件 | 实际职责与写入边界 |
| --- | --- |
| `scripts/atlas.mjs` | CLI总编排；读源码/测试/配置/ledger，`inventory --write`才写派生内容 |
| `scripts/analysis.mjs` | TS解析、公开绑定、断言与owner定位；静态读，不执行产品 |
| `scripts/contracts.mjs` | 路径、摘要、漂移、结构、链接、隔离和回执规则 |
| `scripts/snapshot-state.mjs` | 幂等写、checkedAt保持、唯一归属与原材料固定摘要 |
| `scripts/book.mjs` | 读旅程/对象/场景，复验运行记录；导航和阅读稿投影 |
| `scripts/projections.mjs` | 模块/失败/图/文件库存的Markdown生成 |
| `scripts/browser-assets.mjs` | 九类data输入到分用途哈希资源与bootstrap |
| `scripts/browser-plugin.mjs` | Vite虚拟模块、资源服务、bundle输出和重载策略 |
| `scripts/check-build.mjs` | 只读实际构建产物，检查入口预算与资源身份 |
| `scripts/check-portable.mjs` | 临时脱离Core/ledger/消费者构建；写tmp与`.build/portable-*` |
| `scripts/reviews.mjs` | spec校验、追加ledger原件、原子更新manifest |
| `scripts/run-contracts.mjs` | 运行预期、case及观察评估；不启动测试 |
| `scripts/run-evidence.mjs` | 显式启动选定Core测试/probe，写原始ledger与便携回执 |
| `scripts/run-records.mjs` | 只读原材料并重新核对来源、harness、case与观察 |
| `scripts/verify-server.mjs` | 启动独立渲染服务，按钮操作后写固定两份回执 |
| `scripts/maintenance-probe.mjs` | 在临时文件系统演练维护链；不改产品源 |

`test/`是Node测试：分析、投影、加载、来源、追加审阅和运行材料规则；其中临时文件系统测试确实会创建并清理tmp。`probes/recovery.test.ts`和`persistence-recovery.test.ts`才实际调用所选Core功能；`observation.ts`写受控观察，`vitest.config.ts`与`tsconfig.json`明确workspace依赖。

## 5. 一次性复审输入与原件

先实际复审目标文件，再在`.build/review-drafts/review.json`准备本次输入。字段和规则以`reviews.mjs`的`validateRecord`为准：唯一id、Core相对path、当前sourceSha256、readLevel/scope、method/conclusion、实际reviewedAt、responsibility/flow及supersedesId。

```sh
npm run review:append -- .build/review-drafts/review.json
npm run inventory:write
npm run check:provenance
```

成功追加会把原件写入`<workspace>/wakeflow-ledger/AlembicCore/architecture-atlas/reviews/...`，并更新仓内`reviews/records.json`。后续检查读取原件与索引，不消费草稿。保留原件及追加历史；已发布输入与原件完全相同后，不需要再在仓内保存第三份副本。

阅读器验收目前没有通用的正式录入CLI：真实操作后用`readerIdentity()`绑定观察，保存`data/reader-receipt.json`及ledger副本。`.build/record-reader*.mjs`是历史一次性脚本，含旧日期和具体观察，不能直接提交或当作新验收重放。应在专门的维护改进中提取通用录入入口，使用本轮真实观察。

## 6. 什么应排除，什么应一起提交

必须排除：`node_modules/`、`.build/`（含site、runs、报告、截图、调试/采用脚本与复审草稿）、`*.tsbuildinfo`、追加锁/临时manifest、本机环境文件、包管理debug日志和OS元数据。`.env.example`只有经审阅的无秘密模板才可提交；当前工程没有要求新增环境配置。

原始审阅、执行console/report/observations/receipt、截图和跨仓协作记录留在Core ledger。仓内只保留已审阅的正典、固定引用和可移植摘要。不要用`data/*`、`*.json`、`probes/`或全部`scripts/`这种宽泛规则清理正式能力。

| 改动类型 | 同批提交内容 | 验证与回执要求 |
| --- | --- | --- |
| 解释/关系 | 正典及受影响的派生Markdown/data | 结构/来源/链接检查；图或页面内容改变后补相应真实验收 |
| 阅读器/浏览器投影 | src、实际构建依赖、相关测试 | Atlas检查与真实阅读复验；仅改脚本也可能改变浏览器资源 |
| 恢复场景/probe | 场景、probe、必要测试、新便携回执、更新派生稿 | 显式运行；共享harness变化按当前保守范围重新执行，旧原件保留 |
| 文件复审 | 追加manifest、更新派生阅读状态 | 原ledger可用且摘要匹配；一次性输入不进Git |
| 依赖/渲染器 | package和lock、相关源码/测试 | 类型、构建、渲染/阅读身份与实际复验 |
| 文件政策/维护说明 | 本文件、README、必要ignore规则 | 引用/忽略范围与现有检查；不伪造新的产品或UI执行 |

`npm run check`包含格式检查而非Biome lint；它会运行Atlas测试并构建`.build/site/`，但不会执行`evidence:run`。`check:portable`也会写临时副本和报告；命令名含check不代表零写入。原ledger可用时另跑`check:provenance`。

提交前分别查看工作树、暂存区及未跟踪文件。当前隔离检查只看未暂存路径，仍需人工合并核对，不能单靠其绿色判定无越界。只选择本次明确文件，不使用`git add -A`把仓库外既存本地工件带入。

## 7. 审阅与维护的边界

保留现有稳定ID、旧书签和回执历史。文件组织变更不能靠重写来源摘要或日期获得通过。修复内容投影、回执身份及验证器规则应作为独立行为变更，先补可重现反例，再完成对应验收；不与大型目录重排或删除派生快照混在一起。
