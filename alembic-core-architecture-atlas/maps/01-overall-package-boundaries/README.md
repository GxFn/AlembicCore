---
topicId: "01"
title: 总体、公开包与宿主边界
question: Core提供什么，哪些能力由外层拥有？
sourcePaths:
  - src/capability.ts
  - src/config.ts
  - src/core/analysis/index.ts
  - src/database.ts
  - src/dimensions.ts
  - src/domain/index.ts
  - src/enhancement.ts
  - src/events.ts
  - src/evolution.ts
  - src/guard.ts
  - src/host-agent-workflows.ts
  - src/index.ts
  - src/infrastructure/index.ts
  - src/io.ts
  - src/knowledge.ts
  - src/logging.ts
  - src/memory.ts
  - src/plans.ts
  - src/production.ts
  - src/project-context-capabilities.ts
  - src/project-context.ts
  - src/projectContextFoundation.ts
  - src/recipe-context-capabilities.ts
  - src/report.ts
  - src/repositories.ts
  - src/search.ts
  - src/service/index.ts
  - src/service/knowledge/commitKnowledgeWrite.ts
  - src/service/project-context/ProjectContextService.ts
  - src/service/source-graph/SourceGraphIndexer.ts
  - src/service/source-graph/SourceGraphLifecycle.ts
  - src/shared/OutputBudget.ts
  - src/sustain.ts
  - src/test-fixtures.ts
  - src/vector.ts
  - src/workflows/surfaces/persistence/WorkflowResultPersistence.ts
  - src/workspace.ts
testPaths:
  - test/CoreCodexBoundary.test.ts
  - test/CoreDeliveryBoundary.test.ts
  - test/CorePackage.test.ts
  - test/CoreToolSystemBoundary.test.ts
  - test/KnowledgeServicePersistence.test.ts
  - test/OutputBudget.test.ts
  - test/ProjectContextFoundation.test.ts
  - test/PublicHostAgentWorkflowEntrypoints.test.ts
  - test/SourceGraphIndexer.test.ts
consumerRefs:
  - repository: Alembic
    path: lib/injection/modules/KnowledgeModule.ts
    excerpt: |-
      new KnowledgeService(
              ct.get('knowledgeRepository'),
    meaning: Main 的 DI 装配真实消费公开知识服务；端口在宿主注入。
risks:
  - 门面可见性、静态 import 与实际运行是三种不同证据；未接线的公共能力不能画成宿主必经链。
  - 公开类型必须以 exports 和编译器导出解析为准；内部同名声明不代表合法公共符号。
diagrams:
  - id: core-package-facades
    title: 按职责进入公共门面
    viewType: A0
    description: 边表示公开暴露关系，不表示执行调用。ProjectContext 的内部 SourceGraph 服务没有被根门面聚合暴露。
    nodes:
      - id: package
        label: "@alembic/core 公共包"
        role: boundary
      - id: knowledge
        label: 知识创建与持久化
        role: service
        path: src/knowledge.ts
        symbol: KnowledgeService
      - id: project
        label: 实时源码与关系查询
        role: service
        path: src/project-context.ts
        symbol: ProjectContext
      - id: workspace
        label: 源码根与数据根
        role: service
        path: src/workspace.ts
        symbol: WorkspaceResolver
    edges:
      - id: package-knowledge
        from: package
        to: knowledge
        label: ./knowledge 暴露服务
        kind: boundary
        source:
          path: src/knowledge.ts
          symbol: KnowledgeService
          excerpt: "  KnowledgeService,"
        test:
          relation: none
          reason: 本边为门面暴露关系；本页不把知识服务行为测试当作门面执行证据，完整写链见专题10。
      - id: package-project
        from: package
        to: project
        label: ./project-context 暴露查询
        kind: boundary
        source:
          path: src/project-context.ts
          symbol: ProjectContext
          excerpt: |2-
              ProjectContext,
              withProjectContextSession,
            } from './service/project-context/ProjectContextService.js';
        test:
          relation: indirect
          path: test/CorePackage.test.ts
          caseTitle: routes public project information through ProjectContext instead of root source graph aggregation
          anchorSymbol: ProjectContext
          assertedBehavior: ProjectContext.execute 可见，根门面不暴露 SourceGraphQueryService
          assertionExcerpt: expect(ProjectContext.execute).toBeInstanceOf(Function);
          scenarioKind: positive
          reason: 本用例只断言门面可见性和退役符号缺席，没有执行 ProjectContext.execute；不作为查询行为的直接覆盖。
      - id: package-workspace
        from: package
        to: workspace
        label: ./workspace 暴露坐标解析
        kind: boundary
        source:
          path: src/workspace.ts
          symbol: WorkspaceResolver
          excerpt: |2-
              WorkspaceResolver,
            } from './shared/WorkspaceResolver.js';
        test:
          relation: none
          reason: 此边只表达导出绑定；工作区模式与坐标行为由专题02的实例测试证明。
  - id: r3-core-recovery-owners
    title: 不同持久化owner的失败去向
    description: 三个独立组件并排展示；箭头表达各自实现的失败状态，不表示存在一个自动跨模块恢复器。
    viewType: R0
    nodes:
      - id: knowledge
        label: 知识创建/更新文件已写
        role: service
      - id: divergence
        label: create/update分歧：显式sync指引
        role: failure
      - id: index
        label: 索引发布前取消
        role: service
      - id: old
        label: 旧代保留，新代不发布
        role: state
      - id: workflow
        label: snapshot/report未同时耐久
        role: service
      - id: retain
        label: 保留本session检查点
        role: state
    edges:
      - id: r3-owner-knowledge
        from: knowledge
        to: divergence
        label: 报告分歧，无自动sync
        kind: state
        source:
          path: src/service/knowledge/commitKnowledgeWrite.ts
          symbol: commitKnowledgeWrite
          excerpt: "throw new DivergenceError(dbFailureMessage, details, { cause: error });"
        test:
          relation: indirect
          path: test/KnowledgeServicePersistence.test.ts
          caseTitle: reports %s as divergence and sync can restore the durable file
          anchorSymbol: run
          assertedBehavior: 通过case内run(command)调用公开KnowledgeService：DB故障导致分歧；移除故障trigger后显式sync可恢复文件对应的DB状态。
          assertionExcerpt: "details: { entryIds: [id], fileOpsCompleted: 1, reconcileVia: 'KnowledgeSyncService.sync' },"
          scenarioKind: recovery
      - id: r3-owner-index
        from: index
        to: old
        label: 取消向上抛出
        kind: state
        source:
          path: src/service/source-graph/SourceGraphIndexer.ts
          symbol: SourceGraphIndexer
          excerpt: |-
            throwIfSourceReadAborted(input.options);
                const snapshot = await this.repository.replaceGeneration({
        test:
          relation: direct
          path: test/SourceGraphIndexer.test.ts
          caseTitle: does not publish a generation when the build is cancelled before publication
          anchorSymbol: SourceGraphIndexer
          assertedBehavior: 发布前取消不产生新代，原代保留。
          assertionExcerpt: expect(await repository.getSnapshot('cancelled')).toBeNull()
          scenarioKind: cancellation
      - id: r3-owner-workflow
        from: workflow
        to: retain
        label: 保留并记录未耐久诊断
        kind: recovery
        source:
          path: src/workflows/surfaces/persistence/WorkflowResultPersistence.ts
          symbol: persistWorkflowResult
          excerpt: logger.warn('[WorkflowPersistence] retained checkpoints because results are not durable', {
        test:
          relation: direct
          path: test/PublicHostAgentWorkflowEntrypoints.test.ts
          caseTitle: "cleans recovery checkpoints only after durable results: %s"
          anchorSymbol: persistWorkflowResult
          assertedBehavior: saved才清理当前session检查点，快照失败/跳过或报告失败保留恢复点。
          assertionExcerpt: |-
            expect((await loadDimensionCheckpoints(dataRoot)).has('architecture')).toBe(
                    outcome !== 'saved'
                  );
          scenarioKind: recovery
configPaths:
  - package.json
  - tsconfig.json
  - config/layer-contract.json
  - config/public-api-boundary.json
truthKind: current-code
baselineCommit: 35302912ac2efaa6a1bc65fdc112a16da75d845f
reviewDepth: L3
reviewedAt: 2026-10-23T16:05:54.700Z
reviewOrigin: architecture-atlas/implementation-2026-10-23-v0.3/semantic-review.md
dependencySelection:
  - src/index.ts
  - src/knowledge.ts
  - src/workspace.ts
  - src/project-context.ts
  - src/projectContextFoundation.ts
  - src/repositories.ts
  - src/core/analysis/index.ts
  - src/core/ast/extract/CallSiteExtractor.ts
  - src/core/ast/extract/ImportRecord.ts
  - src/core/ast/extract/CallSiteNoisePolicy.ts
sourceFingerprint: c26e60e3d889e25d88194f3f1d86eb44ac01ae8f57357c2a00db3d694a0034b1
contextFingerprint: dedb2668adb179ab2e9c10277e954158df9c319a5a54f5cf5d2f8271ed03f255
moduleDetails:
  - name: 公共门面：解析能力入口
    entry:
      path: src/index.ts
      symbol: <module>
      excerpt: export * from './core/index.js';
    input: 外层选定的根/子路径import
    output: 可见的值与类型绑定
    calls: package exports → 对应src门面 → 实际实现
    sideEffects: 暴露关系本身不等于执行某条业务；被加载模块是否有初始化效果应逐项查看
    limits: 子路径存在不代表宿主已接线；不把CLI/MCP/provider放入Core。
    id: M01-01
    aliases:
      - 公共门面解析能力入口
    graphRefs: []
    failureRefs: []
    apiRefs:
      - .
  - name: createAlembicRepositories：让Core持有表装配
    entry:
      path: src/repositories.ts
      symbol: createAlembicRepositories
      excerpt: const { drizzle } = resolveRepositoryDatabase(database);
    input: 暴露getDb/getDrizzle的connected handle
    output: 知识/图/生成/记忆/会话等repository bundle
    calls: resolveRepositoryDatabase验证 → 各repository构造器
    sideEffects: 仅绑定仓储对象；实际SQL随方法调用发生
    limits: 不连接数据库、不自动迁移、也不替代业务service的file-first写链。
    id: M01-02
    aliases:
      - createalembicrepositories让core持有表装配
    graphRefs: []
    failureRefs: []
    apiRefs:
      - ./repositories
  - name: 实时ProjectContext：reader与取消的闭包总门
    entry:
      path: src/service/project-context/ProjectContextService.ts
      symbol: ProjectContextService
      excerpt: sourceReader.assertComplete();
    input: 规范请求、默认或注入handlers、reader与可选共享analysis
    output: 事实envelope；reader锁存缺口/取消继续失败
    calls: createProjectContext；projectContext.execute；sourceReader.assertComplete；analysis.dispose
    sideEffects: 普通execute创建并释放analysis；共享session由外层finally管理
    limits: 任意注入executor不会自动获得sourceReader能力标记；不能把leaf catch后的部分返回当完整输入
    id: M01-03
    aliases:
      - 实时projectcontextreader与取消的闭包总门
    graphRefs: []
    failureRefs:
      - F01-input-closure
    apiRefs: []
  - name: 索引生命周期：显式追赶，不由query偷写
    entry:
      path: src/service/source-graph/SourceGraphLifecycle.ts
      symbol: SourceGraphLifecycleService
      excerpt: const inspection = await this.#service.inspectFreshness(inspectionInput);
    input: cold-start/startup/file-change的索引输入
    output: built-full/built-incremental/fresh-noop及durableTables计数
    calls: SourceGraphService.inspectFreshness；buildFullIndex；buildIncrementalIndex
    sideEffects: 只有选中build时写代际；不实现文件监听器
    limits: 结果action依据实际snapshot.mode，不按调用名虚报incremental
    id: M01-04
    aliases:
      - 索引生命周期显式追赶不由query偷写
    graphRefs: []
    failureRefs: []
    apiRefs:
      - .
  - name: 文件优先知识提交
    entry:
      path: src/service/knowledge/commitKnowledgeWrite.ts
      symbol: commitKnowledgeWrite
      excerpt: const fileResult = fileStore[fileOperation](entry);
    input: 实体、文件端口、提交回调与操作类型
    output: 成功实体/删除ID凭据，或FileWriteError/DivergenceError
    calls: 文件端口 → commit回调 → 返回ID核对
    sideEffects: 文件操作先完成；文件与SQLite不组成同一事务
    limits: 无fileStore走显式日志的DB-only兼容；remove=false仅表示无匹配文件，不能推断普通读取失败。
    id: M01-05
    aliases:
      - 文件优先知识提交
    graphRefs:
      - knowledge-create
    failureRefs:
      - F01-port-missing
      - F01-file-db-divergence
    apiRefs: []
  - name: 工作流结果：快照、报告与检查点清理
    entry:
      path: src/workflows/surfaces/persistence/WorkflowResultPersistence.ts
      symbol: persistWorkflowResult
      excerpt: if (snapshot.status === 'saved' && report !== null) {
    input: workflow结果、文件集、sessionStore、统计和sessionId
    output: 独立snapshot状态、report、snapshotId与汇总
    calls: saveWorkflowSnapshot；writeWorkflowReport；clearDimensionCheckpoints
    sideEffects: 先SQLite/fileDiff snapshot，再JSON report/history；两者成功才清理本session恢复点
    limits: 跨存储非事务；失败/跳过结果仍返回给宿主决策重试，不能视日志摘要为耐久成功
    id: M01-06
    aliases:
      - 工作流结果快照报告与检查点清理
    graphRefs: []
    failureRefs:
      - F01-result-not-durable
    apiRefs:
      - ./host-agent-workflows
      - ./workflows
      - ./workflows/surfaces
      - ./workflows/surfaces/persistence
  - name: 输出边界：字节预算与恢复引用
    entry:
      path: src/shared/OutputBudget.ts
      symbol: applyOutputBudget
      excerpt: "route: options.route ?? 'artifact-ref',"
    input: 已序列化payload、预算名、可选route/artifactRef
    output: 内容、truncated、原字节数和overflow
    calls: UTF-8计数 → 安全字节截断 → 附加overflow描述
    sideEffects: 纯内容投影，不创建artifact、不执行分页
    limits: 未知名称不设预算；宿主应提供真实可访问的恢复引用，不能只返回空artifact-ref承诺完整内容。
    id: M01-07
    aliases:
      - 输出边界字节预算与恢复引用
    graphRefs: []
    failureRefs:
      - F01-output-overflow
    apiRefs:
      - .
failureModes:
  - id: F01-port-missing
    trigger: 宿主没有注入fileStore
    remainingState: 仅调用DB回调；没有由该协调器保证的Markdown写入
    automaticAction: warn并return commit，不追加文件路径和ID读回要求
    explicitRecovery: 需要文件真相的宿主应装配真实writer后重新确认数据，而不是认定已有文件
    stopCondition: 不能把DB-only创建描述为文件优先完整链
    source:
      path: src/service/knowledge/commitKnowledgeWrite.ts
      symbol: commitKnowledgeWrite
      excerpt: if (!fileStore) {
    test:
      relation: none
      reason: 这里锚定兼容分支；未把文件writer正例作为缺端口行为覆盖。
    aliases:
      - f01-port-missing--宿主没有注入filestore
    moduleRefs:
      - M01-05
    graphRefs:
      - knowledge-create
    apiRefs: []
  - id: F01-file-db-divergence
    trigger: 创建/更新的文件操作已完成，但DB提交或ID读回失败
    remainingState: 文件真相保留；数据库可能未写入或与文件不符；删除操作需另查实际文件效果
    automaticAction: 记录明细并抛DivergenceError；无自动sync
    explicitRecovery: 宿主先排除DB故障，再显式KnowledgeSyncService.sync并重读确认
    stopCondition: 异常不证明所有副作用已撤销；不能盲目重复create
    source:
      path: src/service/knowledge/commitKnowledgeWrite.ts
      symbol: commitKnowledgeWrite
      excerpt: "throw new DivergenceError(dbFailureMessage, details, { cause: error });"
    test:
      relation: indirect
      path: test/KnowledgeServicePersistence.test.ts
      caseTitle: reports %s as divergence and sync can restore the durable file
      anchorSymbol: run
      assertedBehavior: 通过case内run(command)调用公开KnowledgeService：DB故障导致分歧；移除故障trigger后显式sync可恢复文件对应的DB状态。
      assertionExcerpt: "details: { entryIds: [id], fileOpsCompleted: 1, reconcileVia: 'KnowledgeSyncService.sync' },"
      scenarioKind: recovery
    aliases:
      - f01-file-db-divergence--创建更新的文件操作已完成但db提交或id读回失败
    moduleRefs:
      - M01-05
    graphRefs:
      - knowledge-create
      - knowledge-recovery
      - r3-authoring-and-sync-effects
    apiRefs: []
    runbook:
      preconditions: 确认发生于 create/update 的 file-first persist 路径，保留原
        entryId、operation、DivergenceError.details；使用原项目知识根和同一 DB。remove 分支不适用“文件仍保留”的假设。
      checks:
        - observe: 核对 details.fileOpsCompleted、sqliteBusy、operation 与 entryIds
          meaning: 区分文件成功后的 DB 分歧，不能将 FileWriteError 或 remove 的 false 分支混入。
        - observe: 检查原 Markdown 是否存在、id/正文/hash，并按同 id 读 DB
          meaning: 确认文件真相与 DB 缺失/旧版本/读回异常；不只看调用返回错误。
        - observe: 检查是否已经进入 relations/audit 等衍生动作
          meaning: 本指南只恢复文件→DB 投影，不会补保证所有后置效果。
      action: 仅对create/update等persist路径且原文件真相仍在：排除DB故障后显式KnowledgeSyncService.sync/syncAll。若operation为knowledge.delete，按reconcileVia分流到删除清单，不能以sync代替同IDdelete。先dryRun，正式写后仍须读回。
      identity: 复用原 entryId 与原文件，不重新 create 生成新 id，也不因重试更新已保存文件的来源身份。
      verify: 按同 entryId 重读 DB 与 Markdown，核对正文和文件 hash；确认没有同一条目重复行，并记录 sync 的
        updated/created/skipped/orphaned/violations。向量和关系另验。
      stop: 文件不在预期根、id 冲突、仍有审计 PersistenceError 或来源无法确认时停止；不能以删除文件/清空 DB 代替恢复。
  - id: F01-index-cancel
    trigger: 输入AbortSignal在分析/外部引擎执行后、replaceGeneration前取消
    remainingState: 已算出的内存事实丢弃；旧持久代仍在；新generation不存在
    automaticAction: throwIfSourceReadAborted直接抛出，不按外部不可用降级
    explicitRecovery: 宿主在未取消的新执行中显式重试构建；禁止发布已取消批次
    stopCondition: 取消检查后不得继续replaceGeneration
    source:
      path: src/service/source-graph/SourceGraphIndexer.ts
      symbol: SourceGraphIndexer
      excerpt: |-
        throwIfSourceReadAborted(input.options);
            const snapshot = await this.repository.replaceGeneration({
    test:
      relation: direct
      path: test/SourceGraphIndexer.test.ts
      caseTitle: does not publish a generation when the build is cancelled before publication
      anchorSymbol: SourceGraphIndexer
      assertedBehavior: 发布前取消不产生新代，原代保留。
      assertionExcerpt: expect(await repository.getSnapshot('cancelled')).toBeNull()
      scenarioKind: cancellation
    aliases:
      - f01-index-cancel--输入abortsignal在分析外部引擎执行后replacegeneration前取消
    moduleRefs: []
    graphRefs: []
    apiRefs: []
  - id: F01-result-not-durable
    trigger: snapshot skipped/failed或writeWorkflowReport返回null
    remainingState: 此前成功的一项可能已落盘，checkpoint保留；跨存储不回滚成全无
    automaticAction: persistWorkflowResult记录retained checkpoints诊断，返回各项结果
    explicitRecovery: 宿主补齐database/file list或修复写入错误，再重试结果保存；只有两项成功才清理同session恢复点
    stopCondition: snapshot未saved或report为null时不得清理唯一恢复点
    source:
      path: src/workflows/surfaces/persistence/WorkflowResultPersistence.ts
      symbol: persistWorkflowResult
      excerpt: if (snapshot.status === 'saved' && report !== null) {
    test:
      relation: direct
      path: test/PublicHostAgentWorkflowEntrypoints.test.ts
      caseTitle: "cleans recovery checkpoints only after durable results: %s"
      anchorSymbol: persistWorkflowResult
      assertedBehavior: snapshot failed/skipped或report失败保留本session checkpoint；saved才清理，其他session不动。
      assertionExcerpt: |-
        expect((await loadDimensionCheckpoints(dataRoot)).has('architecture')).toBe(
                outcome !== 'saved'
              )
      scenarioKind: recovery
    aliases:
      - f01-result-not-durable--snapshot-skippedfailed或writeworkflowreport返回null
    moduleRefs:
      - M01-06
    graphRefs: []
    apiRefs:
      - ./host-agent-workflows
      - ./workflows
      - ./workflows/surfaces
      - ./workflows/surfaces/persistence
  - id: F01-input-closure
    trigger: record/replay reader发现未捕获的目录/配置/源码观察；leaf可能把读错误捕获
    remainingState: reader锁存未完成状态；可能已计算局部envelope但不准作为完整结果发布
    automaticAction: ProjectContextService成功路径assertComplete；批处理正常退出再检查所有已使用reader
    explicitRecovery: 由认证捕获owner重新收集完整输入并重放；不能仅catch后重试同一不完整快照
    stopCondition: 闭包锁存未清除/未重新捕获前拒绝完整性声明
    source:
      path: src/service/project-context/ProjectContextService.ts
      symbol: ProjectContextService
      excerpt: sourceReader.assertComplete();
    test:
      relation: indirect
      path: test/ProjectContextFoundation.test.ts
      caseTitle: replays every certified request from serialized inputs after removing the source tree
      anchorSymbol: ReplayProjectSourceReader
      assertedBehavior: 从已序列化输入离线重放；删除directory观察后未捕获输入锁存，不能被repo降级吞掉。
      assertionExcerpt: expect(() => incomplete.assertComplete()).toThrow()
      scenarioKind: failure
      reason: fixture ports经ProjectContextService消费ReplayProjectSourceReader；本轮仅绑定代码断言，未新运行该测试。
    aliases:
      - f01-input-closure--recordreplay-reader发现未捕获的目录配置源码观察leaf可能把读错误捕获
    moduleRefs:
      - M01-03
    graphRefs: []
    apiRefs: []
  - id: F01-output-overflow
    trigger: payload超过已声明UTF-8字节预算
    remainingState: 本函数仅返回前缀；全量payload仍只存在于调用者所持输入或其另行存储
    automaticAction: 返回truncated=true、omittedBytes和route；不写文件
    explicitRecovery: 调用者先保存完整材料并给出真实artifactRef，或提供可执行分页入口
    stopCondition: 不能把route字符串当作可恢复全量内容的证明
    source:
      path: src/shared/OutputBudget.ts
      symbol: applyOutputBudget
      excerpt: "route: options.route ?? 'artifact-ref',"
    test:
      relation: direct
      path: test/OutputBudget.test.ts
      caseTitle: over-budget payloads are truncated with truncated:true and an overflow route
      anchorSymbol: applyOutputBudget
      assertedBehavior: 超预算返回截断标记、实际省略字节和调用者提供的artifactRef；本例不证明引用文件被创建。
      assertionExcerpt: expect(result.truncated).toBe(true);
      scenarioKind: positive
    aliases:
      - f01-output-overflow--payload超过已声明utf-8字节预算
    moduleRefs:
      - M01-07
    graphRefs: []
    apiRefs:
      - .
---

AlembicCore 是可运行的 Headless 内核库。它拥有配置与路径解析、数据库和仓储、源码分析、知识写入与检索、Guard、工作流及严格生产的确定性规则；宿主负责选择项目、装配依赖、执行模型和工具、CLI/MCP/UI 交互及发布运输。理解入口时先查 package.json 的 exports，再查对应门面的实际导出，不能把磁盘上存在的类视为可供外层直接引用的公共 API。

根入口保留常用共享能力和明确收敛的兼容符号，完整业务能力通过子路径进入。公开 ProjectContext 在 ./project-context，认证持久工件在 ./project-context-foundation；后者实际映射到 projectContextFoundation 门面。./core/analysis 是冻结兼容入口，当前把调用点和导入记录类型转发到语法叶子。没有 ./source-graph 或 ./recipe-context 公共键，关系查询由 ProjectContext 门面提供，RecipeContext 的能力门面是 ./recipe-context-capabilities。

图中的边界关系表示公开门面暴露了某个能力，不表示导入包就执行相应流程。运行调用必须回到专题纵切里的确切方法；例如 Main 的 KnowledgeModule 用公开 ./knowledge 的 KnowledgeService，并注入 repository、fileWriter、eventBus 等真实依赖。Core 支持可选端口和历史兼容路径，宿主装配不同会改变副作用，不能把一个构造器或类型声明当作全部能力已启用。

依赖方向由 config/layer-contract.json 约束，公共面的稳定性和收缩预算由 config/public-api-boundary.json 约束。core 目录是分析叶子，不是凌驾所有层的控制器。type-only 桥与运行依赖必须区分；AstAnalyzer、repository 和 workflow 的存在是完整复用能力的一部分，不能为了看起来分层整齐而删成接口。

边界测试对公开存在与退役符号作断言，但这只证明相应 API 可见性，不证明业务执行成功。维护者新增公共能力时还需要真实消费者、输入输出、持久化与兼容说明。下钻时按用户问题选择知识持久化、项目事实、严格生产等专题，再从生成的文件与 API 索引确认定位。

## 视图与术语

本页手工图描述已核对的关系与关键分叉；F1 也承担所列调用范围的业务纵切（V0）阅读，不能推出未画出的宿主自动调度。F0 文件依赖精选由同页选择集和 TypeScript 导入图生成，不是运行时轨迹。S0/R0 只描述正文指定的 owner、状态和恢复前提。公开 API、全部文件及变更影响见阅读器的对应入口。

`source` 为代码来源，`direct` 为直接绑定调用及断言，`indirect` 为经 helper/fixture 或间接行为的断言，`none` 为明确未覆盖。正文中的“宿主”指真实外层装配，不属于 Core 内部运行时。

## 模块协作与恢复边界深化

阅读Core调用链时先标记四种责任：门面决定可见性，宿主决定依赖装配，领域服务执行用例，持久化owner决定何时可以确认耐久。根入口不是一个自动执行的应用启动器；createAlembicRepositories也只绑定已连接句柄，不替宿主连接、迁移或选择数据根。

失败恢复同样分属各owner。知识创建/更新可能留下文件真相，索引取消应保留旧代，工作流结果部分保存应保留检查点，严格输入闭包失败则不能发布局部结果。下面将这些独立路径并排展示，供宿主选择正确入口；图中没有一个隐藏的Core总恢复调度器。输出预算又是另一层：overflow只描述交付合同，既不保存原内容，也不能证明宿主已经履行归档。

## 删除不能套用创建恢复

file-first协调器也服务remove，但恢复入口因操作而不同。创建/更新分歧见F01-file-db-divergence；删除的文件/DB/后置事件分流见[知识删除](../10-knowledge-authoring-persistence/README.md#m-M10-06)。

<!-- atlas:generated:start -->

## 功能单元与调用接缝

各单元按真实入口拆分职责；门面暴露、内部调用和宿主装配是不同关系。关联图提供相邻阅读上下文，故障产生位置以条目源码为准。

<a id="m-M01-01" class="stable-anchor"></a>
<a id="公共门面解析能力入口" class="stable-anchor"></a>

### 公共门面：解析能力入口

入口：`src/index.ts#<module>`

| 检查项 | 功能与边界 |
| --- | --- |
| 输入 | 外层选定的根/子路径import |
| 输出 | 可见的值与类型绑定 |
| 后续调用 / 绑定 | package exports → 对应src门面 → 实际实现 |
| 状态与副作用 | 暴露关系本身不等于执行某条业务；被加载模块是否有初始化效果应逐项查看 |
| 能力边界 | 子路径存在不代表宿主已接线；不把CLI/MCP/provider放入Core。 |

关联：未声明跨项关联 · 包入口 [@alembic/core](../../data/public-api.json)

<a id="m-M01-02" class="stable-anchor"></a>
<a id="createalembicrepositories让core持有表装配" class="stable-anchor"></a>

### createAlembicRepositories：让Core持有表装配

入口：`src/repositories.ts#createAlembicRepositories`

| 检查项 | 功能与边界 |
| --- | --- |
| 输入 | 暴露getDb/getDrizzle的connected handle |
| 输出 | 知识/图/生成/记忆/会话等repository bundle |
| 后续调用 / 绑定 | resolveRepositoryDatabase验证 → 各repository构造器 |
| 状态与副作用 | 仅绑定仓储对象；实际SQL随方法调用发生 |
| 能力边界 | 不连接数据库、不自动迁移、也不替代业务service的file-first写链。 |

关联：未声明跨项关联 · 包入口 [@alembic/core/repositories](../../data/public-api.json)

<a id="m-M01-03" class="stable-anchor"></a>
<a id="实时projectcontextreader与取消的闭包总门" class="stable-anchor"></a>

### 实时ProjectContext：reader与取消的闭包总门

入口：`src/service/project-context/ProjectContextService.ts#ProjectContextService`

| 检查项 | 功能与边界 |
| --- | --- |
| 输入 | 规范请求、默认或注入handlers、reader与可选共享analysis |
| 输出 | 事实envelope；reader锁存缺口/取消继续失败 |
| 后续调用 / 绑定 | createProjectContext；projectContext.execute；sourceReader.assertComplete；analysis.dispose |
| 状态与副作用 | 普通execute创建并释放analysis；共享session由外层finally管理 |
| 能力边界 | 任意注入executor不会自动获得sourceReader能力标记；不能把leaf catch后的部分返回当完整输入 |

关联：[F01-input-closure · record/replay reader发现未捕获的目录/配置/源码观察；leaf可能把读错误捕获](README.md#f-F01-input-closure)

<a id="m-M01-04" class="stable-anchor"></a>
<a id="索引生命周期显式追赶不由query偷写" class="stable-anchor"></a>

### 索引生命周期：显式追赶，不由query偷写

入口：`src/service/source-graph/SourceGraphLifecycle.ts#SourceGraphLifecycleService`

| 检查项 | 功能与边界 |
| --- | --- |
| 输入 | cold-start/startup/file-change的索引输入 |
| 输出 | built-full/built-incremental/fresh-noop及durableTables计数 |
| 后续调用 / 绑定 | SourceGraphService.inspectFreshness；buildFullIndex；buildIncrementalIndex |
| 状态与副作用 | 只有选中build时写代际；不实现文件监听器 |
| 能力边界 | 结果action依据实际snapshot.mode，不按调用名虚报incremental |

关联：未声明跨项关联 · 包入口 [@alembic/core](../../data/public-api.json)

<a id="m-M01-05" class="stable-anchor"></a>
<a id="文件优先知识提交" class="stable-anchor"></a>

### 文件优先知识提交

入口：`src/service/knowledge/commitKnowledgeWrite.ts#commitKnowledgeWrite`

| 检查项 | 功能与边界 |
| --- | --- |
| 输入 | 实体、文件端口、提交回调与操作类型 |
| 输出 | 成功实体/删除ID凭据，或FileWriteError/DivergenceError |
| 后续调用 / 绑定 | 文件端口 → commit回调 → 返回ID核对 |
| 状态与副作用 | 文件操作先完成；文件与SQLite不组成同一事务 |
| 能力边界 | 无fileStore走显式日志的DB-only兼容；remove=false仅表示无匹配文件，不能推断普通读取失败。 |

关联：[知识创建的文件优先提交](../10-knowledge-authoring-persistence/README.md#graph-knowledge-create) · [F01-port-missing · 宿主没有注入fileStore](README.md#f-F01-port-missing) · [F01-file-db-divergence · 创建/更新的文件操作已完成，但DB提交或ID读回失败](README.md#f-F01-file-db-divergence)

返回业务旅程：[一次知识从提交到可查询 · 先持久化文件，再提交 DB 并核对实体 ID](../../journeys/j01.md#J01-03) · [知识删除与部分完成后的恢复 · 文件先移除，再更新referrer与删除目标事务](../../journeys/j05.md#J05-02)

<a id="m-M01-06" class="stable-anchor"></a>
<a id="工作流结果快照报告与检查点清理" class="stable-anchor"></a>

### 工作流结果：快照、报告与检查点清理

入口：`src/workflows/surfaces/persistence/WorkflowResultPersistence.ts#persistWorkflowResult`

| 检查项 | 功能与边界 |
| --- | --- |
| 输入 | workflow结果、文件集、sessionStore、统计和sessionId |
| 输出 | 独立snapshot状态、report、snapshotId与汇总 |
| 后续调用 / 绑定 | saveWorkflowSnapshot；writeWorkflowReport；clearDimensionCheckpoints |
| 状态与副作用 | 先SQLite/fileDiff snapshot，再JSON report/history；两者成功才清理本session恢复点 |
| 能力边界 | 跨存储非事务；失败/跳过结果仍返回给宿主决策重试，不能视日志摘要为耐久成功 |

关联：[F01-result-not-durable · snapshot skipped/failed或writeWorkflowReport返回null](README.md#f-F01-result-not-durable) · 包入口 [@alembic/core/host-agent-workflows](../../data/public-api.json)、[@alembic/core/workflows](../../data/public-api.json)、[@alembic/core/workflows/surfaces](../../data/public-api.json)、[@alembic/core/workflows/surfaces/persistence](../../data/public-api.json)

<a id="m-M01-07" class="stable-anchor"></a>
<a id="输出边界字节预算与恢复引用" class="stable-anchor"></a>

### 输出边界：字节预算与恢复引用

入口：`src/shared/OutputBudget.ts#applyOutputBudget`

| 检查项 | 功能与边界 |
| --- | --- |
| 输入 | 已序列化payload、预算名、可选route/artifactRef |
| 输出 | 内容、truncated、原字节数和overflow |
| 后续调用 / 绑定 | UTF-8计数 → 安全字节截断 → 附加overflow描述 |
| 状态与副作用 | 纯内容投影，不创建artifact、不执行分页 |
| 能力边界 | 未知名称不设预算；宿主应提供真实可访问的恢复引用，不能只返回空artifact-ref承诺完整内容。 |

关联：[F01-output-overflow · payload超过已声明UTF-8字节预算](README.md#f-F01-output-overflow) · 包入口 [@alembic/core](../../data/public-api.json)


## 生成的图与逐边依据

此区域由同页结构化图模型生成；请修改 frontmatter，再显式运行 `npm run inventory:write`，不要单独修改表格或 Mermaid。

<a id="graph-core-package-facades"></a>

### 按职责进入公共门面

图 ID：`core-package-facades` · A0 · 边表示公开暴露关系，不表示执行调用。ProjectContext 的内部 SourceGraph 服务没有被根门面聚合暴露。

```mermaid
flowchart TD
accTitle: 按职责进入公共门面
accDescr: 边表示公开暴露关系，不表示执行调用。ProjectContext 的内部 SourceGraph 服务没有被根门面聚合暴露。
n0["@alembic/core 公共包"]
n1["知识创建与持久化"]
n2["实时源码与关系查询"]
n3["源码根与数据根"]
n0 e0@-->|"./knowledge 暴露服务"| n1
n0 e1@-->|"./project-context 暴露查询"| n2
n0 e2@-->|"./workspace 暴露坐标解析"| n3
classDef entry fill:#e1f1ed,stroke:#44796b,color:#173d33
classDef host fill:#eef0f8,stroke:#7a85a3,color:#303c5c
classDef store fill:#e5eff7,stroke:#7596b2,color:#243e54
classDef error fill:#fff0d9,stroke:#b68a3a,color:#634d29
class n0 host
```

| 边 ID | 关系 | 源码定位 | 断言关系 | case / 缺口 | 相关旅程步骤 |
| --- | --- | --- | --- | --- | --- |
| <a id="e-core-package-facades--package-knowledge"></a>package-knowledge | ./knowledge 暴露服务 | `src/knowledge.ts#KnowledgeService` | none | 本边为门面暴露关系；本页不把知识服务行为测试当作门面执行证据，完整写链见专题10。 |  |
| <a id="e-core-package-facades--package-project"></a>package-project | ./project-context 暴露查询 | `src/project-context.ts#ProjectContext` | indirect | routes public project information through ProjectContext instead of root source graph aggregation |  |
| <a id="e-core-package-facades--package-workspace"></a>package-workspace | ./workspace 暴露坐标解析 | `src/workspace.ts#WorkspaceResolver` | none | 此边只表达导出绑定；工作区模式与坐标行为由专题02的实例测试证明。 |  |

<a id="graph-r3-core-recovery-owners"></a>

### 不同持久化owner的失败去向

图 ID：`r3-core-recovery-owners` · R0 · 三个独立组件并排展示；箭头表达各自实现的失败状态，不表示存在一个自动跨模块恢复器。

```mermaid
flowchart TD
accTitle: 不同持久化owner的失败去向
accDescr: 三个独立组件并排展示；箭头表达各自实现的失败状态，不表示存在一个自动跨模块恢复器。
n0["知识创建/更新文件已写"]
n1["create/update分歧：显式sync指引"]
n2["索引发布前取消"]
n3["旧代保留，新代不发布"]
n4["snapshot/report未同时耐久"]
n5["保留本session检查点"]
n0 e0@-->|"报告分歧，无自动sync"| n1
n2 e1@-->|"取消向上抛出"| n3
n4 e2@-->|"保留并记录未耐久诊断"| n5
classDef entry fill:#e1f1ed,stroke:#44796b,color:#173d33
classDef host fill:#eef0f8,stroke:#7a85a3,color:#303c5c
classDef store fill:#e5eff7,stroke:#7596b2,color:#243e54
classDef error fill:#fff0d9,stroke:#b68a3a,color:#634d29
class n1 error
```

| 边 ID | 关系 | 源码定位 | 断言关系 | case / 缺口 | 相关旅程步骤 |
| --- | --- | --- | --- | --- | --- |
| <a id="e-r3-core-recovery-owners--r3-owner-knowledge"></a>r3-owner-knowledge | 报告分歧，无自动sync | `src/service/knowledge/commitKnowledgeWrite.ts#commitKnowledgeWrite` | indirect | reports %s as divergence and sync can restore the durable file |  |
| <a id="e-r3-core-recovery-owners--r3-owner-index"></a>r3-owner-index | 取消向上抛出 | `src/service/source-graph/SourceGraphIndexer.ts#SourceGraphIndexer` | direct | does not publish a generation when the build is cancelled before publication |  |
| <a id="e-r3-core-recovery-owners--r3-owner-workflow"></a>r3-owner-workflow | 保留并记录未耐久诊断 | `src/workflows/surfaces/persistence/WorkflowResultPersistence.ts#persistWorkflowResult` | direct | cleans recovery checkpoints only after durable results: %s |  |

<a id="graph-dependencies-01"></a>

### 文件依赖精选 · 静态关系

图 ID：`dependencies-01` · F0 · 显式选择集内的实际导入；类型边不代表运行调用，动态未知保留在全量索引。

```mermaid
flowchart TD
accTitle: 文件依赖精选 · 静态关系
accDescr: 显式选择集内的实际导入；类型边不代表运行调用，动态未知保留在全量索引。
n0["analysis/index.ts"]
n1["extract/CallSiteExtractor.ts"]
n2["extract/ImportRecord.ts"]
n3["extract/CallSiteNoisePolicy.ts"]
n0 e0@-->|"re-export"| n1
n0 e1@-->|"re-export"| n2
n1 e2@-->|"value"| n3
classDef entry fill:#e1f1ed,stroke:#44796b,color:#173d33
classDef host fill:#eef0f8,stroke:#7a85a3,color:#303c5c
classDef store fill:#e5eff7,stroke:#7596b2,color:#243e54
classDef error fill:#fff0d9,stroke:#b68a3a,color:#634d29
class n0 store
class n1 store
class n2 store
class n3 store
```

| 边 ID | 关系 | 源码定位 | 断言关系 | case / 缺口 | 相关旅程步骤 |
| --- | --- | --- | --- | --- | --- |
| <a id="e-dependencies-01--dep-01-0"></a>dep-01-0 | re-export | `src/core/analysis/index.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |
| <a id="e-dependencies-01--dep-01-1"></a>dep-01-1 | re-export | `src/core/analysis/index.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |
| <a id="e-dependencies-01--dep-01-2"></a>dep-01-2 | value | `src/core/ast/extract/CallSiteExtractor.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |

## 失败后的状态与恢复责任

先检查已落盘状态，再决定恢复。自动动作只描述代码已执行的分支；显式恢复不能据提示文字推断为自动调用。

<a id="f-F01-port-missing" class="stable-anchor"></a>
<a id="f01-port-missing--宿主没有注入filestore" class="stable-anchor"></a>

### F01-port-missing · 宿主没有注入fileStore

| 检查项 | 当前代码语义 |
| --- | --- |
| 已留下什么 | 仅调用DB回调；没有由该协调器保证的Markdown写入 |
| Core自动做什么 | warn并return commit，不追加文件路径和ID读回要求 |
| 谁显式恢复 | 需要文件真相的宿主应装配真实writer后重新确认数据，而不是认定已有文件 |
| 必须停止的条件 | 不能把DB-only创建描述为文件优先完整链 |
| 源码定位 | `src/service/knowledge/commitKnowledgeWrite.ts#commitKnowledgeWrite` |

```ts
if (!fileStore) {
```

关联：[文件优先知识提交](README.md#m-M01-05) · [知识创建的文件优先提交](../10-knowledge-authoring-persistence/README.md#graph-knowledge-create)

返回业务旅程：[一次知识从提交到可查询 · 先持久化文件，再提交 DB 并核对实体 ID](../../journeys/j01.md#J01-03)

断言关系：**none**。这里锚定兼容分支；未把文件writer正例作为缺端口行为覆盖。

<a id="f-F01-file-db-divergence" class="stable-anchor"></a>
<a id="f01-file-db-divergence--创建更新的文件操作已完成但db提交或id读回失败" class="stable-anchor"></a>

### F01-file-db-divergence · 创建/更新的文件操作已完成，但DB提交或ID读回失败

| 检查项 | 当前代码语义 |
| --- | --- |
| 已留下什么 | 文件真相保留；数据库可能未写入或与文件不符；删除操作需另查实际文件效果 |
| Core自动做什么 | 记录明细并抛DivergenceError；无自动sync |
| 谁显式恢复 | 宿主先排除DB故障，再显式KnowledgeSyncService.sync并重读确认 |
| 必须停止的条件 | 异常不证明所有副作用已撤销；不能盲目重复create |
| 源码定位 | `src/service/knowledge/commitKnowledgeWrite.ts#commitKnowledgeWrite` |

#### 恢复检查顺序

前提：确认发生于 create/update 的 file-first persist 路径，保留原 entryId、operation、DivergenceError.details；使用原项目知识根和同一 DB。remove 分支不适用“文件仍保留”的假设。

1. 核对 details.fileOpsCompleted、sqliteBusy、operation 与 entryIds — 区分文件成功后的 DB 分歧，不能将 FileWriteError 或 remove 的 false 分支混入。
2. 检查原 Markdown 是否存在、id/正文/hash，并按同 id 读 DB — 确认文件真相与 DB 缺失/旧版本/读回异常；不只看调用返回错误。
3. 检查是否已经进入 relations/audit 等衍生动作 — 本指南只恢复文件→DB 投影，不会补保证所有后置效果。

显式动作：仅对create/update等persist路径且原文件真相仍在：排除DB故障后显式KnowledgeSyncService.sync/syncAll。若operation为knowledge.delete，按reconcileVia分流到删除清单，不能以sync代替同IDdelete。先dryRun，正式写后仍须读回。

重试身份：复用原 entryId 与原文件，不重新 create 生成新 id，也不因重试更新已保存文件的来源身份。

完成断言：按同 entryId 重读 DB 与 Markdown，核对正文和文件 hash；确认没有同一条目重复行，并记录 sync 的 updated/created/skipped/orphaned/violations。向量和关系另验。

停止条件：文件不在预期根、id 冲突、仍有审计 PersistenceError 或来源无法确认时停止；不能以删除文件/清空 DB 代替恢复。

```ts
throw new DivergenceError(dbFailureMessage, details, { cause: error });
```

关联：[文件优先知识提交](README.md#m-M01-05) · [知识创建的文件优先提交](../10-knowledge-authoring-persistence/README.md#graph-knowledge-create) · [文件与数据库分歧的显式恢复](../10-knowledge-authoring-persistence/README.md#graph-knowledge-recovery) · [校验、创建与同步的不同完成边界](../10-knowledge-authoring-persistence/README.md#graph-r3-authoring-and-sync-effects)

返回业务旅程：[一次知识从提交到可查询 · 先持久化文件，再提交 DB 并核对实体 ID](../../journeys/j01.md#J01-03) · [一次知识从提交到可查询 · 需要修复或手改同步时，显式扫描 Markdown](../../journeys/j01.md#J01-05)

断言关系：**indirect**。`test/KnowledgeServicePersistence.test.ts` · `reports %s as divergence and sync can restore the durable file`

通过case内run(command)调用公开KnowledgeService：DB故障导致分歧；移除故障trigger后显式sync可恢复文件对应的DB状态。（recovery）。这里只定位断言；实际运行范围见独立运行证据。

```ts
details: { entryIds: [id], fileOpsCompleted: 1, reconcileVia: 'KnowledgeSyncService.sync' },
```

<a id="f-F01-index-cancel" class="stable-anchor"></a>
<a id="f01-index-cancel--输入abortsignal在分析外部引擎执行后replacegeneration前取消" class="stable-anchor"></a>

### F01-index-cancel · 输入AbortSignal在分析/外部引擎执行后、replaceGeneration前取消

| 检查项 | 当前代码语义 |
| --- | --- |
| 已留下什么 | 已算出的内存事实丢弃；旧持久代仍在；新generation不存在 |
| Core自动做什么 | throwIfSourceReadAborted直接抛出，不按外部不可用降级 |
| 谁显式恢复 | 宿主在未取消的新执行中显式重试构建；禁止发布已取消批次 |
| 必须停止的条件 | 取消检查后不得继续replaceGeneration |
| 源码定位 | `src/service/source-graph/SourceGraphIndexer.ts#SourceGraphIndexer` |

```ts
throwIfSourceReadAborted(input.options);
    const snapshot = await this.repository.replaceGeneration({
```

关联：未声明跨项关联

断言关系：**direct**。`test/SourceGraphIndexer.test.ts` · `does not publish a generation when the build is cancelled before publication`

发布前取消不产生新代，原代保留。（cancellation）。这里只定位断言；实际运行范围见独立运行证据。

```ts
expect(await repository.getSnapshot('cancelled')).toBeNull()
```

<a id="f-F01-result-not-durable" class="stable-anchor"></a>
<a id="f01-result-not-durable--snapshot-skippedfailed或writeworkflowreport返回null" class="stable-anchor"></a>

### F01-result-not-durable · snapshot skipped/failed或writeWorkflowReport返回null

| 检查项 | 当前代码语义 |
| --- | --- |
| 已留下什么 | 此前成功的一项可能已落盘，checkpoint保留；跨存储不回滚成全无 |
| Core自动做什么 | persistWorkflowResult记录retained checkpoints诊断，返回各项结果 |
| 谁显式恢复 | 宿主补齐database/file list或修复写入错误，再重试结果保存；只有两项成功才清理同session恢复点 |
| 必须停止的条件 | snapshot未saved或report为null时不得清理唯一恢复点 |
| 源码定位 | `src/workflows/surfaces/persistence/WorkflowResultPersistence.ts#persistWorkflowResult` |

```ts
if (snapshot.status === 'saved' && report !== null) {
```

关联：[工作流结果：快照、报告与检查点清理](README.md#m-M01-06) · 包入口 [@alembic/core/host-agent-workflows](../../data/public-api.json)、[@alembic/core/workflows](../../data/public-api.json)、[@alembic/core/workflows/surfaces](../../data/public-api.json)、[@alembic/core/workflows/surfaces/persistence](../../data/public-api.json)

断言关系：**direct**。`test/PublicHostAgentWorkflowEntrypoints.test.ts` · `cleans recovery checkpoints only after durable results: %s`

snapshot failed/skipped或report失败保留本session checkpoint；saved才清理，其他session不动。（recovery）。这里只定位断言；实际运行范围见独立运行证据。

```ts
expect((await loadDimensionCheckpoints(dataRoot)).has('architecture')).toBe(
        outcome !== 'saved'
      )
```

<a id="f-F01-input-closure" class="stable-anchor"></a>
<a id="f01-input-closure--recordreplay-reader发现未捕获的目录配置源码观察leaf可能把读错误捕获" class="stable-anchor"></a>

### F01-input-closure · record/replay reader发现未捕获的目录/配置/源码观察；leaf可能把读错误捕获

| 检查项 | 当前代码语义 |
| --- | --- |
| 已留下什么 | reader锁存未完成状态；可能已计算局部envelope但不准作为完整结果发布 |
| Core自动做什么 | ProjectContextService成功路径assertComplete；批处理正常退出再检查所有已使用reader |
| 谁显式恢复 | 由认证捕获owner重新收集完整输入并重放；不能仅catch后重试同一不完整快照 |
| 必须停止的条件 | 闭包锁存未清除/未重新捕获前拒绝完整性声明 |
| 源码定位 | `src/service/project-context/ProjectContextService.ts#ProjectContextService` |

```ts
sourceReader.assertComplete();
```

关联：[实时ProjectContext：reader与取消的闭包总门](README.md#m-M01-03)

断言关系：**indirect**。`test/ProjectContextFoundation.test.ts` · `replays every certified request from serialized inputs after removing the source tree`

从已序列化输入离线重放；删除directory观察后未捕获输入锁存，不能被repo降级吞掉。（failure）。这里只定位断言；实际运行范围见独立运行证据。

```ts
expect(() => incomplete.assertComplete()).toThrow()
```

<a id="f-F01-output-overflow" class="stable-anchor"></a>
<a id="f01-output-overflow--payload超过已声明utf-8字节预算" class="stable-anchor"></a>

### F01-output-overflow · payload超过已声明UTF-8字节预算

| 检查项 | 当前代码语义 |
| --- | --- |
| 已留下什么 | 本函数仅返回前缀；全量payload仍只存在于调用者所持输入或其另行存储 |
| Core自动做什么 | 返回truncated=true、omittedBytes和route；不写文件 |
| 谁显式恢复 | 调用者先保存完整材料并给出真实artifactRef，或提供可执行分页入口 |
| 必须停止的条件 | 不能把route字符串当作可恢复全量内容的证明 |
| 源码定位 | `src/shared/OutputBudget.ts#applyOutputBudget` |

```ts
route: options.route ?? 'artifact-ref',
```

关联：[输出边界：字节预算与恢复引用](README.md#m-M01-07) · 包入口 [@alembic/core](../../data/public-api.json)

断言关系：**direct**。`test/OutputBudget.test.ts` · `over-budget payloads are truncated with truncated:true and an overflow route`

超预算返回截断标记、实际省略字节和调用者提供的artifactRef；本例不证明引用文件被创建。（positive）。这里只定位断言；实际运行范围见独立运行证据。

```ts
expect(result.truncated).toBe(true);
```


<!-- atlas:generated:end -->
