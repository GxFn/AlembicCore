# AlembicCore Architecture Atlas

独立的中文架构阅读器：17 个问题专题、逐文件来源、公共入口、业务调用、状态恢复与变更影响。正式 Markdown 在 [maps](maps/README.md)，包含从同页正典生成的 Mermaid 与逐边证据表。

```sh
cd alembic-core-architecture-atlas
npm ci
npm run dev
```

浏览 `http://127.0.0.1:4173/`。工具链使用 Node >=24.19 <25；Core 原有 Node >=22 契约不变。站点仅本地预览，不包含发布或远程服务配置。

## 阅读路线

- 理解职责：[总体与宿主边界](maps/01-overall-package-boundaries/README.md) → [事实责任](maps/03-database-and-repositories/README.md) → [公共 API 索引](data/public-api.json)。
- 跟踪一次写入：[知识持久化](maps/10-knowledge-authoring-persistence/README.md) → [恢复与提案](maps/14-sustain-proposals/README.md)。
- 跟踪一次分析：[ProjectContext](maps/06-project-context/README.md) → [源码索引](maps/07-source-graph/README.md) → [严格生产](maps/15-strict-production-authority/README.md)。
- 修改前定位：[文件库存](maps/01-file-index.md)、[图登记](maps/02-diagram-register.md)，以及阅读器“变更影响”。

## 维护命令

| 命令 | 行为 |
| --- | --- |
| `inventory:check` | 只读比较全量库存、导入图和 exports 投影 |
| `inventory:write` | 显式更新派生库存/索引/图表；不改手工语义、图边或审阅指纹 |
| `check:structure` | schema、精确源符号、测试case/断言、唯一归属、生成表与文档链接 |
| `check:current` | 源码及配置/测试/真实消费者指纹，新增删除改名漂移 |
| `check:provenance` | 受控 ledger 原阅读记录匹配；缺失报告 original-unavailable |
| `render:verify` | 独立本地服务；在浏览器显式点击后实际渲染每图并生成固定路径回执 |
| `check:render` | 只读检查图源、实际版本、配置与harness是否仍匹配已有回执 |
| `check:reader` | 复验独立 UI/内容摘要与代表视口交互记录 |
| `typecheck:probes` | 独立检查Atlas探针及其引用的Core类型；不修改产品tsconfig |
| `check:isolation` | 检查产品包、脚本、依赖和构建边界未引入 Atlas |
| `check` | helper测试、类型、结构、来源、回执、隔离和独立构建 |

`render:verify` 地址是 `http://127.0.0.1:4174/?verify=1`。回执写入 `.build/render-receipt.json` 与有界派生 `data/render-receipt.json`；原始副本和人工交互记录归 ledger。阅读器响应式验收覆盖 1440×900、1024×768、390×844。更改代码后，维护者要用真实浏览器重验，再以 `readerIdentity()` 绑定当前 UI/内容摘要保存记录，不能手工造 pass。

## 证据边界

库存是944项产品来源的基线；665个源码/脚本/native worker有唯一主专题。计数由工具生成，实际变化应按差异解释。L3表示本轮对已画关系逐边核对；既有逐文件 full/partial/asset 不改为全量语义验证。产品测试引用此前回执，本轮没有重新执行全量产品测试。R01–R11保留为已观察、未修复问题。

每页指纹采用版本化长度定界路径+原始字节 SHA-256。消费者按仓库名与相对路径绑定。便携站点显示核验时刻的摘要，不读取实时工作树，也不能重新访问原 ledger；本地 `check:provenance` 才核验原始记录。

## 第二轮阅读与维护

首屏只携带专题导航和来源摘要；正文、文件索引、公共API、搜索与变更影响从按内容摘要命名的资源读取。Mermaid在进入专题时加载，Cytoscape/ELK在点击交互图时加载。每份资源校验字节数、SHA-256、用途与身份，失败保留明确错误并允许重试；旧请求不会覆盖新选择。

全局搜索独立于已访问页面，覆盖文件内声明与公开导出别名。命中声明不意味着该符号是公共API，界面会区分两者。`npm run check:build`核验实际首屏静态依赖及输出资源，防止完整索引或图引擎再次进入初始包。

`inventory:write`在输入未变时保留原`checkedAt`、产品基线和输出字节；源码、测试、配置或消费者的实际变化仍会使来源与阅读回执过期。新增源码必须有唯一归属且进入对应页面审阅输入，刷新库存不能代替语义复核。原ledger记录必须匹配已固定摘要，缺失或变动时拒绝重绑；已有派生快照仍可直接构建和浏览。

构建后可用`npm run preview`查看实际静态产物。普通浏览和构建均不写阅读记录、产品数据或验证回执。

输出在 ignored `.build/site/`。Core发布白名单不包含本目录；不修改Core运行时、包入口、依赖或发布流程。未来 Agent 复用属于独立阶段。

## 第三轮模块与恢复深化

2026-10-22第三轮的17个专题包含110个功能单元、103项失败/降级/停止情形，以及67张图（本轮新增17张）。每页按“功能单元 → 调用图 → 失败后的状态与恢复责任”展开；功能表说明入口、输入输出、调用、副作用和边界，恢复表说明已经留下什么、Core自动做什么、谁显式恢复、何时必须停止。

排查时可沿以下入口阅读：

- 文件与数据库分歧：[知识写入](maps/10-knowledge-authoring-persistence/README.md)、[UnitOfWork有限补偿](maps/03-database-and-repositories/README.md)。
- 输入不完整与索引恢复：[实时查询](maps/06-project-context/README.md)、[源码代际](maps/07-source-graph/README.md)、[认证工件](maps/08-certified-project-facts/README.md)。
- 中断与重新执行：[计划/会话/检查点](maps/09-planning-host-workflows/README.md)、[严格生产](maps/15-strict-production-authority/README.md)、[关闭与事件](maps/16-runtime-events-lifecycle/README.md)。

[FigJam辅助图：知识写入与显式恢复](https://www.figma.com/board/NFOhWgtow19Hss7laEFzpC)用于快速讨论创建/更新路径，详细依据以仓库正典为准。它不覆盖删除、批次补偿或衍生效果的全部失败语义。

新增内容仍为L3源码/断言复核，没有重跑或修复产品。功能与恢复字段由同一个投影生成Git Markdown和阅读器正文；`check:structure`同时检查字段完整性、真实owner内摘录及case内断言，`inventory:write`不代替人工语义复核。

## 0.2：业务旅程、精确定位与运行证据

0.2交付的详情层为119个功能单元、116项失败情形和70张图。该阶段新增的四条旅程使用同一正典中的模块、图边和失败引用：

- [J01 知识提交到可查询](journeys/j01.md)：区分创建、同步、发布、向量维护与查询完成。
- [J02 源码到关系证据与认证](journeys/j02.md)：分别选择live、索引和冻结读取。
- [J03 严格计划到分析回执](journeys/j03.md)：完整分母、义务执行、population/cluster、归纳与反证。
- [J04 独立评审到持久化与Serving合同](journeys/j04.md)：准入、同身份恢复、覆盖及显式发布边界。

阅读器新增“业务旅程”“核心对象”“失败与恢复”“运行证据”。搜索`M10-02`或`K3-CREATE`可直接定位条目，模块改名不改变稳定ID。图边、对象和失败条目可以返回关联旅程步骤。包入口深链精确定位相应exports规则；自由输入仍支持模糊检索。

[运行证据](evidence/README.md)与L3断言定位分开。只有实际执行、所有预期case通过、原始报告/console/观察/回执一致、完整产品来源与harness/工具身份匹配时，维护检查才接受通过。缺材料、篡改、零测、全skip、源变或工具变动不会沿用绿色。浏览器只展示生成时快照，不实时连接ledger。

```sh
npm run evidence:run -- V01     # 明确执行一个受控场景；all执行五组
npm run inventory:write        # 显式刷新派生阅读数据
npm run check:evidence         # 复验原始材料与来源，不执行测试
npm run maintenance:probe      # 临时文件系统演练维护闭环，不改产品源
npm run check:portable         # 缺Core源、ledger和消费者的临时副本构建检查
npm run review:append -- reviews/output-budget-review.json
```

新文件复核记录只追加，绑定路径、精确字节、scope、method、结论和原始材料摘要。同ID相同记录重试不重写；冲突先拒绝，旧记录不删除。准备自己的spec前必须实际阅读文件；命令不会替代语义判断。更改源码、测试或消费者后，变更影响页同时列出关联模块、失败、对象、旅程和运行材料。

运行回执目前保守绑定完整Core产品库存，因此来源变化可能要求重跑全部选定样本；主要实现路径仅是导航，不冒充完整传递依赖。全量产品测试历史仍单列。八个核心对象说明身份、生产/消费方、持久化、失效和阶段含义，不把所有说明性阶段都称作持久状态机。

便携使用可直接构建/浏览已保存派生快照；缺少原ledger或消费者仓库时不能在新位置签发来源/运行通过。工作区`check`需要这些材料，静态build与普通页面不读取产品运行数据。版本0.2与内容摘要标识Atlas；SOURCE hash标识所依据的Core源码，二者不是同一种版本。

## 0.3：四条恢复链与逐case证据

当前详情层为121功能单元、124失败情形、74图；5条旅程36步骤、9个核心对象。17专题保持L3，运行证据按所列case单独解释。

- [知识删除](journeys/j05.md)：文件拒绝、文件已删而DB拒绝、后置listener失败分别检查；只有主行仍在的分歧才按同ID delete重试。
- [syncAll后置维护](maps/10-knowledge-authoring-persistence/README.md#graph-knowledge-sync-post-maintenance)：DB效果、调用completed、嵌套业务报告与真实store分开。V07包含真实HNSW恢复，以及短暂读取失败与真实缺文件的对照。
- [Prepared重放](maps/15-strict-production-authority/README.md#graph-strict-prepared-replay)：同完整身份先授权/inspect，已有精确记录避免再次create。V08是内存/注入端口合同，未证明真实文件、SQLite、journal或进程恢复。
- [WAL checkpoint](maps/15-strict-production-authority/README.md#graph-strict-wal-checkpoint)：真实双连接中reader阻挡、owner释放、显式重试；回执hash与当次主文件独立比较。

V06–V09为每个选定case保存稳定ID、精确测试文件/完整标题、业务结论、故障/动作、断言与状态观察映射。失败卡、模块及具体旅程步骤可直达case再返回。执行通过与正常路径、恢复验证、拒绝验证、边界观察、风险观察分别显示；历史或缺材料不支持当前结论。V01–V05仍保持原run级范围，没有自动补成逐case覆盖。

`check:evidence`从固定原始report/observations重新核对case和实际字段，包括hash字段间比较；不以自报布尔替代实际读数。回执不能覆盖正典claim/outcome/refs。缺失、错归属、坏形状及评估异常保留失败状态；历史材料不重写。

失败页新增“尚无模块归属 / 尚无分步恢复清单 / 尚无逐case映射”筛选，分类仅服务阅读。恢复清单给出观察源码与字段，没有的产品观测不虚构。根README的两份新阅读记录以追加方式保存。

在Atlas目录使用`npm run evidence:run -- V06`至`V09`显式复验，或`all`执行九组。修改共享harness后旧证据会过期，应产生新原始记录并刷新派生快照。实际结果及fixture限制见[运行证据](evidence/README.md)；本阶段不修复Core产品、不接管Agent，也未重跑全量产品测试。
