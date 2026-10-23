---
topicId: "16"
title: 运行时契约与观测
question: job/resident、事件、信号、日志与资源释放各保证什么？
sourcePaths:
  - src/daemon/DaemonState.ts
  - src/daemon/JobDisplaySnapshotContracts.ts
  - src/daemon/JobProcessEventContracts.ts
  - src/daemon/JobStore.ts
  - src/daemon/ProjectRuntimeContracts.ts
  - src/daemon/ResidentServiceContracts.ts
  - src/daemon/RuntimeContracts.ts
  - src/daemon/index.ts
  - src/infrastructure/cache/CacheService.ts
  - src/infrastructure/cache/UnifiedCacheAdapter.ts
  - src/infrastructure/cache/index.ts
  - src/infrastructure/event/EventBus.ts
  - src/infrastructure/event/index.ts
  - src/infrastructure/logging/Logger.ts
  - src/infrastructure/logging/index.ts
  - src/infrastructure/report/ReportStore.ts
  - src/infrastructure/report/index.ts
  - src/infrastructure/signal/SignalAggregator.ts
  - src/infrastructure/signal/SignalBridge.ts
  - src/infrastructure/signal/SignalBus.ts
  - src/infrastructure/signal/SignalTraceWriter.ts
  - src/infrastructure/signal/index.ts
  - src/repository/token/TokenUsageStore.ts
  - src/repository/token/index.ts
  - src/shared/OutputBudget.ts
  - src/shared/TimerRegistry.ts
  - src/shared/concurrency.ts
  - src/shared/lifecycle.ts
  - src/shared/shutdown.ts
testPaths:
  - test/DaemonState.test.ts
  - test/EventBus.test.ts
  - test/JobProcessEventContracts.test.ts
  - test/JobStore.test.ts
  - test/SignalBus.test.ts
  - test/SignalPersistence.test.ts
consumerRefs:
  - repository: Alembic
    path: lib/injection/modules/InfraModule.ts
    excerpt: "return new JobStore({ projectRoot: resolver.dataRoot });"
    meaning: 宿主真实构造JobStore，worker启动和生命周期动作仍属于外层
  - repository: Alembic
    path: lib/injection/modules/SignalModule.ts
    excerpt: return new SignalBridge(bus, eventBus);
    meaning: SignalBus到EventBus真实桥接，由宿主选择构造时机
risks:
  - JobStore终态守卫不是跨进程CAS；temp+rename没有知识writer的完整fsync序列。
  - EventBus内存history、SignalTraceWriter best-effort JSONL均不是业务提交权威。
  - shutdown只清理注册hooks；SignalBridge/trace订阅寿命不能由Aggregator.dispose测试替代证明。
diagrams:
  - id: job-terminal-protection
    title: 作业状态与晚到结果保护
    viewType: S0
    description: Core保存job状态和终态保护，宿主显式执行worker与重启恢复。
    nodes:
      - id: host
        label: 宿主调用JobStore
        role: boundary
      - id: queued
        label: queued
        role: state
      - id: running
        label: running
        role: state
      - id: terminal
        label: completed/failed/cancelled
        role: state
      - id: interrupted
        label: 宿主选择中断恢复
        role: recovery
      - id: file
        label: 临时JSON→rename
        role: persistence
    edges:
      - id: JB-01
        from: host
        to: queued
        label: create构造queued
        kind: state
        source:
          path: src/daemon/JobStore.ts
          symbol: JobStore
          excerpt: "status: 'queued',"
        test:
          relation: direct
          path: test/JobStore.test.ts
          caseTitle: persists daemon jobs and lists newest first
          anchorSymbol: JobStore
          assertedBehavior: 同case创建store、queued→running→completed，再读回result
          assertionExcerpt: "expect(store.get(first.id)?.result).toMatchObject({ bootstrapSession: { id:
            'bs_1' } });"
          scenarioKind: positive
      - id: JB-02
        from: queued
        to: running
        label: markRunning只接queued
        kind: state
        source:
          path: src/daemon/JobStore.ts
          symbol: JobStore
          excerpt: if (current.status !== 'queued') {
        test:
          relation: direct
          path: test/JobStore.test.ts
          caseTitle: persists daemon jobs and lists newest first
          anchorSymbol: JobStore
          assertedBehavior: 同case创建store、queued→running→completed，再读回result
          assertionExcerpt: "expect(store.get(first.id)?.result).toMatchObject({ bootstrapSession: { id:
            'bs_1' } });"
          scenarioKind: positive
      - id: JB-03
        from: running
        to: terminal
        label: complete/fail/cancel经update
        kind: call
        source:
          path: src/daemon/JobStore.ts
          symbol: JobStore
          excerpt: "status: 'completed',"
        test:
          relation: direct
          path: test/JobStore.test.ts
          caseTitle: persists daemon jobs and lists newest first
          anchorSymbol: JobStore
          assertedBehavior: 同case创建store、queued→running→completed，再读回result
          assertionExcerpt: "expect(store.get(first.id)?.result).toMatchObject({ bootstrapSession: { id:
            'bs_1' } });"
          scenarioKind: positive
      - id: JB-04
        from: terminal
        to: terminal
        label: 晚到结果保留现有终态
        kind: state
        source:
          path: src/daemon/JobStore.ts
          symbol: JobStore
          excerpt: if (isTerminalStatus(current.status)) {
        test:
          relation: direct
          path: test/JobStore.test.ts
          caseTitle: does not allow terminal jobs to be overwritten by late workers
          anchorSymbol: JobStore
          assertedBehavior: cancel后晚到markRunning/complete/fail不覆盖终态
          assertionExcerpt: "expect(completed).toMatchObject({ status: 'cancelled', error: { message: 'user
            cancelled' } });"
          scenarioKind: negative
      - id: JB-05
        from: interrupted
        to: terminal
        label: 仅活动任务标failed
        kind: recovery
        source:
          path: src/daemon/JobStore.ts
          symbol: JobStore
          excerpt: .filter((job) => job.status === 'queued' || job.status === 'running')
        test:
          relation: direct
          path: test/JobStore.test.ts
          caseTitle: marks queued and running jobs interrupted without touching terminal jobs
          anchorSymbol: JobStore
          assertedBehavior: 显式markActiveInterrupted仅改queued/running，不改completed/cancelled
          assertionExcerpt: expect(interrupted.map((job) => job.id)).toEqual([queued.id, running.id]);
          scenarioKind: recovery
      - id: JB-06
        from: queued
        to: file
        label: create通过#write保存
        kind: call
        source:
          path: src/daemon/JobStore.ts
          symbol: JobStore
          excerpt: this.#write(job);
        test:
          relation: direct
          path: test/JobStore.test.ts
          caseTitle: persists daemon jobs and lists newest first
          anchorSymbol: JobStore
          assertedBehavior: 同case创建store、queued→running→completed，再读回result
          assertionExcerpt: "expect(store.get(first.id)?.result).toMatchObject({ bootstrapSession: { id:
            'bs_1' } });"
          scenarioKind: positive
  - id: events-signals-waiting
    title: 信号桥接与事件等待语义
    viewType: F1
    description: 订阅绑定与实际发射分别标注；同步emit与串行await的emitAsync是两种消费承诺。
    nodes:
      - id: signal
        label: SignalBus
        role: service
        path: src/infrastructure/signal/SignalBus.ts
        symbol: SignalBus
      - id: bridge
        label: SignalBridge
        role: adapter
        path: src/infrastructure/signal/SignalBridge.ts
        symbol: SignalBridge
      - id: event
        label: EventBus
        role: service
        path: src/infrastructure/event/EventBus.ts
        symbol: EventBus
      - id: sync
        label: 同步listeners
        role: effect
      - id: async
        label: |-
          串行await listeners
          保留once与this
        role: effect
    edges:
      - id: EV-01
        from: signal
        to: bridge
        label: 构造时订阅全部信号
        kind: binding
        source:
          path: src/infrastructure/signal/SignalBridge.ts
          symbol: SignalBridge
          excerpt: signalBus.subscribe('*', (signal) => {
        test:
          relation: direct
          path: test/SignalPersistence.test.ts
          caseTitle: SignalBridge forwards signal events into EventBus channels
          anchorSymbol: SignalBridge
          assertedBehavior: 构造bridge后发guard/search，通用通道两个、guard专用通道一个
          assertionExcerpt: expect(guardEvents).toHaveLength(1);
          scenarioKind: positive
      - id: EV-02
        from: bridge
        to: event
        label: 发射signal:event
        kind: call
        source:
          path: src/infrastructure/signal/SignalBridge.ts
          symbol: SignalBridge
          excerpt: eventBus.emit('signal:event', signal);
        test:
          relation: direct
          path: test/SignalPersistence.test.ts
          caseTitle: SignalBridge forwards signal events into EventBus channels
          anchorSymbol: SignalBridge
          assertedBehavior: 构造bridge后发guard/search，通用通道两个、guard专用通道一个
          assertionExcerpt: expect(guardEvents).toHaveLength(1);
          scenarioKind: positive
      - id: EV-03
        from: event
        to: sync
        label: emit委托EventEmitter
        kind: call
        source:
          path: src/infrastructure/event/EventBus.ts
          symbol: EventBus
          excerpt: return super.emit(eventName, ...args);
        test:
          relation: indirect
          path: test/EventBus.test.ts
          caseTitle: should deliver events to listeners
          anchorSymbol: bus
          assertedBehavior: case中bus.emit两次，同步listeners收到两份payload
          assertionExcerpt: "expect(received).toEqual([{ value: 1 }, { value: 2 }]);"
          scenarioKind: positive
      - id: EV-04
        from: event
        to: async
        label: emitAsync逐个await rawListener
        kind: call
        source:
          path: src/infrastructure/event/EventBus.ts
          symbol: EventBus
          excerpt: await listener.apply(this, args);
        test:
          relation: indirect
          path: test/EventBus.test.ts
          caseTitle: should await all async listeners
          anchorSymbol: bus
          assertedBehavior: case调用emitAsync后按注册顺序收到完成结果
          assertionExcerpt: expect(order).toEqual([1, 2]);
          scenarioKind: positive
  - id: r3-shutdown-resource-ownership
    title: 关闭hook的顺序、失败隔离与强退
    description: 这里只画shutdown真实执行；TimerRegistry/DB/vector必须由宿主注册合适hook，不虚构自动发现或调用。
    viewType: R0
    nodes:
      - id: host
        label: 宿主register/install
        role: boundary
      - id: start
        label: execute防重入
        role: service
      - id: hooks
        label: 逆注册顺序await hooks
        role: effect
      - id: failure
        label: hook失败记录
        role: failure
      - id: exit
        label: 全部结束后exit(0/1)
        role: state
      - id: timeout
        label: 硬超时exit(1)
        role: failure
    edges:
      - id: R3-E1
        from: host
        to: start
        label: install注册进程信号入口
        kind: binding
        source:
          path: src/shared/shutdown.ts
          symbol: ShutdownCoordinator
          excerpt: process.on('SIGTERM', () => handler('SIGTERM'));
        test:
          relation: none
          reason: 未执行进程信号测试。
      - id: R3-E2
        from: start
        to: hooks
        label: LIFO执行已注册hooks
        kind: call
        source:
          path: src/shared/shutdown.ts
          symbol: ShutdownCoordinator
          excerpt: await fn();
        test:
          relation: none
          reason: 无隔离子进程LIFO实跑证据。
      - id: R3-E3
        from: hooks
        to: failure
        label: catch记录并继续下一个
        kind: recovery
        source:
          path: src/shared/shutdown.ts
          symbol: ShutdownCoordinator
          excerpt: hasFailure = true;
        test:
          relation: none
          reason: 无hook reject实际退出case。
      - id: R3-E4
        from: hooks
        to: exit
        label: 根据是否失败退出
        kind: state
        source:
          path: src/shared/shutdown.ts
          symbol: ShutdownCoordinator
          excerpt: "process.exit(hasFailure ? 1 : 0);"
        test:
          relation: none
          reason: 源码执行语义，不主张本轮运行过。
      - id: R3-E5
        from: start
        to: timeout
        label: 到达配置期限强退
        kind: state
        source:
          path: src/shared/shutdown.ts
          symbol: ShutdownCoordinator
          excerpt: process.stderr.write('[shutdown] Timeout reached, forcing exit\n');
        test:
          relation: none
          reason: 未执行强退测试。
configPaths:
  - package.json
  - tsconfig.json
  - config/layer-contract.json
  - config/public-api-boundary.json
truthKind: current-code
baselineCommit: 35302912ac2efaa6a1bc65fdc112a16da75d845f
reviewDepth: L3
reviewedAt: 2026-10-22
reviewOrigin: architecture-atlas/reviews/2026-10-22-r3/semantic-review.md
dependencySelection:
  - src/daemon/JobStore.ts
  - src/infrastructure/event/EventBus.ts
  - src/infrastructure/signal/SignalBus.ts
  - src/infrastructure/signal/SignalBridge.ts
  - src/daemon/DaemonState.ts
  - src/daemon/ResidentServiceContracts.ts
  - src/daemon/JobProcessEventContracts.ts
  - src/infrastructure/signal/SignalTraceWriter.ts
  - src/infrastructure/signal/SignalAggregator.ts
  - src/shared/shutdown.ts
sourceFingerprint: e20396cedbf43b2ab7432e659ffe701cdf31192fd4134200208ee955103fec6c
contextFingerprint: cf21c3cbf9ff2ae69ce9979b9f71435dd3166d4e82ed7ac5b4448c066d9ba488
moduleDetails:
  - name: 宿主进程关闭协调器
    entry:
      path: src/shared/shutdown.ts
      symbol: ShutdownCoordinator
      excerpt: const reversed = [...this.#hooks].reverse();
    input: 宿主register的hooks、install信号监听、timeout
    output: 进程退出码0/1及stderr日志
    calls: register；execute；await hook；process.exit
    sideEffects: 安装SIGTERM/SIGINT由宿主显式调用；执行LIFO并最终退出进程
    limits: import不自动install；无注册即无清理保证；必须先drain/flush再dispose，Core不凭空找到资源。
    id: M16-01
    aliases:
      - 宿主进程关闭协调器
    graphRefs: []
    failureRefs:
      - R3-HOOK
      - R3-TIMEOUT
    apiRefs: []
  - name: Timer与Disposable最后清理
    entry:
      path: src/shared/TimerRegistry.ts
      symbol: TimerRegistryImpl
      excerpt: await Promise.allSettled(
    input: 已登记timers/disposables
    output: dispose Promise与诊断计数
    calls: clearInterval/clearTimeout；Disposable.dispose
    sideEffects: 清timer、并行dispose、记录单项失败
    limits: 不会排空异步队列；dispose后仍允许登记但warn，后登记对象不会再被清理。
    id: M16-02
    aliases:
      - timer与disposable最后清理
    graphRefs: []
    failureRefs:
      - R3-POST-DISPOSE
    apiRefs: []
  - name: 同步事件与串行异步监听
    entry:
      path: src/infrastructure/event/EventBus.ts
      symbol: EventBus
      excerpt: await listener.apply(this, args);
    input: eventName与payload、listeners/once
    output: emit布尔值或emitAsync完成/拒绝
    calls: "#recordEvent；super.emit；rawListeners"
    sideEffects: 有界内存history；listener可有自己的副作用
    limits: emitAsync首个reject中止后续listener；history记录在派发前，不是所有消费者处理成功回执。
    id: M16-03
    aliases:
      - 同步事件与串行异步监听
    graphRefs: []
    failureRefs:
      - R3-EVENT-REJECT
    apiRefs:
      - .
      - ./events
  - name: 容错同步信号总线
    entry:
      path: src/infrastructure/signal/SignalBus.ts
      symbol: SignalBus
      excerpt: handler(signal);
    input: 结构化signal或send参数
    output: 同步广播，无durable ack
    calls: 精确订阅；通配订阅；unsubscribe函数
    sideEffects: 内存计数、同步调用订阅者
    limits: 单handler异常隔离；不await async handler的Promise，不提供任务队列/重放。
    id: M16-04
    aliases:
      - 容错同步信号总线
    graphRefs: []
    failureRefs:
      - R3-SIGNAL-HANDLER
    apiRefs:
      - .
      - ./events
  - name: 滑窗报告的flush与dispose
    entry:
      path: src/infrastructure/signal/SignalAggregator.ts
      symbol: SignalAggregator
      excerpt: this.#unsubscribe();
    input: signal流、ReportStore、窗口/周期
    output: 报告与异常signal、flushNow Promise
    calls: timerRegistry.setInterval；ReportStore.write；#flush；dispose
    sideEffects: 内存窗口、周期写报告、取消订阅
    limits: stop只停timer；dispose额外解绑和清window；有待写报告应先显式flushNow。
    id: M16-05
    aliases:
      - 滑窗报告的flush与dispose
    graphRefs: []
    failureRefs: []
    apiRefs:
      - .
      - ./events
  - name: 可选JSONL信号留痕
    entry:
      path: src/infrastructure/signal/SignalTraceWriter.ts
      symbol: SignalTraceWriter
      excerpt: fs.appendFileSync(fileName, line, 'utf8');
    input: SignalBus全量订阅、baseDir、可选WriteZone
    output: JSONL query/stats
    calls: appendFileSync/WriteZone.appendFile；type单名校验
    sideEffects: 按类型追加JSONL；查询读历史
    limits: 写失败静默容忍、不阻断总线；不是可靠审计提交，也未提供自动补写/订阅销毁。
    id: M16-06
    aliases:
      - 可选jsonl信号留痕
    graphRefs: []
    failureRefs:
      - R3-TRACE-WRITE
    apiRefs:
      - .
      - ./events
failureModes:
  - id: R3-HOOK
    trigger: 某个已注册shutdown hook reject
    remainingState: 之前关闭的资源不会重开；失败资源可能未清
    automaticAction: 记录失败，继续剩余LIFO hooks，最终exit(1)
    explicitRecovery: 宿主下次启动检查业务持久化和失败资源，修正hook；当前进程无自动重试该hook
    stopCondition: 所有hooks完成或硬超时后退出；不能报全部清理成功
    source:
      path: src/shared/shutdown.ts
      symbol: ShutdownCoordinator
      excerpt: hasFailure = true;
    test:
      relation: none
      reason: 未见实际隔离子进程的shutdown失败case；不能用singleton存在测试替代执行。
    aliases:
      - r3-hook--某个已注册shutdown-hook-reject
    moduleRefs:
      - M16-01
    graphRefs: []
    apiRefs: []
  - id: R3-TIMEOUT
    trigger: 关闭过程超过timeoutMs
    remainingState: 未完成hook/队列可能仍有未确认写入
    automaticAction: 硬timer调用process.exit(1)
    explicitRecovery: 下次启动按各组件持久恢复协议检查WAL/job等；不保证自动补全所有队列
    stopCondition: 进程强退不可在同进程恢复；只保留已耐久证据
    source:
      path: src/shared/shutdown.ts
      symbol: ShutdownCoordinator
      excerpt: process.stderr.write('[shutdown] Timeout reached, forcing exit\n');
    test:
      relation: none
      reason: 未运行子进程超时退出测试，源码边界明确。
    aliases:
      - r3-timeout--关闭过程超过timeoutms
    moduleRefs:
      - M16-01
    graphRefs: []
    apiRefs: []
  - id: R3-EVENT-REJECT
    trigger: emitAsync中某listener reject
    remainingState: history已记录该事件；前面listener可能完成，后面未运行
    automaticAction: Promise reject传播给调用方；不catch并继续剩余listener
    explicitRecovery: 宿主按幂等性判断是否重发/补偿，不能默认整个事件未消费
    stopCondition: 在首个reject停止串行派发；无自动重放
    source:
      path: src/infrastructure/event/EventBus.ts
      symbol: EventBus
      excerpt: await listener.apply(this, args);
    test:
      relation: none
      reason: 现有测试验证串行/once正例；未定位reject后续不执行的明确case。
    aliases:
      - r3-event-reject--emitasync中某listener-reject
    moduleRefs:
      - M16-03
    graphRefs: []
    apiRefs:
      - .
      - ./events
  - id: R3-SIGNAL-HANDLER
    trigger: SignalBus同步handler抛错
    remainingState: 其他订阅者仍可消费；失败者副作用未知
    automaticAction: catch隔离并继续精确/通配handler
    explicitRecovery: 消费者自己记录失败和决定重试；总线无耐久重放
    stopCondition: 异常不外抛不等于所有订阅者处理成功
    source:
      path: src/infrastructure/signal/SignalBus.ts
      symbol: SignalBus
      excerpt: handler(signal);
    test:
      relation: indirect
      path: test/SignalBus.test.ts
      caseTitle: handler error does not block other handlers
      anchorSymbol: bus
      assertedBehavior: 精确订阅者之一抛错，另一个仍被调用
      assertionExcerpt: expect(goodHandler).toHaveBeenCalledOnce();
      scenarioKind: fallback
    aliases:
      - r3-signal-handler--signalbus同步handler抛错
    moduleRefs:
      - M16-04
    graphRefs: []
    apiRefs:
      - .
      - ./events
  - id: R3-POST-DISPOSE
    trigger: TimerRegistry.dispose之后再注册timer或Disposable
    remainingState: 新资源被创建/登记，但registry已处disposed
    automaticAction: 输出稳定diagnostic，保持兼容创建行为
    explicitRecovery: 宿主修正关闭顺序，自己清理晚到资源；后续dispose会立即return
    stopCondition: 不能指望再次dispose兜底回收
    source:
      path: src/shared/TimerRegistry.ts
      symbol: TimerRegistryImpl
      excerpt: '`${operation}("${label}") after dispose() — it will not be cleaned up\n`'
    test:
      relation: none
      reason: 本次未见后登记资源真实回收行为case；源码已明确只诊断。
    aliases:
      - r3-post-dispose--timerregistrydispose之后再注册timer或disposable
    moduleRefs:
      - M16-02
    graphRefs: []
    apiRefs: []
  - id: R3-TRACE-WRITE
    trigger: SignalTraceWriter追加JSONL失败
    remainingState: 总线已派发，缺失该次耐久trace
    automaticAction: catch吞错，不阻断signal；不排队补写
    explicitRecovery: 宿主诊断文件系统并明确记录日志缺口，不能从query空集推断无事件
    stopCondition: 没有自动恢复该丢失trace的保证
    source:
      path: src/infrastructure/signal/SignalTraceWriter.ts
      symbol: SignalTraceWriter
      excerpt: fs.appendFileSync(fileName, line, 'utf8');
    test:
      relation: none
      reason: 已有真实JSONL成功查询测试不覆盖写入失败；不把catch当可靠日志。
    aliases:
      - r3-trace-write--signaltracewriter追加jsonl失败
    moduleRefs:
      - M16-06
    graphRefs: []
    apiRefs:
      - .
      - ./events
---

## Core保存合同与状态，宿主拥有进程

`@alembic/core/daemon`提供DaemonState、JobStore、resident/runtime capability、job process event/display snapshot等可复用结构。它不启动HTTP服务、MCP窗口或模型调用；Main/Plugin负责实际worker与路由。DaemonState解析workspace数据根及runtime路径，读取时核验state版本/必要字段；resident合同描述owner、capability、unavailable原因和恢复能力，不是一次真实服务健康探测的替代品。process event的developer view按sourceClass/display policy投射公开信息，原始provider、secret与hidden-reasoning分类不会自动进入开发者视图。

## JobStore的耐久状态

create生成queued记录并写JSON，markRunning仅接受queued，complete/fail/cancel通过update执行终态规则。终态记录不接受晚到worker覆盖；projectRoot/dataRoot/id/kind/createdAt由旧记录保留。markActiveInterrupted由宿主显式调用，把queued/running标failed并保留reason，已结束任务不改。写入采用同目录临时文件后rename，读取损坏JSON返回null；这里不能据rename推导与知识文件相同的fsync耐久承诺，也不能据单进程状态守卫推出多进程CAS。Main InfraModule真实消费JobStore，终态保护可由既有晚到worker测试定位。

## 同步事件、异步事件与可选留痕

SignalBus同步分发精确/通配订阅，隔离handler抛错；subscribe返回取消函数。SignalBridge订阅signal并投射到EventBus的signal:event和guard:updated。EventBus.emit沿Node EventEmitter同步语义返回是否有监听者，并记录有界内存历史；emitAsync使用rawListeners顺序await，保留once包装器及this绑定。两者的错误与等待语义不能混用，也都不是耐久队列。

SignalTraceWriter另将信号按类型追加JSONL，拒绝路径型type；写入失败不阻断信号。SignalAggregator按滑窗写ReportStore，dispose释放订阅；日志/trace是观测材料，不能取代业务提交结果。shutdown协调器只执行宿主已注册的hooks，LIFO、失败隔离与超时退出明确；它不凭自身存在保证所有资源都被注册或数据库已经checkpoint。Main SignalModule展示真实装配与shutdown注册，资源拥有者仍须选择stop/dispose的正确承诺。此页引用已有事件/Job测试源码，不新执行宿主进程或产品测试。

## 视图与术语

本页手工图描述已核对的关系与关键分叉；F1 也承担所列调用范围的业务纵切（V0）阅读，不能推出未画出的宿主自动调度。F0 文件依赖精选由同页选择集和 TypeScript 导入图生成，不是运行时轨迹。S0/R0 只描述正文指定的 owner、状态和恢复前提。公开 API、全部文件及变更影响见阅读器的对应入口。

`source` 为代码来源，`direct` 为直接绑定调用及断言，`indirect` 为经 helper/fixture 或间接行为的断言，`none` 为明确未覆盖。正文中的“宿主”指真实外层装配，不属于 Core 内部运行时。

## 模块协作与恢复边界深化

关闭应被理解为宿主建立的资源依赖顺序，而不是一个万能shutdown按钮。LIFO只对已register的hook生效；hook必须自行停止接收工作、等待队列、完成flush，再释放句柄，TimerRegistry.dispose放在最后且不代替排空。单hook失败不阻断后续清理，但最终exit(1)，硬超时则结束进程，未耐久工作只能交各组件自己的恢复协议。EventBus和SignalBus错误语义不同：emitAsync逐个await，首个失败终止后续；SignalBus隔离同步异常但不等待异步Promise。两种总线都不是耐久任务队列，history或JSONL也不能证明所有消费者成功。SignalAggregator.stop与dispose不同，后者解绑并丢弃窗口，若需要最后报告必须先flushNow。该专题未执行任何会退出进程的测试，也没有把内存事件fixture称为持久恢复证明。

<!-- atlas:generated:start -->

## 功能单元与调用接缝

各单元按真实入口拆分职责；门面暴露、内部调用和宿主装配是不同关系。关联图提供相邻阅读上下文，故障产生位置以条目源码为准。

<a id="m-M16-01" class="stable-anchor"></a>
<a id="宿主进程关闭协调器" class="stable-anchor"></a>

### 宿主进程关闭协调器

入口：`src/shared/shutdown.ts#ShutdownCoordinator`

| 检查项 | 功能与边界 |
| --- | --- |
| 输入 | 宿主register的hooks、install信号监听、timeout |
| 输出 | 进程退出码0/1及stderr日志 |
| 后续调用 / 绑定 | register；execute；await hook；process.exit |
| 状态与副作用 | 安装SIGTERM/SIGINT由宿主显式调用；执行LIFO并最终退出进程 |
| 能力边界 | import不自动install；无注册即无清理保证；必须先drain/flush再dispose，Core不凭空找到资源。 |

关联：[R3-HOOK · 某个已注册shutdown hook reject](README.md#f-R3-HOOK) · [R3-TIMEOUT · 关闭过程超过timeoutMs](README.md#f-R3-TIMEOUT)

<a id="m-M16-02" class="stable-anchor"></a>
<a id="timer与disposable最后清理" class="stable-anchor"></a>

### Timer与Disposable最后清理

入口：`src/shared/TimerRegistry.ts#TimerRegistryImpl`

| 检查项 | 功能与边界 |
| --- | --- |
| 输入 | 已登记timers/disposables |
| 输出 | dispose Promise与诊断计数 |
| 后续调用 / 绑定 | clearInterval/clearTimeout；Disposable.dispose |
| 状态与副作用 | 清timer、并行dispose、记录单项失败 |
| 能力边界 | 不会排空异步队列；dispose后仍允许登记但warn，后登记对象不会再被清理。 |

关联：[R3-POST-DISPOSE · TimerRegistry.dispose之后再注册timer或Disposable](README.md#f-R3-POST-DISPOSE)

<a id="m-M16-03" class="stable-anchor"></a>
<a id="同步事件与串行异步监听" class="stable-anchor"></a>

### 同步事件与串行异步监听

入口：`src/infrastructure/event/EventBus.ts#EventBus`

| 检查项 | 功能与边界 |
| --- | --- |
| 输入 | eventName与payload、listeners/once |
| 输出 | emit布尔值或emitAsync完成/拒绝 |
| 后续调用 / 绑定 | #recordEvent；super.emit；rawListeners |
| 状态与副作用 | 有界内存history；listener可有自己的副作用 |
| 能力边界 | emitAsync首个reject中止后续listener；history记录在派发前，不是所有消费者处理成功回执。 |

关联：[R3-EVENT-REJECT · emitAsync中某listener reject](README.md#f-R3-EVENT-REJECT) · 包入口 [@alembic/core](../../data/public-api.json)、[@alembic/core/events](../../data/public-api.json)

<a id="m-M16-04" class="stable-anchor"></a>
<a id="容错同步信号总线" class="stable-anchor"></a>

### 容错同步信号总线

入口：`src/infrastructure/signal/SignalBus.ts#SignalBus`

| 检查项 | 功能与边界 |
| --- | --- |
| 输入 | 结构化signal或send参数 |
| 输出 | 同步广播，无durable ack |
| 后续调用 / 绑定 | 精确订阅；通配订阅；unsubscribe函数 |
| 状态与副作用 | 内存计数、同步调用订阅者 |
| 能力边界 | 单handler异常隔离；不await async handler的Promise，不提供任务队列/重放。 |

关联：[R3-SIGNAL-HANDLER · SignalBus同步handler抛错](README.md#f-R3-SIGNAL-HANDLER) · 包入口 [@alembic/core](../../data/public-api.json)、[@alembic/core/events](../../data/public-api.json)

<a id="m-M16-05" class="stable-anchor"></a>
<a id="滑窗报告的flush与dispose" class="stable-anchor"></a>

### 滑窗报告的flush与dispose

入口：`src/infrastructure/signal/SignalAggregator.ts#SignalAggregator`

| 检查项 | 功能与边界 |
| --- | --- |
| 输入 | signal流、ReportStore、窗口/周期 |
| 输出 | 报告与异常signal、flushNow Promise |
| 后续调用 / 绑定 | timerRegistry.setInterval；ReportStore.write；#flush；dispose |
| 状态与副作用 | 内存窗口、周期写报告、取消订阅 |
| 能力边界 | stop只停timer；dispose额外解绑和清window；有待写报告应先显式flushNow。 |

关联：未声明跨项关联 · 包入口 [@alembic/core](../../data/public-api.json)、[@alembic/core/events](../../data/public-api.json)

<a id="m-M16-06" class="stable-anchor"></a>
<a id="可选jsonl信号留痕" class="stable-anchor"></a>

### 可选JSONL信号留痕

入口：`src/infrastructure/signal/SignalTraceWriter.ts#SignalTraceWriter`

| 检查项 | 功能与边界 |
| --- | --- |
| 输入 | SignalBus全量订阅、baseDir、可选WriteZone |
| 输出 | JSONL query/stats |
| 后续调用 / 绑定 | appendFileSync/WriteZone.appendFile；type单名校验 |
| 状态与副作用 | 按类型追加JSONL；查询读历史 |
| 能力边界 | 写失败静默容忍、不阻断总线；不是可靠审计提交，也未提供自动补写/订阅销毁。 |

关联：[R3-TRACE-WRITE · SignalTraceWriter追加JSONL失败](README.md#f-R3-TRACE-WRITE) · 包入口 [@alembic/core](../../data/public-api.json)、[@alembic/core/events](../../data/public-api.json)


## 生成的图与逐边依据

此区域由同页结构化图模型生成；请修改 frontmatter，再显式运行 `npm run inventory:write`，不要单独修改表格或 Mermaid。

<a id="graph-job-terminal-protection"></a>

### 作业状态与晚到结果保护

图 ID：`job-terminal-protection` · S0 · Core保存job状态和终态保护，宿主显式执行worker与重启恢复。

```mermaid
flowchart TD
accTitle: 作业状态与晚到结果保护
accDescr: Core保存job状态和终态保护，宿主显式执行worker与重启恢复。
n0["宿主调用JobStore"]
n1["queued"]
n2["running"]
n3["completed/failed/cancelled"]
n4["宿主选择中断恢复"]
n5["临时JSON→rename"]
n0 e0@-->|"create构造queued"| n1
n1 e1@-->|"markRunning只接queued"| n2
n2 e2@-->|"complete/fail/cancel经update"| n3
n3 e3@-->|"晚到结果保留现有终态"| n3
n4 e4@-->|"仅活动任务标failed"| n3
n1 e5@-->|"create通过#write保存"| n5
classDef entry fill:#e1f1ed,stroke:#44796b,color:#173d33
classDef host fill:#eef0f8,stroke:#7a85a3,color:#303c5c
classDef store fill:#e5eff7,stroke:#7596b2,color:#243e54
classDef error fill:#fff0d9,stroke:#b68a3a,color:#634d29
class n0 host
class n4 error
class n5 store
```

| 边 ID | 关系 | 源码定位 | 断言关系 | case / 缺口 | 相关旅程步骤 |
| --- | --- | --- | --- | --- | --- |
| <a id="e-job-terminal-protection--JB-01"></a>JB-01 | create构造queued | `src/daemon/JobStore.ts#JobStore` | direct | persists daemon jobs and lists newest first |  |
| <a id="e-job-terminal-protection--JB-02"></a>JB-02 | markRunning只接queued | `src/daemon/JobStore.ts#JobStore` | direct | persists daemon jobs and lists newest first |  |
| <a id="e-job-terminal-protection--JB-03"></a>JB-03 | complete/fail/cancel经update | `src/daemon/JobStore.ts#JobStore` | direct | persists daemon jobs and lists newest first |  |
| <a id="e-job-terminal-protection--JB-04"></a>JB-04 | 晚到结果保留现有终态 | `src/daemon/JobStore.ts#JobStore` | direct | does not allow terminal jobs to be overwritten by late workers |  |
| <a id="e-job-terminal-protection--JB-05"></a>JB-05 | 仅活动任务标failed | `src/daemon/JobStore.ts#JobStore` | direct | marks queued and running jobs interrupted without touching terminal jobs |  |
| <a id="e-job-terminal-protection--JB-06"></a>JB-06 | create通过#write保存 | `src/daemon/JobStore.ts#JobStore` | direct | persists daemon jobs and lists newest first |  |

<a id="graph-events-signals-waiting"></a>

### 信号桥接与事件等待语义

图 ID：`events-signals-waiting` · F1 · 订阅绑定与实际发射分别标注；同步emit与串行await的emitAsync是两种消费承诺。

```mermaid
flowchart TD
accTitle: 信号桥接与事件等待语义
accDescr: 订阅绑定与实际发射分别标注；同步emit与串行await的emitAsync是两种消费承诺。
n0["SignalBus"]
n1["SignalBridge"]
n2["EventBus"]
n3["同步listeners"]
n4["串行await listeners<br/>保留once与this"]
n0 e0@-->|"构造时订阅全部信号"| n1
n1 e1@-->|"发射signal:event"| n2
n2 e2@-->|"emit委托EventEmitter"| n3
n2 e3@-->|"emitAsync逐个await rawListener"| n4
classDef entry fill:#e1f1ed,stroke:#44796b,color:#173d33
classDef host fill:#eef0f8,stroke:#7a85a3,color:#303c5c
classDef store fill:#e5eff7,stroke:#7596b2,color:#243e54
classDef error fill:#fff0d9,stroke:#b68a3a,color:#634d29
```

| 边 ID | 关系 | 源码定位 | 断言关系 | case / 缺口 | 相关旅程步骤 |
| --- | --- | --- | --- | --- | --- |
| <a id="e-events-signals-waiting--EV-01"></a>EV-01 | 构造时订阅全部信号 | `src/infrastructure/signal/SignalBridge.ts#SignalBridge` | direct | SignalBridge forwards signal events into EventBus channels |  |
| <a id="e-events-signals-waiting--EV-02"></a>EV-02 | 发射signal:event | `src/infrastructure/signal/SignalBridge.ts#SignalBridge` | direct | SignalBridge forwards signal events into EventBus channels |  |
| <a id="e-events-signals-waiting--EV-03"></a>EV-03 | emit委托EventEmitter | `src/infrastructure/event/EventBus.ts#EventBus` | indirect | should deliver events to listeners |  |
| <a id="e-events-signals-waiting--EV-04"></a>EV-04 | emitAsync逐个await rawListener | `src/infrastructure/event/EventBus.ts#EventBus` | indirect | should await all async listeners |  |

<a id="graph-r3-shutdown-resource-ownership"></a>

### 关闭hook的顺序、失败隔离与强退

图 ID：`r3-shutdown-resource-ownership` · R0 · 这里只画shutdown真实执行；TimerRegistry/DB/vector必须由宿主注册合适hook，不虚构自动发现或调用。

```mermaid
flowchart TD
accTitle: 关闭hook的顺序、失败隔离与强退
accDescr: 这里只画shutdown真实执行；TimerRegistry/DB/vector必须由宿主注册合适hook，不虚构自动发现或调用。
n0["宿主register/install"]
n1["execute防重入"]
n2["逆注册顺序await hooks"]
n3["hook失败记录"]
n4["全部结束后exit(0/1)"]
n5["硬超时exit(1)"]
n0 e0@-->|"install注册进程信号入口"| n1
n1 e1@-->|"LIFO执行已注册hooks"| n2
n2 e2@-->|"catch记录并继续下一个"| n3
n2 e3@-->|"根据是否失败退出"| n4
n1 e4@-->|"到达配置期限强退"| n5
classDef entry fill:#e1f1ed,stroke:#44796b,color:#173d33
classDef host fill:#eef0f8,stroke:#7a85a3,color:#303c5c
classDef store fill:#e5eff7,stroke:#7596b2,color:#243e54
classDef error fill:#fff0d9,stroke:#b68a3a,color:#634d29
class n0 host
class n3 error
class n5 error
```

| 边 ID | 关系 | 源码定位 | 断言关系 | case / 缺口 | 相关旅程步骤 |
| --- | --- | --- | --- | --- | --- |
| <a id="e-r3-shutdown-resource-ownership--R3-E1"></a>R3-E1 | install注册进程信号入口 | `src/shared/shutdown.ts#ShutdownCoordinator` | none | 未执行进程信号测试。 |  |
| <a id="e-r3-shutdown-resource-ownership--R3-E2"></a>R3-E2 | LIFO执行已注册hooks | `src/shared/shutdown.ts#ShutdownCoordinator` | none | 无隔离子进程LIFO实跑证据。 |  |
| <a id="e-r3-shutdown-resource-ownership--R3-E3"></a>R3-E3 | catch记录并继续下一个 | `src/shared/shutdown.ts#ShutdownCoordinator` | none | 无hook reject实际退出case。 |  |
| <a id="e-r3-shutdown-resource-ownership--R3-E4"></a>R3-E4 | 根据是否失败退出 | `src/shared/shutdown.ts#ShutdownCoordinator` | none | 源码执行语义，不主张本轮运行过。 |  |
| <a id="e-r3-shutdown-resource-ownership--R3-E5"></a>R3-E5 | 到达配置期限强退 | `src/shared/shutdown.ts#ShutdownCoordinator` | none | 未执行强退测试。 |  |

<a id="graph-dependencies-16"></a>

### 文件依赖精选 · 静态关系

图 ID：`dependencies-16` · F0 · 显式选择集内的实际导入；类型边不代表运行调用，动态未知保留在全量索引。

```mermaid
flowchart TD
accTitle: 文件依赖精选 · 静态关系
accDescr: 显式选择集内的实际导入；类型边不代表运行调用，动态未知保留在全量索引。
n0["daemon/JobStore.ts"]
n1["event/EventBus.ts"]
n2["signal/SignalBus.ts"]
n3["signal/SignalBridge.ts"]
n4["daemon/DaemonState.ts"]
n5["daemon/ResidentServiceContracts.ts"]
n6["signal/SignalTraceWriter.ts"]
n7["signal/SignalAggregator.ts"]
n0 e0@-->|"value"| n4
n5 e1@-->|"type"| n0
n7 e2@-->|"type"| n2
n3 e3@-->|"type"| n1
n3 e4@-->|"type"| n2
n6 e5@-->|"type"| n2
classDef entry fill:#e1f1ed,stroke:#44796b,color:#173d33
classDef host fill:#eef0f8,stroke:#7a85a3,color:#303c5c
classDef store fill:#e5eff7,stroke:#7596b2,color:#243e54
classDef error fill:#fff0d9,stroke:#b68a3a,color:#634d29
class n0 store
class n1 store
class n2 store
class n3 store
class n4 store
class n5 store
class n6 store
class n7 store
```

| 边 ID | 关系 | 源码定位 | 断言关系 | case / 缺口 | 相关旅程步骤 |
| --- | --- | --- | --- | --- | --- |
| <a id="e-dependencies-16--dep-16-0"></a>dep-16-0 | value | `src/daemon/JobStore.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |
| <a id="e-dependencies-16--dep-16-1"></a>dep-16-1 | type | `src/daemon/ResidentServiceContracts.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |
| <a id="e-dependencies-16--dep-16-2"></a>dep-16-2 | type | `src/infrastructure/signal/SignalAggregator.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |
| <a id="e-dependencies-16--dep-16-3"></a>dep-16-3 | type | `src/infrastructure/signal/SignalBridge.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |
| <a id="e-dependencies-16--dep-16-4"></a>dep-16-4 | type | `src/infrastructure/signal/SignalBridge.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |
| <a id="e-dependencies-16--dep-16-5"></a>dep-16-5 | type | `src/infrastructure/signal/SignalTraceWriter.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |

## 失败后的状态与恢复责任

先检查已落盘状态，再决定恢复。自动动作只描述代码已执行的分支；显式恢复不能据提示文字推断为自动调用。

<a id="f-R3-HOOK" class="stable-anchor"></a>
<a id="r3-hook--某个已注册shutdown-hook-reject" class="stable-anchor"></a>

### R3-HOOK · 某个已注册shutdown hook reject

| 检查项 | 当前代码语义 |
| --- | --- |
| 已留下什么 | 之前关闭的资源不会重开；失败资源可能未清 |
| Core自动做什么 | 记录失败，继续剩余LIFO hooks，最终exit(1) |
| 谁显式恢复 | 宿主下次启动检查业务持久化和失败资源，修正hook；当前进程无自动重试该hook |
| 必须停止的条件 | 所有hooks完成或硬超时后退出；不能报全部清理成功 |
| 源码定位 | `src/shared/shutdown.ts#ShutdownCoordinator` |

```ts
hasFailure = true;
```

关联：[宿主进程关闭协调器](README.md#m-M16-01)

断言关系：**none**。未见实际隔离子进程的shutdown失败case；不能用singleton存在测试替代执行。

<a id="f-R3-TIMEOUT" class="stable-anchor"></a>
<a id="r3-timeout--关闭过程超过timeoutms" class="stable-anchor"></a>

### R3-TIMEOUT · 关闭过程超过timeoutMs

| 检查项 | 当前代码语义 |
| --- | --- |
| 已留下什么 | 未完成hook/队列可能仍有未确认写入 |
| Core自动做什么 | 硬timer调用process.exit(1) |
| 谁显式恢复 | 下次启动按各组件持久恢复协议检查WAL/job等；不保证自动补全所有队列 |
| 必须停止的条件 | 进程强退不可在同进程恢复；只保留已耐久证据 |
| 源码定位 | `src/shared/shutdown.ts#ShutdownCoordinator` |

```ts
process.stderr.write('[shutdown] Timeout reached, forcing exit\n');
```

关联：[宿主进程关闭协调器](README.md#m-M16-01)

断言关系：**none**。未运行子进程超时退出测试，源码边界明确。

<a id="f-R3-EVENT-REJECT" class="stable-anchor"></a>
<a id="r3-event-reject--emitasync中某listener-reject" class="stable-anchor"></a>

### R3-EVENT-REJECT · emitAsync中某listener reject

| 检查项 | 当前代码语义 |
| --- | --- |
| 已留下什么 | history已记录该事件；前面listener可能完成，后面未运行 |
| Core自动做什么 | Promise reject传播给调用方；不catch并继续剩余listener |
| 谁显式恢复 | 宿主按幂等性判断是否重发/补偿，不能默认整个事件未消费 |
| 必须停止的条件 | 在首个reject停止串行派发；无自动重放 |
| 源码定位 | `src/infrastructure/event/EventBus.ts#EventBus` |

```ts
await listener.apply(this, args);
```

关联：[同步事件与串行异步监听](README.md#m-M16-03) · 包入口 [@alembic/core](../../data/public-api.json)、[@alembic/core/events](../../data/public-api.json)

断言关系：**none**。现有测试验证串行/once正例；未定位reject后续不执行的明确case。

<a id="f-R3-SIGNAL-HANDLER" class="stable-anchor"></a>
<a id="r3-signal-handler--signalbus同步handler抛错" class="stable-anchor"></a>

### R3-SIGNAL-HANDLER · SignalBus同步handler抛错

| 检查项 | 当前代码语义 |
| --- | --- |
| 已留下什么 | 其他订阅者仍可消费；失败者副作用未知 |
| Core自动做什么 | catch隔离并继续精确/通配handler |
| 谁显式恢复 | 消费者自己记录失败和决定重试；总线无耐久重放 |
| 必须停止的条件 | 异常不外抛不等于所有订阅者处理成功 |
| 源码定位 | `src/infrastructure/signal/SignalBus.ts#SignalBus` |

```ts
handler(signal);
```

关联：[容错同步信号总线](README.md#m-M16-04) · 包入口 [@alembic/core](../../data/public-api.json)、[@alembic/core/events](../../data/public-api.json)

断言关系：**indirect**。`test/SignalBus.test.ts` · `handler error does not block other handlers`

精确订阅者之一抛错，另一个仍被调用（fallback）。这里只定位断言；实际运行范围见独立运行证据。

```ts
expect(goodHandler).toHaveBeenCalledOnce();
```

<a id="f-R3-POST-DISPOSE" class="stable-anchor"></a>
<a id="r3-post-dispose--timerregistrydispose之后再注册timer或disposable" class="stable-anchor"></a>

### R3-POST-DISPOSE · TimerRegistry.dispose之后再注册timer或Disposable

| 检查项 | 当前代码语义 |
| --- | --- |
| 已留下什么 | 新资源被创建/登记，但registry已处disposed |
| Core自动做什么 | 输出稳定diagnostic，保持兼容创建行为 |
| 谁显式恢复 | 宿主修正关闭顺序，自己清理晚到资源；后续dispose会立即return |
| 必须停止的条件 | 不能指望再次dispose兜底回收 |
| 源码定位 | `src/shared/TimerRegistry.ts#TimerRegistryImpl` |

```ts
`${operation}("${label}") after dispose() — it will not be cleaned up\n`
```

关联：[Timer与Disposable最后清理](README.md#m-M16-02)

断言关系：**none**。本次未见后登记资源真实回收行为case；源码已明确只诊断。

<a id="f-R3-TRACE-WRITE" class="stable-anchor"></a>
<a id="r3-trace-write--signaltracewriter追加jsonl失败" class="stable-anchor"></a>

### R3-TRACE-WRITE · SignalTraceWriter追加JSONL失败

| 检查项 | 当前代码语义 |
| --- | --- |
| 已留下什么 | 总线已派发，缺失该次耐久trace |
| Core自动做什么 | catch吞错，不阻断signal；不排队补写 |
| 谁显式恢复 | 宿主诊断文件系统并明确记录日志缺口，不能从query空集推断无事件 |
| 必须停止的条件 | 没有自动恢复该丢失trace的保证 |
| 源码定位 | `src/infrastructure/signal/SignalTraceWriter.ts#SignalTraceWriter` |

```ts
fs.appendFileSync(fileName, line, 'utf8');
```

关联：[可选JSONL信号留痕](README.md#m-M16-06) · 包入口 [@alembic/core](../../data/public-api.json)、[@alembic/core/events](../../data/public-api.json)

断言关系：**none**。已有真实JSONL成功查询测试不覆盖写入失败；不把catch当可靠日志。


<!-- atlas:generated:end -->
