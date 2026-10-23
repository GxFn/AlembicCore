# 图谱登记

由同页正典与静态导入选择集生成。所有 F0 都是明确选择集，不声称展示完整仓库图。

| 图 ID | 问题视图 | 专题 | 节点 / 边 |
| --- | --- | --- | --- |
| `core-package-facades` | A0：按职责进入公共门面 | [01](01-overall-package-boundaries/README.md) | 4 / 3 |
| `r3-core-recovery-owners` | R0：不同持久化owner的失败去向 | [01](01-overall-package-boundaries/README.md) | 6 / 3 |
| `dependencies-01` | F0：文件依赖精选 · 静态关系 | [01](01-overall-package-boundaries/README.md) | 4 / 3 |
| `workspace-write-coordinate` | V0：从工作区坐标到一次受限写入 | [02](02-workspace-config-io/README.md) | 6 / 5 |
| `writezone-cross-device-move` | R0：跨设备移动：自动复制与无法证明的回滚 | [02](02-workspace-config-io/README.md) | 5 / 4 |
| `dependencies-02` | F0：文件依赖精选 · 静态关系 | [02](02-workspace-config-io/README.md) | 10 / 10 |
| `database-open-and-bind` | F1：打开数据库并装配仓储 | [03](03-database-and-repositories/README.md) | 6 / 5 |
| `migration-replay-state` | R0：迁移记录与显式重跑 | [03](03-database-and-repositories/README.md) | 4 / 3 |
| `knowledge-uow-partial-compensation` | R0：批次文件失败的有限补偿与DB分歧 | [03](03-database-and-repositories/README.md) | 6 / 5 |
| `dependencies-03` | F0：文件依赖精选 · 静态关系 | [03](03-database-and-repositories/README.md) | 10 / 14 |
| `syntax-evidence-and-tree` | F1：同次语法观察与 Tree 释放 | [04](04-syntax-facts-linking/README.md) | 4 / 3 |
| `import-binding-resolution` | F1：词法导入绑定到导出声明 | [04](04-syntax-facts-linking/README.md) | 4 / 3 |
| `syntax-partial-propagation` | F1：调用提取不完整如何流向不同消费者 | [04](04-syntax-facts-linking/README.md) | 6 / 5 |
| `dependencies-04` | F0：文件依赖精选 · 静态关系 | [04](04-syntax-facts-linking/README.md) | 9 / 12 |
| `discovery-choice` | V0：发现器选择及无匹配回退 | [05](05-discovery-and-intelligence/README.md) | 4 / 3 |
| `framework-to-rules` | F1：真实清单到增强包 Guard 规则 | [05](05-discovery-and-intelligence/README.md) | 5 / 4 |
| `discoverer-session-reader-and-cancel` | R0：严格reader装配与旧实例取消排空 | [05](05-discovery-and-intelligence/README.md) | 6 / 5 |
| `dependencies-05` | F0：文件依赖精选 · 静态关系 | [05](05-discovery-and-intelligence/README.md) | 6 / 5 |
| `pc-request` | F1：请求规范化、派发与结果封装 | [06](06-project-context/README.md) | 5 / 4 |
| `pc-session` | S0：session正常返回、失败与finally排空释放 | [06](06-project-context/README.md) | 6 / 8 |
| `pc-handler-facts` | F1：file-flow怎样复用安全读取与同版本语法事实 | [06](06-project-context/README.md) | 6 / 6 |
| `dependencies-06` | F0：文件依赖精选 · 静态关系 | [06](06-project-context/README.md) | 10 / 13 |
| `sg-build` | F1：库存到事务性代际发布 | [07](07-source-graph/README.md) | 6 / 5 |
| `sg-refresh` | R0：新鲜度检查与增量恢复 | [07](07-source-graph/README.md) | 5 / 5 |
| `sg-evidence` | V0：当前正文必须与引用hash一致 | [07](07-source-graph/README.md) | 5 / 4 |
| `sg-partial-conservation` | S0：本轮与沿用解析缺口怎样影响新代状态 | [07](07-source-graph/README.md) | 7 / 7 |
| `dependencies-07` | F0：文件依赖精选 · 静态关系 | [07](07-source-graph/README.md) | 9 / 16 |
| `certified-capture-freeze` | V0：接受的 scope 到认证工件 | [08](08-certified-project-facts/README.md) | 6 / 5 |
| `certified-durable-consumption` | R0：不可变落盘与租约消费 | [08](08-certified-project-facts/README.md) | 6 / 5 |
| `foundation-lease-state-and-replay` | S0：Preparation租约状态与显式中断重放 | [08](08-certified-project-facts/README.md) | 5 / 5 |
| `dependencies-08` | F0：文件依赖精选 · 静态关系 | [08](08-certified-project-facts/README.md) | 8 / 11 |
| `hw-packet` | F1：ProjectContext事实到有界任务包 | [09](09-planning-host-workflows/README.md) | 5 / 4 |
| `hw-session` | S0：维度完成到会话恢复 | [09](09-planning-host-workflows/README.md) | 5 / 4 |
| `hw-checkpoints` | R0：耐久结果成功后才能清理恢复点 | [09](09-planning-host-workflows/README.md) | 5 / 4 |
| `hw-plan-modes` | F1：full与rescan共享计划如何选择扫描和清理边界 | [09](09-planning-host-workflows/README.md) | 7 / 7 |
| `strict-plan-compilation` | F1：完整严格计划：校验、完整分母与上限拒绝 | [09](09-planning-host-workflows/README.md) | 9 / 8 |
| `dependencies-09` | F0：文件依赖精选 · 静态关系 | [09](09-planning-host-workflows/README.md) | 4 / 2 |
| `knowledge-create` | F1：知识创建的文件优先提交 | [10](10-knowledge-authoring-persistence/README.md) | 6 / 6 |
| `knowledge-recovery` | R0：文件与数据库分歧的显式恢复 | [10](10-knowledge-authoring-persistence/README.md) | 7 / 6 |
| `r3-authoring-and-sync-effects` | A1：校验、创建与同步的不同完成边界 | [10](10-knowledge-authoring-persistence/README.md) | 8 / 6 |
| `knowledge-delete-recovery` | R0：删除失败后先确定哪一段已完成 | [10](10-knowledge-authoring-persistence/README.md) | 10 / 11 |
| `knowledge-sync-post-maintenance` | R0：syncAll先改变DB，再等待独立维护 | [10](10-knowledge-authoring-persistence/README.md) | 9 / 10 |
| `dependencies-10` | F0：文件依赖精选 · 静态关系 | [10](10-knowledge-authoring-persistence/README.md) | 9 / 9 |
| `retrieval-live-truth` | F1：召回、真相过滤与有界补窗 | [11](11-retrieval-recipe-context/README.md) | 6 / 6 |
| `r3-retrieval-stop-and-degrade` | R0：检索中的降级与停止 | [11](11-retrieval-recipe-context/README.md) | 7 / 6 |
| `dependencies-11` | F0：文件依赖精选 · 静态关系 | [11](11-retrieval-recipe-context/README.md) | 5 / 4 |
| `vector-generation-visibility` | S0：影子代际到可见路由 | [12](12-vector-generations/README.md) | 8 / 8 |
| `r3-file-index-and-wal` | R0：文件索引与WAL确认边界 | [12](12-vector-generations/README.md) | 8 / 7 |
| `dependencies-12` | F0：文件依赖精选 · 静态关系 | [12](12-vector-generations/README.md) | 9 / 18 |
| `guard-audit-feedback` | F1：分层审计与独立反馈循环 | [13](13-guard-feedback/README.md) | 7 / 6 |
| `r3-guard-uncertainty` | R0：Guard的skip、uncertain和反馈前提 | [13](13-guard-feedback/README.md) | 7 / 5 |
| `dependencies-13` | F0：文件依赖精选 · 静态关系 | [13](13-guard-feedback/README.md) | 10 / 18 |
| `proposal-update-and-failure` | R0：update提案与被吞掉的补丁失败 | [14](14-sustain-proposals/README.md) | 7 / 6 |
| `r3-staging-two-phase-effects` | R0：staging晋级、复核与分段发布 | [14](14-sustain-proposals/README.md) | 8 / 7 |
| `dependencies-14` | F0：文件依赖精选 · 静态关系 | [14](14-sustain-proposals/README.md) | 10 / 16 |
| `strict-facts` | F1：完整冻结分母到事实执行回执 | [15](15-strict-production-authority/README.md) | 6 / 5 |
| `strict-authority` | V0：统一authority的证据重验顺序 | [15](15-strict-production-authority/README.md) | 7 / 7 |
| `strict-recovery` | R0：私有revision与公共route的独立恢复边界 | [15](15-strict-production-authority/README.md) | 8 / 6 |
| `strict-admission-persistence` | F1：完整准入、独立G2与真实prepared写入口 | [15](15-strict-production-authority/README.md) | 10 / 9 |
| `strict-final-serving` | V0：持久绑定、候选覆盖与最终serving绑定 | [15](15-strict-production-authority/README.md) | 7 / 6 |
| `strict-durable-review` | F1：实际取证、独立host执行与跨进程durable消费 | [15](15-strict-production-authority/README.md) | 8 / 7 |
| `strict-population-cluster-formation` | V0：执行分母如何变为 population 与机制簇 | [15](15-strict-production-authority/README.md) | 8 / 7 |
| `strict-induction-falsification-formation` | V0：归纳与反证回执：先保留分母，再作有界判定 | [15](15-strict-production-authority/README.md) | 10 / 10 |
| `strict-prepared-replay` | R0：Prepared重放：先重验授权，再精确inspect | [15](15-strict-production-authority/README.md) | 10 / 13 |
| `strict-wal-checkpoint` | R0：WAL checkpoint：已提交不等于主文件可签 | [15](15-strict-production-authority/README.md) | 9 / 9 |
| `dependencies-15` | F0：文件依赖精选 · 静态关系 | [15](15-strict-production-authority/README.md) | 9 / 17 |
| `job-terminal-protection` | S0：作业状态与晚到结果保护 | [16](16-runtime-events-lifecycle/README.md) | 6 / 6 |
| `events-signals-waiting` | F1：信号桥接与事件等待语义 | [16](16-runtime-events-lifecycle/README.md) | 5 / 4 |
| `r3-shutdown-resource-ownership` | R0：关闭hook的顺序、失败隔离与强退 | [16](16-runtime-events-lifecycle/README.md) | 6 / 5 |
| `dependencies-16` | F0：文件依赖精选 · 静态关系 | [16](16-runtime-events-lifecycle/README.md) | 8 / 6 |
| `verification-authority-inputs` | E0：包边界与层规则的验证输入 | [17](17-contracts-tooling-verification/README.md) | 7 / 6 |
| `consumer-import-verification` | E0：消费者import扫描与策略判定 | [17](17-contracts-tooling-verification/README.md) | 5 / 4 |
| `r3-release-readiness-gates` | E0：从源码与打包清单到发布准备报告 | [17](17-contracts-tooling-verification/README.md) | 7 / 6 |
| `dependencies-17` | F0：文件依赖精选 · 静态关系 | [17](17-contracts-tooling-verification/README.md) | 2 / 1 |
