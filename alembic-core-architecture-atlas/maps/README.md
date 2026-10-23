# AlembicCore 架构专题

从问题进入，沿图边回到源码与断言。[图与证据规范](00-diagram-standard.md) · [文件库存](01-file-index.md) · [图登记](02-diagram-register.md)。

- [01 总体、公开包与宿主边界](01-overall-package-boundaries/README.md)：Core提供什么，哪些能力由外层拥有？
- [02 工作区、配置与IO](02-workspace-config-io/README.md)：projectRoot/dataRoot、Ghost、多根与读写边界怎样配合？
- [03 数据库与仓储](03-database-and-repositories/README.md)：事务、迁移、文件真相、运行数据分别由谁拥有？
- [04 语法、文件事实与链接](04-syntax-facts-linking/README.md)：解析、提取与跨文件绑定各能证明什么？
- [05 发现、框架与架构信号](05-discovery-and-intelligence/README.md)：模块、依赖、框架与启发式信号从哪里来？
- [06 ProjectContext查询](06-project-context/README.md)：如何由space/repo收敛到源码片段，处理预算、取消与部分结果？
- [07 源码关系索引](07-source-graph/README.md)：完整/增量代际、关系查询与freshness怎样保持一致？
- [08 认证项目事实](08-certified-project-facts/README.md)：输入冻结、回放、readiness、manifest及消费者回执怎样绑定？
- [09 规划与宿主工作流](09-planning-host-workflows/README.md)：intent、briefing、unit、session、coverage和snapshot怎样衔接？
- [10 知识创作与持久化](10-knowledge-authoring-persistence/README.md)：candidate/recipe、校验、file-first写入和sync如何闭环？
- [11 检索与RecipeContext](11-retrieval-recipe-context/README.md)：候选召回如何经过live truth、过滤、排序与预算？
- [12 向量与代际](12-vector-generations/README.md)：文件与Recipe region两条索引怎样写入、切换和恢复？
- [13 Guard与反馈](13-guard-feedback/README.md)：规则筛选、分层检查、不确定结果与反馈怎样运行？
- [14 维护与提案](14-sustain-proposals/README.md)：drift、decay、consolidation与proposal怎样改变知识？
- [15 严格生产与发布证据](15-strict-production-authority/README.md)：完整事实、独立评审、准入、私有revision与serving如何绑定？
- [16 运行时契约与观测](16-runtime-events-lifecycle/README.md)：job/resident、事件、信号、日志与资源释放各保证什么？
- [17 契约、工具与验证](17-contracts-tooling-verification/README.md)：exports/wire/层规则、维护脚本和发布边界怎样验证？
