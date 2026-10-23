---
topicId: "13"
title: Guard与反馈
question: 规则筛选、分层检查、不确定结果与反馈怎样运行？
sourcePaths:
  - src/guard.ts
  - src/repository/guard/GuardViolationRepository.ts
  - src/repository/guard/index.ts
  - src/service/guard/EnhancementGuardRules.ts
  - src/service/guard/ExclusionManager.ts
  - src/service/guard/GuardCheckEngine.ts
  - src/service/guard/GuardCodeChecks.ts
  - src/service/guard/GuardCrossFileChecks.ts
  - src/service/guard/GuardFeedbackLoop.ts
  - src/service/guard/GuardPatternUtils.ts
  - src/service/guard/GuardService.ts
  - src/service/guard/RuleLearner.ts
  - src/service/guard/UncertaintyCollector.ts
  - src/service/guard/ViolationsStore.ts
  - src/service/guard/index.ts
testPaths:
  - test/GuardCheckEngine.test.ts
  - test/GuardImmuneSystem.test.ts
  - test/GuardServicePersistence.test.ts
consumerRefs:
  - repository: Alembic
    path: lib/injection/modules/GuardModule.ts
    excerpt: "fileStore: ct.get('knowledgeFileWriter'),"
    meaning: 规则生命周期真实注入知识文件真相端口；引擎另接配置、知识仓储与信号
risks:
  - R03：auditFiles聚合丢层计数/skip，uncertain结果可能仍显示100% checkCoverage。
  - R04：注入/global RegExp跨行复用未清lastIndex，可交替漏报连续命中。
  - 违规消失到自动usage是启发式反馈；不等于人工验证实际采用修复。
diagrams:
  - id: guard-audit-feedback
    title: 分层审计与独立反馈循环
    viewType: F1
    description: 批次审计组合单文件和跨文件结果，规则/能力未知与使用反馈保持不同含义。
    nodes:
      - id: batch
        label: auditFiles批次入口
        role: service
        path: src/service/guard/GuardCheckEngine.ts
        symbol: GuardCheckEngine
      - id: single
        label: auditFile单文件
        role: service
        path: src/service/guard/GuardCheckEngine.ts
        symbol: GuardCheckEngine
      - id: checks
        label: checkCode分层检查
        role: service
        path: src/service/guard/GuardCheckEngine.ts
        symbol: GuardCheckEngine
      - id: cross
        label: 跨文件规则
        role: service
      - id: report
        label: 违规/uncertain摘要
        role: state
      - id: feedback
        label: |-
          GuardFeedbackLoop
          宿主另行传入结果
        role: service
        path: src/service/guard/GuardFeedbackLoop.ts
        symbol: GuardFeedbackLoop
      - id: usage
        label: 使用反馈记录
        role: port
    edges:
      - id: GD-01
        from: batch
        to: single
        label: 按文件调用auditFile
        kind: call
        source:
          path: src/service/guard/GuardCheckEngine.ts
          symbol: GuardCheckEngine
          excerpt: const result = this.auditFile(filePath, content, { ...options, isTest });
        test:
          relation: indirect
          path: test/GuardCheckEngine.test.ts
          caseTitle: summarizes batch audit and cross-file violations
          anchorSymbol: engine
          assertedBehavior: 通过beforeEach构造的engine.auditFiles调用；结果含四文件与跨文件重复category违规
          assertionExcerpt: expect(result.summary.filesChecked).toBe(4);
          scenarioKind: positive
      - id: GD-02
        from: single
        to: checks
        label: 按语言和scope执行
        kind: call
        source:
          path: src/service/guard/GuardCheckEngine.ts
          symbol: GuardCheckEngine
          excerpt: const violations = this.checkCode(code, language, { ...options, filePath });
        test:
          relation: indirect
          path: test/GuardCheckEngine.test.ts
          caseTitle: returns full single-file audit result
          anchorSymbol: engine
          assertedBehavior: 经auditFile调用checkCode，返回违规摘要和未知数组
          assertionExcerpt: expect(result.uncertainResults).toBeInstanceOf(Array);
          scenarioKind: positive
      - id: GD-03
        from: batch
        to: cross
        label: 批次再执行跨文件规则
        kind: call
        source:
          path: src/service/guard/GuardCheckEngine.ts
          symbol: GuardCheckEngine
          excerpt: const crossFileViolations = runCrossFileChecks(files, {
        test:
          relation: indirect
          path: test/GuardCheckEngine.test.ts
          caseTitle: summarizes batch audit and cross-file violations
          anchorSymbol: engine
          assertedBehavior: 通过beforeEach构造的engine.auditFiles调用；结果含四文件与跨文件重复category违规
          assertionExcerpt: expect(result.summary.filesChecked).toBe(4);
          scenarioKind: positive
      - id: GD-04
        from: batch
        to: report
        label: 聚合uncertain；R03计数缺口保留
        kind: data
        source:
          path: src/service/guard/GuardCheckEngine.ts
          symbol: GuardCheckEngine
          excerpt: aggregateCollector.addUncertain(u.ruleId, u.message, u.layer, u.reason, u.detail);
        test:
          relation: none
          reason: 已有batch测试只断言报告存在；未对R03反例作产品回归，不能据此声称覆盖率正确。
      - id: GD-05
        from: feedback
        to: report
        label: 读取历史集合与当前结果比较
        kind: data
        source:
          path: src/service/guard/GuardFeedbackLoop.ts
          symbol: GuardFeedbackLoop
          excerpt: const previousRuns = this.violationsStore.getRunsByFile(filePath);
        test:
          relation: direct
          path: test/GuardImmuneSystem.test.ts
          caseTitle: auto-confirms Recipe usage when previous violations disappear
          anchorSymbol: GuardFeedbackLoop
          assertedBehavior: case构造loop后调用processFixDetection，消失的违规映射到Recipe使用反馈
          assertionExcerpt: "expect(confirmations).toEqual([{ action: 'insert', recipeId:
            'safe-eval-alternative' }]);"
          scenarioKind: positive
      - id: GD-06
        from: feedback
        to: usage
        label: 消失的rule映射为自动usage
        kind: call
        source:
          path: src/service/guard/GuardFeedbackLoop.ts
          symbol: GuardFeedbackLoop
          excerpt: this.feedbackCollector.record('insert', fixRecipeId, {
        test:
          relation: direct
          path: test/GuardImmuneSystem.test.ts
          caseTitle: auto-confirms Recipe usage when previous violations disappear
          anchorSymbol: GuardFeedbackLoop
          assertedBehavior: case构造loop后调用processFixDetection，消失的违规映射到Recipe使用反馈
          assertionExcerpt: "expect(confirmations).toEqual([{ action: 'insert', recipeId:
            'safe-eval-alternative' }]);"
          scenarioKind: positive
  - id: r3-guard-uncertainty
    title: Guard的skip、uncertain和反馈前提
    description: 没有违规与没有能力结论分开；R03聚合缺口保持可见。
    viewType: R0
    nodes:
      - id: rules
        label: 筛选后的规则
        role: entry
      - id: regex
        label: regex编译/执行
        role: service
      - id: ast
        label: AST Layer1
        role: service
      - id: unknown
        label: skip + uncertain
        role: state
      - id: report
        label: |-
          能力报告
          R03聚合限制
        role: evidence
      - id: feedback
        label: 历史差集反馈
        role: service
      - id: current
        label: 当前/历史violations集合
        role: evidence
    edges:
      - id: G3-E1
        from: rules
        to: regex
        label: 按规则编译pattern
        kind: call
        source:
          path: src/service/guard/GuardCheckEngine.ts
          symbol: GuardCheckEngine
          excerpt: re = compilePattern(rule.pattern);
        test:
          relation: none
          reason: 源码调用；本图不声明正则全覆盖。
      - id: G3-E2
        from: regex
        to: unknown
        label: 编译失败记unknown
        kind: state
        source:
          path: src/service/guard/GuardCheckEngine.ts
          symbol: GuardCheckEngine
          excerpt: "`Pattern compilation failed: ${rule.pattern}`"
        test:
          relation: none
          reason: 未绑定该分支case。
      - id: G3-E3
        from: ast
        to: unknown
        label: unavailable执行数为0
        kind: state
        source:
          path: src/service/guard/GuardCheckEngine.ts
          symbol: GuardCheckEngine
          excerpt: this._uncertaintyCollector.recordLayerStats('ast', astRules.length, 0);
        test:
          relation: none
          reason: 未绑定该分支case。
      - id: G3-E4
        from: unknown
        to: report
        label: 报告保留uncertain条目
        kind: data
        source:
          path: src/service/guard/UncertaintyCollector.ts
          symbol: UncertaintyCollector
          excerpt: "uncertainResults: [...this.#uncertainResults],"
        test:
          relation: none
          reason: 报告生成与批量统计完整性是不同保证。
      - id: G3-E5
        from: feedback
        to: current
        label: 使用当前/历史违规差集；能力变化需人工判断
        kind: data
        source:
          path: src/service/guard/GuardFeedbackLoop.ts
          symbol: GuardFeedbackLoop
          excerpt: const currentRuleIds = new Set((currentResult.violations || []).map((v) => v.ruleId));
        test:
          relation: indirect
          path: test/GuardImmuneSystem.test.ts
          caseTitle: auto-confirms Recipe usage when previous violations disappear
          anchorSymbol: loop
          assertedBehavior: 真实loop比较history/current，mock反馈收集器收到usage；不是宿主修复采用证明
          assertionExcerpt: "expect(confirmations).toEqual([{ action: 'insert', recipeId:
            'safe-eval-alternative' }]);"
          scenarioKind: positive
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
  - src/service/guard/GuardCheckEngine.ts
  - src/service/guard/GuardFeedbackLoop.ts
  - src/service/guard/GuardService.ts
  - src/service/guard/UncertaintyCollector.ts
  - src/guard.ts
  - src/events.ts
  - src/search.ts
  - src/service/guard/index.ts
  - src/service/search/SearchEngine.ts
  - src/service/search/SearchTypes.ts
sourceFingerprint: 7b79bd8342607ebd4fccfa01afacfc805d42e9a6d098f529ba521791f80a8031
contextFingerprint: 350ea520b8109a5d7bf591cc4a13fae3921513d095e89b447f3239bbe1296cbb
moduleDetails:
  - name: 规则选择与regex执行
    entry:
      path: src/service/guard/GuardCheckEngine.ts
      symbol: GuardCheckEngine
      excerpt: let rules = this.getRules(language);
    input: 代码、language、scope、filePath、isTest
    output: violations与reasoning
    calls: getRules；compilePattern；注释/测试块掩码；runCodeLevelChecks
    sideEffects: 尝试回写guard hits
    limits: disabled/path/test/scope是执行前筛选；无违规不能证明被过滤规则已经执行。
    id: M13-01
    aliases:
      - 规则选择与regex执行
    graphRefs: []
    failureRefs: []
    apiRefs:
      - .
      - ./guard
  - name: AST规则与深层AST检查
    entry:
      path: src/service/guard/GuardCheckEngine.ts
      symbol: GuardCheckEngine
      excerpt: violations.push(...this._runAstRuleChecks(code, language, rules));
    input: 已筛选AST规则、源码及语言
    output: Layer1/Layer2违规、部分skip/uncertain记录
    calls: _getAstAnalyzer；AST规则query；AstAnalyzer.analyzeFile
    sideEffects: 语法查询与collector计数
    limits: Layer2某些catch直接返回[]，记录强度与Layer1不同，不可宣称所有跳过都可见。
    id: M13-02
    aliases:
      - ast规则与深层ast检查
    graphRefs: []
    failureRefs: []
    apiRefs:
      - .
      - ./guard
  - name: 不确定性与能力报告
    entry:
      path: src/service/guard/UncertaintyCollector.ts
      symbol: UncertaintyCollector
      excerpt: this.#uncertainResults.push({ ruleId, message, layer, reason, detail });
    input: 分层total/executed、skip与uncertain事实
    output: boundaries/executedChecks/skippedChecks/checkCoverage
    calls: recordSkip；recordLayerStats；buildReport
    sideEffects: 进程内单次审计统计，可reset
    limits: R03批量仅重放uncertain，不能据聚合checkCoverage=100判已完整检查。
    id: M13-03
    aliases:
      - 不确定性与能力报告
    graphRefs: []
    failureRefs: []
    apiRefs:
      - .
      - ./guard
  - name: 违规消失到使用反馈
    entry:
      path: src/service/guard/GuardFeedbackLoop.ts
      symbol: GuardFeedbackLoop
      excerpt: const fixed = this.detectFixedViolations(currentResult, filePath);
    input: 当前结果、历史runs与可选规则映射
    output: fixed列表和自动usage记录
    calls: getRunsByFile；_findFixRecipe；autoConfirmUsage；feedbackCollector.record
    sideEffects: 反馈记录和可选usage信号
    limits: 缺历史/读取错误返回[]；规则消失可能是配置或能力变化，不等价人工采用修复。
    id: M13-04
    aliases:
      - 违规消失到使用反馈
    graphRefs: []
    failureRefs:
      - G3-FEEDBACK
    apiRefs:
      - .
      - ./guard
failureModes:
  - id: G3-REGEX
    trigger: pattern无法编译
    remainingState: 该规则未执行，其他规则仍可继续
    automaticAction: recordSkip invalid_regex并addUncertain，跳过该条
    explicitRecovery: 维护者修正规则后重新审计；不能把空violations当pass
    stopCondition: 停止该条regex，不自动改写规则
    source:
      path: src/service/guard/GuardCheckEngine.ts
      symbol: GuardCheckEngine
      excerpt: "`Pattern compilation failed: ${rule.pattern}`"
    test:
      relation: none
      reason: 本次未定位非法regex的同case断言；原batch测试仅断言结构。
    aliases:
      - g3-regex--pattern无法编译
    moduleRefs: []
    graphRefs: []
    apiRefs:
      - .
      - ./guard
  - id: G3-AST
    trigger: 已知语言的AST规则存在，但parser不可用/加载失败
    remainingState: 该AST规则无有效结论
    automaticAction: Layer1为每规则记skip+uncertain并记执行数0
    explicitRecovery: 宿主恢复grammar/parser，再明确重新audit；没有自动下载或替换规则
    stopCondition: 返回[]表示该层未完成，不是规则合规
    source:
      path: src/service/guard/GuardCheckEngine.ts
      symbol: GuardCheckEngine
      excerpt: this._uncertaintyCollector.recordLayerStats('ast', astRules.length, 0);
    test:
      relation: none
      reason: 本次未定位Layer1 unavailable分支的精确case，保留未覆盖。
    aliases:
      - g3-ast--已知语言的ast规则存在但parser不可用加载失败
    moduleRefs: []
    graphRefs: []
    apiRefs:
      - .
      - ./guard
  - id: G3-LAYER2
    trigger: 深层AstAnalyzer.analyzeFile抛错
    remainingState: Layer2不产出违规；已完成其他层结果保留
    automaticAction: debug日志后返回[]；此catch不补充逐规则uncertain
    explicitRecovery: 排查AST异常后显式重跑；消费者不能用空数组证明深层检查通过
    stopCondition: 终止本层深层检查，非自动恢复
    source:
      path: src/service/guard/GuardCheckEngine.ts
      symbol: GuardCheckEngine
      excerpt: "this.logger.debug(`AST Layer 2 analyzeFile failed: ${(err as Error).message}`);"
    test:
      relation: none
      reason: 源码确认catch语义；未新增反例执行或用Layer1测试替代。
    aliases:
      - g3-layer2--深层astanalyzeranalyzefile抛错
    moduleRefs: []
    graphRefs: []
    apiRefs:
      - .
      - ./guard
  - id: G3-AGGREGATE-R03
    trigger: auditFiles重建aggregateCollector只复制uncertain
    remainingState: 单文件skip/层计数在批量能力报告中缺失
    automaticAction: 当前仍buildReport；零total会显示100
    explicitRecovery: 维护者应同时阅读单文件诊断与已知R03，产品修复需要另行授权
    stopCondition: 不能以100%关闭盲区或报完整通过
    source:
      path: src/service/guard/GuardCheckEngine.ts
      symbol: GuardCheckEngine
      excerpt: aggregateCollector.addUncertain(u.ruleId, u.message, u.layer, u.reason, u.detail);
    test:
      relation: none
      reason: R03上一轮已复现；未存在本轮新增产品回归case。
    aliases:
      - g3-aggregate-r03--auditfiles重建aggregatecollector只复制uncertain
    moduleRefs: []
    graphRefs: []
    apiRefs:
      - .
      - ./guard
  - id: G3-GLOBAL-REGEX-R04
    trigger: 外部/g RegExp跨行复用
    remainingState: 前一行lastIndex可能影响下一行命中
    automaticAction: 当前循环直接re.test，不保证重置
    explicitRecovery: 人工复核连续命中行，产品修复另行授权；本图不悄悄修正代码语义
    stopCondition: 可能漏报；不能把不命中当未违反
    source:
      path: src/service/guard/GuardCheckEngine.ts
      symbol: GuardCheckEngine
      excerpt: if (re.test(lines[i])) {
    test:
      relation: none
      reason: R04上一轮已复现，未将普通regex成功case当回归覆盖。
    aliases:
      - g3-global-regex-r04--外部g-regexp跨行复用
    moduleRefs: []
    graphRefs: []
    apiRefs:
      - .
      - ./guard
  - id: G3-FEEDBACK
    trigger: 历史违规存储读取异常
    remainingState: 没有可靠历史差集，不生成fixed列表
    automaticAction: debug记录后返回[]
    explicitRecovery: 宿主恢复history读取后重新processFixDetection；无自动重放反馈
    stopCondition: 不产生自动usage不等于没有修复行为
    source:
      path: src/service/guard/GuardFeedbackLoop.ts
      symbol: GuardFeedbackLoop
      excerpt: "`[GuardFeedbackLoop] detectFixedViolations error: ${(err as Error).message}`"
    test:
      relation: none
      reason: 已有positive反馈case不覆盖history失败；故明确none。
    aliases:
      - g3-feedback--历史违规存储读取异常
    moduleRefs:
      - M13-04
    graphRefs: []
    apiRefs:
      - .
      - ./guard
---

## 规则与检查的分工

`@alembic/core/guard`暴露GuardService、GuardCheckEngine、反馈循环与规则学习工具。GuardService管理kind=rule、knowledgeType=boundary-constraint的KnowledgeEntry，规则存在constraints.guards中；它的create/enable/disable和普通知识一样使用文件优先提交，成功后刷新引擎缓存。AST-only规则保存真实query和description，不要求伪造regex正文。宿主GuardModule负责合并基础与项目配置、注入knowledgeRepository、fileStore与signalBus。

GuardCheckEngine接收源码文本、语言、scope、文件路径及测试标识，组合内置、数据库与注入规则。checkCode先按language、excludePaths、skipTestFiles及project/target/file层级过滤，再计算注释/测试块掩码，逐行regex检查；之后执行code-level规则、AST规则和第二层AST分析。缺grammar或无法执行的规则形成uncertain/skip，不能把空violations自动解释为已证明安全。命中会尝试回写Recipe统计，结果补充whatViolated、whyItMatters和suggestedFix。

## 文件、批次与反馈

auditFile重置单文件collector并返回violations、uncertainResults和摘要；auditFiles逐个调用它，再加跨文件检查、汇总和去重guard信号。GuardFeedbackLoop独立比较当前与上次违规集合，发现消失的ruleId后解析fixSuggestion或规则映射，通过FeedbackCollector记一次自动使用，并可发usage信号。这里的“修复”是违规不再出现的启发式观察，不等同宿主确认已采用某段建议；反馈读取错误和消费者失败采用best-effort诊断。

## 已知限制不能被绿灯隐藏

R03：批次aggregateCollector只加入uncertain条目，没有合并单文件executed/skipped层计数；buildReport在总检查数为零时给出100，因此可能同时显示uncertain和100% checkCoverage。这是实现缺口，不能用coverage数字代替能力完备结论。R04：注入的全局RegExp跨行复用而未重置lastIndex，连续匹配行可交替漏报；非全局pattern并不因此全部失效。两项是上一轮已复现问题，本轮Atlas只显式记录。

既有测试分别验证batch/cross-file结构、相同摘要信号只发一次、真实Markdown/SQLite规则生命周期和反馈记录。它们没有覆盖上述两个反例，也不证明所有语言/AST规则均执行。阅读器应分别展示违规、未知与测试证据，不将图可渲染冒充Guard正确性。

## 视图与术语

本页手工图描述已核对的关系与关键分叉；F1 也承担所列调用范围的业务纵切（V0）阅读，不能推出未画出的宿主自动调度。F0 文件依赖精选由同页选择集和 TypeScript 导入图生成，不是运行时轨迹。S0/R0 只描述正文指定的 owner、状态和恢复前提。公开 API、全部文件及变更影响见阅读器的对应入口。

`source` 为代码来源，`direct` 为直接绑定调用及断言，`indirect` 为经 helper/fixture 或间接行为的断言，`none` 为明确未覆盖。正文中的“宿主”指真实外层装配，不属于 Core 内部运行时。

## 模块协作与恢复边界深化

Guard需要分开“规则未进入执行”“规则执行但不命中”“执行无法确认”三种结果。scope/path/test筛选是预期排除，不必等价错误；编译失败和Layer1 parser不可用则有skip/uncertain；Layer2异常的现有路径日志后返回空数组，不能按统一collector推导覆盖完备。UncertaintyCollector保存计数事实，auditFiles重建时的R03会丢统计；R04则使全局正则lastIndex跨行泄漏。两者继续保留，不因新图增加了失败节点而假定已修复。反馈链依赖两次审计具有可比较性：违规消失可能源于代码修改，也可能源于规则关闭、范围变化或AST未执行。自动usage是现有启发式记录，并非宿主确认采用了修复。

<!-- atlas:generated:start -->

## 功能单元与调用接缝

各单元按真实入口拆分职责；门面暴露、内部调用和宿主装配是不同关系。关联图提供相邻阅读上下文，故障产生位置以条目源码为准。

<a id="m-M13-01" class="stable-anchor"></a>
<a id="规则选择与regex执行" class="stable-anchor"></a>

### 规则选择与regex执行

入口：`src/service/guard/GuardCheckEngine.ts#GuardCheckEngine`

| 检查项 | 功能与边界 |
| --- | --- |
| 输入 | 代码、language、scope、filePath、isTest |
| 输出 | violations与reasoning |
| 后续调用 / 绑定 | getRules；compilePattern；注释/测试块掩码；runCodeLevelChecks |
| 状态与副作用 | 尝试回写guard hits |
| 能力边界 | disabled/path/test/scope是执行前筛选；无违规不能证明被过滤规则已经执行。 |

关联：未声明跨项关联 · 包入口 [@alembic/core](../../data/public-api.json)、[@alembic/core/guard](../../data/public-api.json)

<a id="m-M13-02" class="stable-anchor"></a>
<a id="ast规则与深层ast检查" class="stable-anchor"></a>

### AST规则与深层AST检查

入口：`src/service/guard/GuardCheckEngine.ts#GuardCheckEngine`

| 检查项 | 功能与边界 |
| --- | --- |
| 输入 | 已筛选AST规则、源码及语言 |
| 输出 | Layer1/Layer2违规、部分skip/uncertain记录 |
| 后续调用 / 绑定 | _getAstAnalyzer；AST规则query；AstAnalyzer.analyzeFile |
| 状态与副作用 | 语法查询与collector计数 |
| 能力边界 | Layer2某些catch直接返回[]，记录强度与Layer1不同，不可宣称所有跳过都可见。 |

关联：未声明跨项关联 · 包入口 [@alembic/core](../../data/public-api.json)、[@alembic/core/guard](../../data/public-api.json)

<a id="m-M13-03" class="stable-anchor"></a>
<a id="不确定性与能力报告" class="stable-anchor"></a>

### 不确定性与能力报告

入口：`src/service/guard/UncertaintyCollector.ts#UncertaintyCollector`

| 检查项 | 功能与边界 |
| --- | --- |
| 输入 | 分层total/executed、skip与uncertain事实 |
| 输出 | boundaries/executedChecks/skippedChecks/checkCoverage |
| 后续调用 / 绑定 | recordSkip；recordLayerStats；buildReport |
| 状态与副作用 | 进程内单次审计统计，可reset |
| 能力边界 | R03批量仅重放uncertain，不能据聚合checkCoverage=100判已完整检查。 |

关联：未声明跨项关联 · 包入口 [@alembic/core](../../data/public-api.json)、[@alembic/core/guard](../../data/public-api.json)

<a id="m-M13-04" class="stable-anchor"></a>
<a id="违规消失到使用反馈" class="stable-anchor"></a>

### 违规消失到使用反馈

入口：`src/service/guard/GuardFeedbackLoop.ts#GuardFeedbackLoop`

| 检查项 | 功能与边界 |
| --- | --- |
| 输入 | 当前结果、历史runs与可选规则映射 |
| 输出 | fixed列表和自动usage记录 |
| 后续调用 / 绑定 | getRunsByFile；_findFixRecipe；autoConfirmUsage；feedbackCollector.record |
| 状态与副作用 | 反馈记录和可选usage信号 |
| 能力边界 | 缺历史/读取错误返回[]；规则消失可能是配置或能力变化，不等价人工采用修复。 |

关联：[G3-FEEDBACK · 历史违规存储读取异常](README.md#f-G3-FEEDBACK) · 包入口 [@alembic/core](../../data/public-api.json)、[@alembic/core/guard](../../data/public-api.json)


## 生成的图与逐边依据

此区域由同页结构化图模型生成；请修改 frontmatter，再显式运行 `npm run inventory:write`，不要单独修改表格或 Mermaid。

<a id="graph-guard-audit-feedback"></a>

### 分层审计与独立反馈循环

图 ID：`guard-audit-feedback` · F1 · 批次审计组合单文件和跨文件结果，规则/能力未知与使用反馈保持不同含义。

```mermaid
flowchart TD
accTitle: 分层审计与独立反馈循环
accDescr: 批次审计组合单文件和跨文件结果，规则/能力未知与使用反馈保持不同含义。
n0["auditFiles批次入口"]
n1["auditFile单文件"]
n2["checkCode分层检查"]
n3["跨文件规则"]
n4["违规/uncertain摘要"]
n5["GuardFeedbackLoop<br/>宿主另行传入结果"]
n6["使用反馈记录"]
n0 e0@-->|"按文件调用auditFile"| n1
n1 e1@-->|"按语言和scope执行"| n2
n0 e2@-->|"批次再执行跨文件规则"| n3
n0 e3@-->|"聚合uncertain；R03计数缺口保留"| n4
n5 e4@-->|"读取历史集合与当前结果比较"| n4
n5 e5@-->|"消失的rule映射为自动usage"| n6
classDef entry fill:#e1f1ed,stroke:#44796b,color:#173d33
classDef host fill:#eef0f8,stroke:#7a85a3,color:#303c5c
classDef store fill:#e5eff7,stroke:#7596b2,color:#243e54
classDef error fill:#fff0d9,stroke:#b68a3a,color:#634d29
```

| 边 ID | 关系 | 源码定位 | 断言关系 | case / 缺口 | 相关旅程步骤 |
| --- | --- | --- | --- | --- | --- |
| <a id="e-guard-audit-feedback--GD-01"></a>GD-01 | 按文件调用auditFile | `src/service/guard/GuardCheckEngine.ts#GuardCheckEngine` | indirect | summarizes batch audit and cross-file violations |  |
| <a id="e-guard-audit-feedback--GD-02"></a>GD-02 | 按语言和scope执行 | `src/service/guard/GuardCheckEngine.ts#GuardCheckEngine` | indirect | returns full single-file audit result |  |
| <a id="e-guard-audit-feedback--GD-03"></a>GD-03 | 批次再执行跨文件规则 | `src/service/guard/GuardCheckEngine.ts#GuardCheckEngine` | indirect | summarizes batch audit and cross-file violations |  |
| <a id="e-guard-audit-feedback--GD-04"></a>GD-04 | 聚合uncertain；R03计数缺口保留 | `src/service/guard/GuardCheckEngine.ts#GuardCheckEngine` | none | 已有batch测试只断言报告存在；未对R03反例作产品回归，不能据此声称覆盖率正确。 |  |
| <a id="e-guard-audit-feedback--GD-05"></a>GD-05 | 读取历史集合与当前结果比较 | `src/service/guard/GuardFeedbackLoop.ts#GuardFeedbackLoop` | direct | auto-confirms Recipe usage when previous violations disappear |  |
| <a id="e-guard-audit-feedback--GD-06"></a>GD-06 | 消失的rule映射为自动usage | `src/service/guard/GuardFeedbackLoop.ts#GuardFeedbackLoop` | direct | auto-confirms Recipe usage when previous violations disappear |  |

<a id="graph-r3-guard-uncertainty"></a>

### Guard的skip、uncertain和反馈前提

图 ID：`r3-guard-uncertainty` · R0 · 没有违规与没有能力结论分开；R03聚合缺口保持可见。

```mermaid
flowchart TD
accTitle: Guard的skip、uncertain和反馈前提
accDescr: 没有违规与没有能力结论分开；R03聚合缺口保持可见。
n0["筛选后的规则"]
n1["regex编译/执行"]
n2["AST Layer1"]
n3["skip + uncertain"]
n4["能力报告<br/>R03聚合限制"]
n5["历史差集反馈"]
n6["当前/历史violations集合"]
n0 e0@-->|"按规则编译pattern"| n1
n1 e1@-->|"编译失败记unknown"| n3
n2 e2@-->|"unavailable执行数为0"| n3
n3 e3@-->|"报告保留uncertain条目"| n4
n5 e4@-->|"使用当前/历史违规差集；能力变化需人工判断"| n6
classDef entry fill:#e1f1ed,stroke:#44796b,color:#173d33
classDef host fill:#eef0f8,stroke:#7a85a3,color:#303c5c
classDef store fill:#e5eff7,stroke:#7596b2,color:#243e54
classDef error fill:#fff0d9,stroke:#b68a3a,color:#634d29
class n0 entry
```

| 边 ID | 关系 | 源码定位 | 断言关系 | case / 缺口 | 相关旅程步骤 |
| --- | --- | --- | --- | --- | --- |
| <a id="e-r3-guard-uncertainty--G3-E1"></a>G3-E1 | 按规则编译pattern | `src/service/guard/GuardCheckEngine.ts#GuardCheckEngine` | none | 源码调用；本图不声明正则全覆盖。 |  |
| <a id="e-r3-guard-uncertainty--G3-E2"></a>G3-E2 | 编译失败记unknown | `src/service/guard/GuardCheckEngine.ts#GuardCheckEngine` | none | 未绑定该分支case。 |  |
| <a id="e-r3-guard-uncertainty--G3-E3"></a>G3-E3 | unavailable执行数为0 | `src/service/guard/GuardCheckEngine.ts#GuardCheckEngine` | none | 未绑定该分支case。 |  |
| <a id="e-r3-guard-uncertainty--G3-E4"></a>G3-E4 | 报告保留uncertain条目 | `src/service/guard/UncertaintyCollector.ts#UncertaintyCollector` | none | 报告生成与批量统计完整性是不同保证。 |  |
| <a id="e-r3-guard-uncertainty--G3-E5"></a>G3-E5 | 使用当前/历史违规差集；能力变化需人工判断 | `src/service/guard/GuardFeedbackLoop.ts#GuardFeedbackLoop` | indirect | auto-confirms Recipe usage when previous violations disappear |  |

<a id="graph-dependencies-13"></a>

### 文件依赖精选 · 静态关系

图 ID：`dependencies-13` · F0 · 显式选择集内的实际导入；类型边不代表运行调用，动态未知保留在全量索引。

```mermaid
flowchart TD
accTitle: 文件依赖精选 · 静态关系
accDescr: 显式选择集内的实际导入；类型边不代表运行调用，动态未知保留在全量索引。
n0["guard/GuardCheckEngine.ts"]
n1["guard/GuardFeedbackLoop.ts"]
n2["guard/GuardService.ts"]
n3["guard/UncertaintyCollector.ts"]
n4["src/guard.ts"]
n5["src/events.ts"]
n6["src/search.ts"]
n7["guard/index.ts"]
n8["search/SearchEngine.ts"]
n9["search/SearchTypes.ts"]
n4 e0@-->|"type"| n5
n4 e1@-->|"type"| n6
n4 e2@-->|"value"| n0
n4 e3@-->|"re-export"| n7
n6 e4@-->|"value"| n8
n6 e5@-->|"type"| n9
n6 e6@-->|"type-re-export"| n9
n6 e7@-->|"re-export"| n9
n0 e8@-->|"type"| n3
n0 e9@-->|"value"| n3
n7 e10@-->|"re-export"| n0
n7 e11@-->|"re-export"| n1
n7 e12@-->|"re-export"| n2
n7 e13@-->|"re-export"| n3
n8 e14@-->|"type"| n9
n8 e15@-->|"value"| n9
n8 e16@-->|"type-re-export"| n9
n8 e17@-->|"re-export"| n9
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
class n8 store
class n9 store
```

| 边 ID | 关系 | 源码定位 | 断言关系 | case / 缺口 | 相关旅程步骤 |
| --- | --- | --- | --- | --- | --- |
| <a id="e-dependencies-13--dep-13-0"></a>dep-13-0 | type | `src/guard.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |
| <a id="e-dependencies-13--dep-13-1"></a>dep-13-1 | type | `src/guard.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |
| <a id="e-dependencies-13--dep-13-2"></a>dep-13-2 | value | `src/guard.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |
| <a id="e-dependencies-13--dep-13-3"></a>dep-13-3 | re-export | `src/guard.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |
| <a id="e-dependencies-13--dep-13-4"></a>dep-13-4 | value | `src/search.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |
| <a id="e-dependencies-13--dep-13-5"></a>dep-13-5 | type | `src/search.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |
| <a id="e-dependencies-13--dep-13-6"></a>dep-13-6 | type-re-export | `src/search.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |
| <a id="e-dependencies-13--dep-13-7"></a>dep-13-7 | re-export | `src/search.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |
| <a id="e-dependencies-13--dep-13-8"></a>dep-13-8 | type | `src/service/guard/GuardCheckEngine.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |
| <a id="e-dependencies-13--dep-13-9"></a>dep-13-9 | value | `src/service/guard/GuardCheckEngine.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |
| <a id="e-dependencies-13--dep-13-10"></a>dep-13-10 | re-export | `src/service/guard/index.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |
| <a id="e-dependencies-13--dep-13-11"></a>dep-13-11 | re-export | `src/service/guard/index.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |
| <a id="e-dependencies-13--dep-13-12"></a>dep-13-12 | re-export | `src/service/guard/index.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |
| <a id="e-dependencies-13--dep-13-13"></a>dep-13-13 | re-export | `src/service/guard/index.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |
| <a id="e-dependencies-13--dep-13-14"></a>dep-13-14 | type | `src/service/search/SearchEngine.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |
| <a id="e-dependencies-13--dep-13-15"></a>dep-13-15 | value | `src/service/search/SearchEngine.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |
| <a id="e-dependencies-13--dep-13-16"></a>dep-13-16 | type-re-export | `src/service/search/SearchEngine.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |
| <a id="e-dependencies-13--dep-13-17"></a>dep-13-17 | re-export | `src/service/search/SearchEngine.ts#<module>` | none | TypeScript AST 静态导入事实，不主张运行调用或断言覆盖。 |  |

## 失败后的状态与恢复责任

先检查已落盘状态，再决定恢复。自动动作只描述代码已执行的分支；显式恢复不能据提示文字推断为自动调用。

<a id="f-G3-REGEX" class="stable-anchor"></a>
<a id="g3-regex--pattern无法编译" class="stable-anchor"></a>

### G3-REGEX · pattern无法编译

| 检查项 | 当前代码语义 |
| --- | --- |
| 已留下什么 | 该规则未执行，其他规则仍可继续 |
| Core自动做什么 | recordSkip invalid_regex并addUncertain，跳过该条 |
| 谁显式恢复 | 维护者修正规则后重新审计；不能把空violations当pass |
| 必须停止的条件 | 停止该条regex，不自动改写规则 |
| 源码定位 | `src/service/guard/GuardCheckEngine.ts#GuardCheckEngine` |

```ts
`Pattern compilation failed: ${rule.pattern}`
```

关联：未声明跨项关联 · 包入口 [@alembic/core](../../data/public-api.json)、[@alembic/core/guard](../../data/public-api.json)

断言关系：**none**。本次未定位非法regex的同case断言；原batch测试仅断言结构。

<a id="f-G3-AST" class="stable-anchor"></a>
<a id="g3-ast--已知语言的ast规则存在但parser不可用加载失败" class="stable-anchor"></a>

### G3-AST · 已知语言的AST规则存在，但parser不可用/加载失败

| 检查项 | 当前代码语义 |
| --- | --- |
| 已留下什么 | 该AST规则无有效结论 |
| Core自动做什么 | Layer1为每规则记skip+uncertain并记执行数0 |
| 谁显式恢复 | 宿主恢复grammar/parser，再明确重新audit；没有自动下载或替换规则 |
| 必须停止的条件 | 返回[]表示该层未完成，不是规则合规 |
| 源码定位 | `src/service/guard/GuardCheckEngine.ts#GuardCheckEngine` |

```ts
this._uncertaintyCollector.recordLayerStats('ast', astRules.length, 0);
```

关联：未声明跨项关联 · 包入口 [@alembic/core](../../data/public-api.json)、[@alembic/core/guard](../../data/public-api.json)

断言关系：**none**。本次未定位Layer1 unavailable分支的精确case，保留未覆盖。

<a id="f-G3-LAYER2" class="stable-anchor"></a>
<a id="g3-layer2--深层astanalyzeranalyzefile抛错" class="stable-anchor"></a>

### G3-LAYER2 · 深层AstAnalyzer.analyzeFile抛错

| 检查项 | 当前代码语义 |
| --- | --- |
| 已留下什么 | Layer2不产出违规；已完成其他层结果保留 |
| Core自动做什么 | debug日志后返回[]；此catch不补充逐规则uncertain |
| 谁显式恢复 | 排查AST异常后显式重跑；消费者不能用空数组证明深层检查通过 |
| 必须停止的条件 | 终止本层深层检查，非自动恢复 |
| 源码定位 | `src/service/guard/GuardCheckEngine.ts#GuardCheckEngine` |

```ts
this.logger.debug(`AST Layer 2 analyzeFile failed: ${(err as Error).message}`);
```

关联：未声明跨项关联 · 包入口 [@alembic/core](../../data/public-api.json)、[@alembic/core/guard](../../data/public-api.json)

断言关系：**none**。源码确认catch语义；未新增反例执行或用Layer1测试替代。

<a id="f-G3-AGGREGATE-R03" class="stable-anchor"></a>
<a id="g3-aggregate-r03--auditfiles重建aggregatecollector只复制uncertain" class="stable-anchor"></a>

### G3-AGGREGATE-R03 · auditFiles重建aggregateCollector只复制uncertain

| 检查项 | 当前代码语义 |
| --- | --- |
| 已留下什么 | 单文件skip/层计数在批量能力报告中缺失 |
| Core自动做什么 | 当前仍buildReport；零total会显示100 |
| 谁显式恢复 | 维护者应同时阅读单文件诊断与已知R03，产品修复需要另行授权 |
| 必须停止的条件 | 不能以100%关闭盲区或报完整通过 |
| 源码定位 | `src/service/guard/GuardCheckEngine.ts#GuardCheckEngine` |

```ts
aggregateCollector.addUncertain(u.ruleId, u.message, u.layer, u.reason, u.detail);
```

关联：未声明跨项关联 · 包入口 [@alembic/core](../../data/public-api.json)、[@alembic/core/guard](../../data/public-api.json)

断言关系：**none**。R03上一轮已复现；未存在本轮新增产品回归case。

<a id="f-G3-GLOBAL-REGEX-R04" class="stable-anchor"></a>
<a id="g3-global-regex-r04--外部g-regexp跨行复用" class="stable-anchor"></a>

### G3-GLOBAL-REGEX-R04 · 外部/g RegExp跨行复用

| 检查项 | 当前代码语义 |
| --- | --- |
| 已留下什么 | 前一行lastIndex可能影响下一行命中 |
| Core自动做什么 | 当前循环直接re.test，不保证重置 |
| 谁显式恢复 | 人工复核连续命中行，产品修复另行授权；本图不悄悄修正代码语义 |
| 必须停止的条件 | 可能漏报；不能把不命中当未违反 |
| 源码定位 | `src/service/guard/GuardCheckEngine.ts#GuardCheckEngine` |

```ts
if (re.test(lines[i])) {
```

关联：未声明跨项关联 · 包入口 [@alembic/core](../../data/public-api.json)、[@alembic/core/guard](../../data/public-api.json)

断言关系：**none**。R04上一轮已复现，未将普通regex成功case当回归覆盖。

<a id="f-G3-FEEDBACK" class="stable-anchor"></a>
<a id="g3-feedback--历史违规存储读取异常" class="stable-anchor"></a>

### G3-FEEDBACK · 历史违规存储读取异常

| 检查项 | 当前代码语义 |
| --- | --- |
| 已留下什么 | 没有可靠历史差集，不生成fixed列表 |
| Core自动做什么 | debug记录后返回[] |
| 谁显式恢复 | 宿主恢复history读取后重新processFixDetection；无自动重放反馈 |
| 必须停止的条件 | 不产生自动usage不等于没有修复行为 |
| 源码定位 | `src/service/guard/GuardFeedbackLoop.ts#GuardFeedbackLoop` |

```ts
`[GuardFeedbackLoop] detectFixedViolations error: ${(err as Error).message}`
```

关联：[违规消失到使用反馈](README.md#m-M13-04) · 包入口 [@alembic/core](../../data/public-api.json)、[@alembic/core/guard](../../data/public-api.json)

断言关系：**none**。已有positive反馈case不覆盖history失败；故明确none。


<!-- atlas:generated:end -->
