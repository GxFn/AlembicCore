# 独立运行证据

由明确执行命令产生回执，再由inventory:write派生。通过只对所列样本及来源身份成立。

<a id="V01"></a>

## V01 · 知识文件先行：DB分歧、阻断与显式同步

状态：passed · 快照生成时已核对原始报告、case、实际观察与来源；浏览器不实时访问ledger

环境：{"node":"v24.19.0","platform":"darwin","arch":"arm64","vitest":"4.1.6"}

实际执行：2026-10-23T16:41:05.961Z；case数：22。

原始记录：`architecture-atlas/runs/2026-10-23/v01-2026-10-23T16-41-02-466Z/report.json`

- create/update/quality/deprecate共用一套真实文件/DB夹具；不覆盖delete语义。
- sync helper实际调用KnowledgeSyncService.syncAll(runtime.sqlite)，异常中的reconcileVia字符串仍是KnowledgeSyncService.sync；图谱应区分提示与实际恢复命令。
- 不证明关系、审计、事件监听器、vector全链原子性，也不证明真实宿主接通。
- 本回执按完整Core产品库存绑定来源；主要实现路径用于阅读导航，不代表完整传递调用闭包。

本场景保留run级证据，尚未声明逐case到失败/步骤的精确映射。


<a id="V02"></a>

## V02 · 源码索引：内容身份、代际取消与显式追赶

状态：passed · 快照生成时已核对原始报告、case、实际观察与来源；浏览器不实时访问ledger

环境：{"node":"v24.19.0","platform":"darwin","arch":"arm64","vitest":"4.1.6"}

实际执行：2026-10-23T16:41:09.590Z；case数：6。

原始记录：`architecture-atlas/runs/2026-10-23/v02-2026-10-23T16-41-05-963Z/report.json`

- 这些case不证明外部CodeGraph补边完整，也未修复R06的callSitesComplete传播问题。
- partial case中parser-timeout由maxParseBytes预算产生，不是实际CPU挂起或系统超时实验。
- SourceGraph scope/数据库均是临时fixture，没有真实项目索引变化。
- 本回执按完整Core产品库存绑定来源；主要实现路径用于阅读导航，不代表完整传递调用闭包。

本场景保留run级证据，尚未声明逐case到失败/步骤的精确映射。


<a id="V03"></a>

## V03 · 认证工件与租约：中断后同身份重放

状态：passed · 快照生成时已核对原始报告、case、实际观察与来源；浏览器不实时访问ledger

环境：{"node":"v24.19.0","platform":"darwin","arch":"arm64","vitest":"4.1.6"}

实际执行：2026-10-23T16:41:12.844Z；case数：4。

原始记录：`architecture-atlas/runs/2026-10-23/v03-2026-10-23T16-41-09-591Z/report.json`

- 通过步骤hook模拟中断，不是杀进程、断电或磁盘硬件故障实验。
- 实测同进程新store实例，不是独立操作系统进程恢复；不得用fresh process描述V03。
- 没有并发读者逐瞬间读取JSON的探针；标题without exposing partial JSON只对应原子步骤设计和可读重放结果，不能扩展成全时序证明。
- 不自动接管其他run，不自动重新执行consumer adapter。
- 本回执按完整Core产品库存绑定来源；主要实现路径用于阅读导航，不代表完整传递调用闭包。

本场景保留run级证据，尚未声明逐case到失败/步骤的精确映射。


<a id="V04"></a>

## V04 · 向量WAL：快照写失败后显式flush与重开

状态：passed · 快照生成时已核对原始报告、case、实际观察与来源；浏览器不实时访问ledger

环境：{"node":"v24.19.0","platform":"darwin","arch":"arm64","vitest":"4.1.6"}

实际执行：2026-10-23T16:41:13.618Z；case数：3。

原始记录：`architecture-atlas/runs/2026-10-23/v04-2026-10-23T16-41-12-845Z/report.json`

- destroy会同步保存；第三case明确恢复旧快照构造输入，不能称destroy等价进程崩溃。
- 前两case不是独立进程重启；是新adapter实例重开。
- 不证明断电fsync整体保证，也不证明坏CRC对应丢失数据可修复。
- 不调用embedding provider，也不覆盖知识live-truth/filter/publication全链。
- 本回执按完整Core产品库存绑定来源；主要实现路径用于阅读导航，不代表完整传递调用闭包。

本场景保留run级证据，尚未声明逐case到失败/步骤的精确映射。


<a id="V05"></a>

## V05 · 严格语义评审离线回执：V4/V5序列化、新进程重验与篡改拒绝

状态：passed · 快照生成时已核对原始报告、case、实际观察与来源；浏览器不实时访问ledger

环境：{"node":"v24.19.0","platform":"darwin","arch":"arm64","vitest":"4.1.6"}

实际执行：2026-10-23T16:41:20.170Z；case数：4。

原始记录：`architecture-atlas/runs/2026-10-23/v05-2026-10-23T16-41-13-618Z/report.json`

- CLI只能运行SharedHarvestSemanticEvidenceAuthority主文件；DurableSemanticDispositionFreshProcess是嵌套support，单独无env运行会skip，不能算独立通过。
- 外层Vitest JSON expected4 cases，不应把两个子进程case误计为外层6；父case的stdout断言提供nested通过依据。
- Gateway名称包含Agent但本样本全在Core；没有修改或启动AlembicAgent。
- 断言是签名、receipt binding、request结构与验证合同；reviewer内容由fixture给定，不证明真实模型评审质量。
- 未覆盖Main持久化/实际发布，未修复R01，也未针对当前消费端expectedSemanticRequest换请求做独立负例；不要关联stf-current-request-mismatch为已实测。
- 本回执按完整Core产品库存绑定来源；主要实现路径用于阅读导航，不代表完整传递调用闭包。
- 子进程通过由外层case断言其输出含1 passed证明；本回执只保存外层原始报告，不声称保存了子进程独立stdout。

本场景保留run级证据，尚未声明逐case到失败/步骤的精确映射。


<a id="V06"></a>

## V06 · 知识删除：文件、目标事务与后置事件分段恢复

状态：passed · 快照生成时已核对原始报告、case、实际观察与来源；浏览器不实时访问ledger

环境：{"node":"v24.19.0","platform":"darwin","arch":"arm64","vitest":"4.1.6"}

实际执行：2026-10-23T16:41:23.370Z；case数：9。

原始记录：`architecture-atlas/runs/2026-10-23/v06-2026-10-23T16-41-20-171Z/report.json`

- 同ID重试限于主行仍存在的分歧；主行已无不能靠再次delete重放消费者。
- 审计失败non-blocking，事件计数不是向量已刷盘证明。

## 逐case业务结论与观察

<a id="case-V06-D1"></a>

### V06-D1 · unlink拒绝后文件和主行仍在，未发删除事件。

执行核验：所列case与观察匹配。业务结论类型：**拒绝验证**。

夹具：真实 I/O（范围见下方）。

| 检查项 | 所列case范围 |
| --- | --- |
| 故障 / 前提 | 只对目标文件unlink注入错误 |
| 显式动作 | 仅执行case中明确调用，不推断自动恢复 |
| 实际case身份 | `test/KnowledgeServicePersistence.test.ts` · KnowledgeService file-first commands delete preserves DB truth on unlink failure |

- 只证明所列case，其他副作用、并发与宿主接线未验证。

断言定位：`test/KnowledgeServicePersistence.test.ts` · `preserves DB truth on %s failure`

```ts
expect(fs.existsSync(file)).toBe(true);
```

该case依据原始Vitest结果和上述断言定位；没有额外探针状态快照。

模块：[M10-06](../maps/10-knowledge-authoring-persistence/README.md#m-M10-06)

失败：[K3-DELETE-FILE](../maps/10-knowledge-authoring-persistence/README.md#f-K3-DELETE-FILE)

返回具体步骤：[J05-01](../journeys/j05.md#J05-01)

<a id="case-V06-D2"></a>

### V06-D2 · 文件ID归属歧义阻断删除，DB未改变。

执行核验：所列case与观察匹配。业务结论类型：**拒绝验证**。

夹具：真实 I/O（范围见下方）。

| 检查项 | 所列case范围 |
| --- | --- |
| 故障 / 前提 | 目标Markdown含重复id字段 |
| 显式动作 | 仅执行case中明确调用，不推断自动恢复 |
| 实际case身份 | `test/KnowledgeServicePersistence.test.ts` · KnowledgeService file-first commands delete preserves DB truth on ambiguous-owner failure |

- 只证明所列case，其他副作用、并发与宿主接线未验证。

断言定位：`test/KnowledgeServicePersistence.test.ts` · `preserves DB truth on %s failure`

```ts
expect(await env.repo.findById(id)).not.toBeNull();
```

该case依据原始Vitest结果和上述断言定位；没有额外探针状态快照。

模块：[M10-06](../maps/10-knowledge-authoring-persistence/README.md#m-M10-06)

失败：[K3-DELETE-FILE](../maps/10-knowledge-authoring-persistence/README.md#f-K3-DELETE-FILE)

返回具体步骤：[J05-01](../journeys/j05.md#J05-01)

<a id="case-V06-D3"></a>

### V06-D3 · 文件已不存在仍可清理现存DB主行。

执行核验：所列case与观察匹配。业务结论类型：**正常路径**。

夹具：真实 I/O（范围见下方）。

| 检查项 | 所列case范围 |
| --- | --- |
| 故障 / 前提 | 调用前显式移除fixture文件 |
| 显式动作 | 仅执行case中明确调用，不推断自动恢复 |
| 实际case身份 | `test/KnowledgeServicePersistence.test.ts` · KnowledgeService file-first commands delete retains deletion of an index row whose file is already absent |

- 只证明所列case，其他副作用、并发与宿主接线未验证。

断言定位：`test/KnowledgeServicePersistence.test.ts` · `retains deletion of an index row whose file is already absent`

```ts
expect(await env.repo.findById(id)).toBeNull();
```

该case依据原始Vitest结果和上述断言定位；没有额外探针状态快照。

模块：[M10-06](../maps/10-knowledge-authoring-persistence/README.md#m-M10-06)

失败：本case未声明

返回具体步骤：[J05-02](../journeys/j05.md#J05-02)

<a id="case-V06-D4"></a>

### V06-D4 · 目标/FK事务拒绝时保留从表；排故后service.delete清理主行与所列从表。

执行核验：所列case与观察匹配。业务结论类型：**恢复验证**。

夹具：真实 I/O（范围见下方）。

| 检查项 | 所列case范围 |
| --- | --- |
| 故障 / 前提 | 所选case内明确注入；正常路径无注入 |
| 显式动作 | 仅执行case中明确调用，不推断自动恢复 |
| 实际case身份 | `test/KnowledgeServicePersistence.test.ts` · KnowledgeService file-first commands delete deletes dependent proposal, warning and lifecycle rows in the repository transaction |

- 失败段直接调用repository.delete；不证明全部referrer与文件受同一事务保护。

断言定位：`test/KnowledgeServicePersistence.test.ts` · `deletes dependent proposal, warning and lifecycle rows in the repository transaction`

```ts
expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
```

该case依据原始Vitest结果和上述断言定位；没有额外探针状态快照。

模块：[M10-06](../maps/10-knowledge-authoring-persistence/README.md#m-M10-06)

失败：[K3-DELETE-DB](../maps/10-knowledge-authoring-persistence/README.md#f-K3-DELETE-DB)

返回具体步骤：[J05-02](../journeys/j05.md#J05-02)

<a id="case-V06-D5"></a>

### V06-D5 · ABORT后目标文件已无、主行仍在；同ID再次delete完成清理。

执行核验：所列case与观察匹配。业务结论类型：**恢复验证**。

夹具：真实 I/O（范围见下方）。

| 检查项 | 所列case范围 |
| --- | --- |
| 故障 / 前提 | 目标DELETE触发器RAISE(ABORT) |
| 显式动作 | 移除触发器后显式service.delete(id, context) |
| 实际case身份 | `test/KnowledgeServicePersistence.test.ts` · KnowledgeService file-first commands delete reports a DB ABORT after file removal and supports retry |

- 只证明所列case，其他副作用、并发与宿主接线未验证。

断言定位：`test/KnowledgeServicePersistence.test.ts` · `reports a DB %s after file removal and supports retry`

```ts
expect(await env.repo.findById(id)).toBeNull();
```

该case依据原始Vitest结果和上述断言定位；没有额外探针状态快照。

模块：[M10-06](../maps/10-knowledge-authoring-persistence/README.md#m-M10-06)

失败：[K3-DELETE-DB](../maps/10-knowledge-authoring-persistence/README.md#f-K3-DELETE-DB)

返回具体步骤：[J05-02](../journeys/j05.md#J05-02)

<a id="case-V06-D6"></a>

### V06-D6 · IGNORE不会成为假成功；分歧后同ID再次delete完成清理。

执行核验：所列case与观察匹配。业务结论类型：**恢复验证**。

夹具：真实 I/O（范围见下方）。

| 检查项 | 所列case范围 |
| --- | --- |
| 故障 / 前提 | 目标DELETE触发器RAISE(IGNORE) |
| 显式动作 | 移除触发器后显式service.delete(id, context) |
| 实际case身份 | `test/KnowledgeServicePersistence.test.ts` · KnowledgeService file-first commands delete reports a DB IGNORE after file removal and supports retry |

- 只证明所列case，其他副作用、并发与宿主接线未验证。

断言定位：`test/KnowledgeServicePersistence.test.ts` · `reports a DB %s after file removal and supports retry`

```ts
expect(fs.existsSync(file)).toBe(false);
```

该case依据原始Vitest结果和上述断言定位；没有额外探针状态快照。

模块：[M10-06](../maps/10-knowledge-authoring-persistence/README.md#m-M10-06)

失败：[K3-DELETE-DB](../maps/10-knowledge-authoring-persistence/README.md#f-K3-DELETE-DB)

返回具体步骤：[J05-02](../journeys/j05.md#J05-02)

<a id="case-V06-D7"></a>

### V06-D7 · 同一fixture记录文件先删、DB拒绝、同ID重试后主行消失与事件一次。

执行核验：所列case与观察匹配。业务结论类型：**恢复验证**。

夹具：真实 I/O（范围见下方）。

| 检查项 | 所列case范围 |
| --- | --- |
| 故障 / 前提 | 真实SQLite DELETE触发器拒绝 |
| 显式动作 | 排除DB触发器后显式重试同ID delete |
| 实际case身份 | `alembic-core-architecture-atlas/probes/persistence-recovery.test.ts` · Atlas persistence recovery deletion DB failure leaves a retryable identity |

- 只证明所列case，其他副作用、并发与宿主接线未验证。

断言定位：`alembic-core-architecture-atlas/probes/persistence-recovery.test.ts` · `deletion DB failure leaves a retryable identity`

```ts
expect(recovered).toEqual(
```

<details><summary>实际状态观察与检查字段</summary>

```json
[
  {
    "fixture": "real-markdown-sqlite",
    "entryId": "77777777-7777-4777-8777-777777777761",
    "before": {
      "rows": 1,
      "fileExists": true,
      "fileHash": "sha256:520a9bb13dde955b9bc705a05c85b1e77aa4746a1c3887dce54e88dd7be0cde8",
      "events": 0
    },
    "failed": {
      "rows": 1,
      "fileExists": false,
      "events": 0
    },
    "recovered": {
      "id": "77777777-7777-4777-8777-777777777761",
      "rows": 0,
      "fileExists": false,
      "events": 1,
      "sameId": true
    },
    "scenario": "V06",
    "caseId": "V06-D7",
    "observationId": "delete-state"
  }
]
```

- `delete-state.before.rows` = `{"observationId":"delete-state","field":"before.rows","equals":1}`
- `delete-state.failed.rows` = `{"observationId":"delete-state","field":"failed.rows","equals":1}`
- `delete-state.failed.fileExists` = `{"observationId":"delete-state","field":"failed.fileExists","equals":false}`
- `delete-state.failed.events` = `{"observationId":"delete-state","field":"failed.events","equals":0}`
- `delete-state.recovered.rows` = `{"observationId":"delete-state","field":"recovered.rows","equals":0}`
- `delete-state.recovered.sameId` = `{"observationId":"delete-state","field":"recovered.sameId","equals":true}`
- `delete-state.recovered.events` = `{"observationId":"delete-state","field":"recovered.events","equals":1}`
- `delete-state.recovered.id` = `{"observationId":"delete-state","field":"recovered.id","equalsField":"entryId"}`

</details>

模块：[M10-06](../maps/10-knowledge-authoring-persistence/README.md#m-M10-06)

失败：[K3-DELETE-DB](../maps/10-knowledge-authoring-persistence/README.md#f-K3-DELETE-DB)

返回具体步骤：[J05-02](../journeys/j05.md#J05-02) · [J05-04](../journeys/j05.md#J05-04)

<a id="case-V06-D8"></a>

### V06-D8 · 审计拒绝不阻断；同步事件报错发生在删除后，再delete得到NotFound。

执行核验：所列case与观察匹配。业务结论类型：**边界观察**。

夹具：真实存储与注入端口混合。

| 检查项 | 所列case范围 |
| --- | --- |
| 故障 / 前提 | 审计port拒绝及同步EventBus listener抛错 |
| 显式动作 | 重读已删除真相后用同ID再次调用以核对NotFound；不补回实体 |
| 实际case身份 | `alembic-core-architecture-atlas/probes/persistence-recovery.test.ts` · Atlas persistence recovery deletion listener failure does not restore committed truth |

- 边界观察成立不表示失败的审计或listener已恢复。
- 审计是拒绝端口夹具，文件与SQLite为真实实现。

断言定位：`alembic-core-architecture-atlas/probes/persistence-recovery.test.ts` · `deletion listener failure does not restore committed truth`

```ts
expect({ auditAttempts, listenerAttempts }).toEqual(
```

<details><summary>实际状态观察与检查字段</summary>

```json
[
  {
    "rows": 0,
    "fileExists": false,
    "auditAttempts": 1,
    "listenerAttempts": 1,
    "retryRejectedAsNotFound": true,
    "auditFailureWasNonBlocking": true,
    "scenario": "V06",
    "caseId": "V06-D8",
    "observationId": "delete-post"
  }
]
```

- `delete-post.rows` = `{"observationId":"delete-post","field":"rows","equals":0}`
- `delete-post.fileExists` = `{"observationId":"delete-post","field":"fileExists","equals":false}`
- `delete-post.auditAttempts` = `{"observationId":"delete-post","field":"auditAttempts","equals":1}`
- `delete-post.listenerAttempts` = `{"observationId":"delete-post","field":"listenerAttempts","equals":1}`
- `delete-post.retryRejectedAsNotFound` = `{"observationId":"delete-post","field":"retryRejectedAsNotFound","equals":true}`
- `delete-post.auditFailureWasNonBlocking` = `{"observationId":"delete-post","field":"auditFailureWasNonBlocking","equals":true}`

</details>

模块：[M10-06](../maps/10-knowledge-authoring-persistence/README.md#m-M10-06)

失败：[K3-DELETE-POST](../maps/10-knowledge-authoring-persistence/README.md#f-K3-DELETE-POST)

返回具体步骤：[J05-03](../journeys/j05.md#J05-03) · [J05-04](../journeys/j05.md#J05-04)

<a id="case-V06-D9"></a>

### V06-D9 · 删除目标后反向引用清理在显式sync之后仍保持。

执行核验：所列case与观察匹配。业务结论类型：**正常路径**。

夹具：真实 I/O（范围见下方）。

| 检查项 | 所列case范围 |
| --- | --- |
| 故障 / 前提 | 所选case内明确注入；正常路径无注入 |
| 显式动作 | 仅执行case中明确调用，不推断自动恢复 |
| 实际case身份 | `test/KnowledgeServicePersistence.test.ts` · KnowledgeService file-first commands keeps reverse-reference cleanup durable after deleting its target |

- 只证明所列case，其他副作用、并发与宿主接线未验证。

断言定位：`test/KnowledgeServicePersistence.test.ts` · `keeps reverse-reference cleanup durable after deleting its target`

```ts
expect(await related()).toEqual([]);
```

该case依据原始Vitest结果和上述断言定位；没有额外探针状态快照。

模块：[M10-06](../maps/10-knowledge-authoring-persistence/README.md#m-M10-06)

失败：本case未声明

返回具体步骤：[J05-02](../journeys/j05.md#J05-02)

<a id="V07"></a>

## V07 · syncAll：后置维护拒绝、真实store恢复与返回状态边界

状态：passed · 快照生成时已核对原始报告、case、实际观察与来源；浏览器不实时访问ledger

环境：{"node":"v24.19.0","platform":"darwin","arch":"arm64","vitest":"4.1.6"}

实际执行：2026-10-23T16:41:26.346Z；case数：4。

原始记录：`architecture-atlas/runs/2026-10-23/v07-2026-10-23T16-41-23-371Z/report.json`

- completed仅表示端口返回，nested report及store须另查。
- 没有外部embedding/API，空权威语料的删除恢复不证明生成向量质量。
- read skip是受控观察，不修改Core故障语义。

## 逐case业务结论与观察

<a id="case-V07-S1"></a>

### V07-S1 · 维护端口拒绝时DB已deprecated且region仍在；显式重试后真实HNSW新adapter重开无遗留向量。

执行核验：所列case与观察匹配。业务结论类型：**恢复验证**。

夹具：真实 I/O（范围见下方）。

| 检查项 | 所列case范围 |
| --- | --- |
| 故障 / 前提 | 真实store.remove对选定region暂时抛错；其他写入真实 |
| 显式动作 | fixture将Core reconcileIndex.errors转reject；恢复remove后调用者显式syncAll并flush、同进程新adapter重开 |
| 实际case身份 | `alembic-core-architecture-atlas/probes/persistence-recovery.test.ts` · Atlas persistence recovery sync maintenance rejection preserves DB changes and recovers the real vector store |

- 错误报告转reject是fixture端口策略，不是syncAll或当前外层宿主的隐式策略。
- 使用实际Markdown、SQLite、VectorService和HNSW；无embedding/API请求。
- 同进程新adapter重开，不证明断电、跨进程或外层多代际发布。

断言定位：`alembic-core-architecture-atlas/probes/persistence-recovery.test.ts` · `sync maintenance rejection preserves DB changes and recovers the real vector store`

```ts
expect(recovered.reopenedIds).toEqual([]);
```

<details><summary>实际状态观察与检查字段</summary>

```json
[
  {
    "fixture": "real-markdown-sqlite-hnsw",
    "entryId": "77777777-7777-4777-8777-777777777771",
    "adapterPolicy": "reconcileIndex errors become rejection in fixture only",
    "before": {
      "lifecycle": "active",
      "fileExists": true,
      "ids": [
        "entry_77777777-7777-4777-8777-777777777771",
        "recipe_region_77777777-7777-4777-8777-777777777771_identity_ps1_intent_c711d1e1589b5e5300c232e2"
      ]
    },
    "failed": {
      "lifecycle": "deprecated",
      "fileExists": false,
      "legacyPresent": false,
      "regionPresent": true,
      "report": {
        "orphansRemoved": 1,
        "recipeRegionOrphansRemoved": 0,
        "missingSynced": 0,
        "errors": [
          "recipe-region-orphan-remove-failed:recipe_region_77777777-7777-4777-8777-777777777771_identity_ps1_intent_c711d1e1589b5e5300c232e2:atlas region remove fault"
        ],
        "initialInspection": {
          "healthy": false,
          "expectedCount": 0,
          "presentCount": 1,
          "missingIds": [],
          "orphanIds": [
            "recipe_region_77777777-7777-4777-8777-777777777771_identity_ps1_intent_c711d1e1589b5e5300c232e2"
          ],
          "staleIds": [],
          "staleGenerationIds": [],
          "duplicateIds": [],
          "partialIds": [],
          "hashMismatchIds": [],
          "dimensionMismatchIds": []
        },
        "legacyEntryVectorsRemoved": 1,
        "degradedReason": "embed-provider-unavailable",
        "finalInspection": {
          "healthy": false,
          "expectedCount": 0,
          "presentCount": 1,
          "missingIds": [],
          "orphanIds": [
            "recipe_region_77777777-7777-4777-8777-777777777771_identity_ps1_intent_c711d1e1589b5e5300c232e2"
          ],
          "staleIds": [],
          "staleGenerationIds": [],
          "duplicateIds": [],
          "partialIds": [],
          "hashMismatchIds": [],
          "dimensionMismatchIds": []
        },
        "missingDeferred": 0
      },
      "syncReturnedReport": false
    },
    "recovered": {
      "lifecycle": "deprecated",
      "id": "77777777-7777-4777-8777-777777777771",
      "sameId": true,
      "maintenanceStatus": "completed",
      "report": {
        "orphansRemoved": 0,
        "recipeRegionOrphansRemoved": 1,
        "missingSynced": 0,
        "errors": [],
        "initialInspection": {
          "healthy": false,
          "expectedCount": 0,
          "presentCount": 1,
          "missingIds": [],
          "orphanIds": [
            "recipe_region_77777777-7777-4777-8777-777777777771_identity_ps1_intent_c711d1e1589b5e5300c232e2"
          ],
          "staleIds": [],
          "staleGenerationIds": [],
          "duplicateIds": [],
          "partialIds": [],
          "hashMismatchIds": [],
          "dimensionMismatchIds": []
        },
        "finalInspection": {
          "healthy": true,
          "expectedCount": 0,
          "presentCount": 0,
          "missingIds": [],
          "orphanIds": [],
          "staleIds": [],
          "staleGenerationIds": [],
          "duplicateIds": [],
          "partialIds": [],
          "hashMismatchIds": [],
          "dimensionMismatchIds": []
        }
      },
      "reopenedIds": [],
      "legacyPresent": false,
      "regionPresent": false
    },
    "scenario": "V07",
    "caseId": "V07-S1",
    "observationId": "sync-vector"
  }
]
```

- `sync-vector.failed.lifecycle` = `{"observationId":"sync-vector","field":"failed.lifecycle","equals":"deprecated"}`
- `sync-vector.failed.regionPresent` = `{"observationId":"sync-vector","field":"failed.regionPresent","equals":true}`
- `sync-vector.failed.syncReturnedReport` = `{"observationId":"sync-vector","field":"failed.syncReturnedReport","equals":false}`
- `sync-vector.recovered.sameId` = `{"observationId":"sync-vector","field":"recovered.sameId","equals":true}`
- `sync-vector.recovered.maintenanceStatus` = `{"observationId":"sync-vector","field":"recovered.maintenanceStatus","equals":"completed"}`
- `sync-vector.recovered.reopenedIds` = `{"observationId":"sync-vector","field":"recovered.reopenedIds","equals":[]}`
- `sync-vector.recovered.legacyPresent` = `{"observationId":"sync-vector","field":"recovered.legacyPresent","equals":false}`
- `sync-vector.recovered.regionPresent` = `{"observationId":"sync-vector","field":"recovered.regionPresent","equals":false}`
- `sync-vector.recovered.lifecycle` = `{"observationId":"sync-vector","field":"recovered.lifecycle","equals":"deprecated"}`
- `sync-vector.recovered.report.finalInspection.healthy` = `{"observationId":"sync-vector","field":"recovered.report.finalInspection.healthy","equals":true}`
- `sync-vector.recovered.report.errors` = `{"observationId":"sync-vector","field":"recovered.report.errors","equals":[]}`
- `sync-vector.recovered.id` = `{"observationId":"sync-vector","field":"recovered.id","equalsField":"entryId"}`

</details>

模块：[M10-04](../maps/10-knowledge-authoring-persistence/README.md#m-M10-04)

失败：[K3-SYNC-VECTOR](../maps/10-knowledge-authoring-persistence/README.md#f-K3-SYNC-VECTOR)

返回具体步骤：[J01-05](../journeys/j01.md#J01-05)

<a id="case-V07-S2"></a>

### V07-S2 · completed只说明端口resolve；嵌套业务报告仍可failed。

执行核验：所列case与观察匹配。业务结论类型：**边界观察**。

夹具：内存 / 注入端口合同。

| 检查项 | 所列case范围 |
| --- | --- |
| 故障 / 前提 | 端口resolve一份failed报告 |
| 显式动作 | 读取外层调用状态和嵌套业务报告 |
| 实际case身份 | `alembic-core-architecture-atlas/probes/persistence-recovery.test.ts` · Atlas persistence recovery sync completed can carry a failed maintenance business report |

- 仅证明Core端口返回合同；该case没有实际向量维护。

断言定位：`alembic-core-architecture-atlas/probes/persistence-recovery.test.ts` · `sync completed can carry a failed maintenance business report`

```ts
expect(report.vectorMaintenanceStatus).toBe('completed');
```

<details><summary>实际状态观察与检查字段</summary>

```json
[
  {
    "invocationStatus": "completed",
    "businessReport": {
      "status": "failed",
      "reason": "controlled-report"
    },
    "contractOnly": true,
    "scenario": "V07",
    "caseId": "V07-S2",
    "observationId": "sync-result"
  }
]
```

- `sync-result.invocationStatus` = `{"observationId":"sync-result","field":"invocationStatus","equals":"completed"}`
- `sync-result.businessReport.status` = `{"observationId":"sync-result","field":"businessReport.status","equals":"failed"}`
- `sync-result.contractOnly` = `{"observationId":"sync-result","field":"contractOnly","equals":true}`

</details>

模块：[M10-04](../maps/10-knowledge-authoring-persistence/README.md#m-M10-04)

失败：[K3-SYNC-RESULT](../maps/10-knowledge-authoring-persistence/README.md#f-K3-SYNC-RESULT)

返回具体步骤：[J01-05](../journeys/j01.md#J01-05)

<a id="case-V07-S3"></a>

### V07-S3 · 受控短暂读取失败可把仍存在的文件判作orphan；排故重扫恢复文件中的lifecycle。

执行核验：所列case与观察匹配。业务结论类型：**风险观察**。

夹具：真实 I/O（范围见下方）。

| 检查项 | 所列case范围 |
| --- | --- |
| 故障 / 前提 | 精确目标文件的一次readFileSync失败；另做实际无文件control |
| 显式动作 | dryRun→受控正式写→解除读故障后同根sync→实际缺文件对照 |
| 实际case身份 | `alembic-core-architecture-atlas/probes/persistence-recovery.test.ts` · Atlas persistence recovery sync read failure and real file absence produce distinguishable orphan observations |

- 这是本轮受控行为观察，不意味着自动恢复可靠，也未修复产品。
- orphaned报告不独立证明文件被删除；此case未配置向量维护。

断言定位：`alembic-core-architecture-atlas/probes/persistence-recovery.test.ts` · `sync read failure and real file absence produce distinguishable orphan observations`

```ts
expect(recovered).toMatchObject(
```

<details><summary>实际状态观察与检查字段</summary>

```json
[
  {
    "entryId": "77777777-7777-4777-8777-777777777773",
    "dryRun": {
      "skipped": 1,
      "orphaned": [
        "77777777-7777-4777-8777-777777777773"
      ],
      "maintenanceStatus": "skipped-dry-run"
    },
    "failed": {
      "skipped": 1,
      "orphaned": [
        "77777777-7777-4777-8777-777777777773"
      ],
      "lifecycle": "deprecated",
      "fileExists": true,
      "fileHash": "sha256:67e28143288ff2947d3b0f5b84e8bbfff9ec0f5806f453796f8d7d6b2f2ec2e2"
    },
    "recovered": {
      "skipped": 0,
      "orphaned": [],
      "lifecycle": "active",
      "fileHash": "sha256:67e28143288ff2947d3b0f5b84e8bbfff9ec0f5806f453796f8d7d6b2f2ec2e2"
    },
    "absentControl": {
      "fileExists": false,
      "orphaned": [
        "77777777-7777-4777-8777-777777777773"
      ]
    },
    "sameFileHash": true,
    "scenario": "V07",
    "caseId": "V07-S3",
    "observationId": "sync-read-skip"
  }
]
```

- `sync-read-skip.dryRun.maintenanceStatus` = `{"observationId":"sync-read-skip","field":"dryRun.maintenanceStatus","equals":"skipped-dry-run"}`
- `sync-read-skip.failed.skipped` = `{"observationId":"sync-read-skip","field":"failed.skipped","equals":1}`
- `sync-read-skip.failed.lifecycle` = `{"observationId":"sync-read-skip","field":"failed.lifecycle","equals":"deprecated"}`
- `sync-read-skip.failed.fileExists` = `{"observationId":"sync-read-skip","field":"failed.fileExists","equals":true}`
- `sync-read-skip.recovered.skipped` = `{"observationId":"sync-read-skip","field":"recovered.skipped","equals":0}`
- `sync-read-skip.recovered.lifecycle` = `{"observationId":"sync-read-skip","field":"recovered.lifecycle","equals":"active"}`
- `sync-read-skip.absentControl.fileExists` = `{"observationId":"sync-read-skip","field":"absentControl.fileExists","equals":false}`
- `sync-read-skip.sameFileHash` = `{"observationId":"sync-read-skip","field":"sameFileHash","equals":true}`
- `sync-read-skip.recovered.fileHash` = `{"observationId":"sync-read-skip","field":"recovered.fileHash","equalsField":"failed.fileHash","format":"sha256"}`
- `sync-read-skip.failed.orphaned.0` = `{"observationId":"sync-read-skip","field":"failed.orphaned.0","equalsField":"entryId"}`

</details>

模块：[M10-04](../maps/10-knowledge-authoring-persistence/README.md#m-M10-04)

失败：[K3-SYNC-SKIP](../maps/10-knowledge-authoring-persistence/README.md#f-K3-SYNC-SKIP)

返回具体步骤：[J01-05](../journeys/j01.md#J01-05)

<a id="case-V07-S4"></a>

### V07-S4 · 空文件语料仍做孤儿检查；syncAll等待维护Promise后返回。

执行核验：所列case与观察匹配。业务结论类型：**正常路径**。

夹具：真实存储与注入端口混合。

| 检查项 | 所列case范围 |
| --- | --- |
| 故障 / 前提 | 所选case内明确注入；正常路径无注入 |
| 显式动作 | 仅执行case中明确调用，不推断自动恢复 |
| 实际case身份 | `test/KnowledgeProductizationLifecycle.test.ts` · Knowledge productization lifecycle deprecates an orphan for an empty corpus and awaits authoritative vector maintenance |

- Markdown/SQLite真实，维护是受控Promise；不证明store恢复。

断言定位：`test/KnowledgeProductizationLifecycle.test.ts` · `deprecates an orphan for an empty corpus and awaits authoritative vector maintenance`

```ts
expect(settled).toBe(false);
```

该case依据原始Vitest结果和上述断言定位；没有额外探针状态快照。

模块：[M10-04](../maps/10-knowledge-authoring-persistence/README.md#m-M10-04)

失败：本case未声明

返回具体步骤：[J01-05](../journeys/j01.md#J01-05)

<a id="V08"></a>

## V08 · Strict prepared：同身份端口重放与写前拒绝

状态：passed · 快照生成时已核对原始报告、case、实际观察与来源；浏览器不实时访问ledger

环境：{"node":"v24.19.0","platform":"darwin","arch":"arm64","vitest":"4.1.6"}

实际执行：2026-10-23T16:41:28.384Z；case数：7。

原始记录：`architecture-atlas/runs/2026-10-23/v08-2026-10-23T16-41-26-347Z/report.json`

- crash是create夹具设置stored后抛错，非真实DB/文件/journal/进程中断。
- dbHash/fileHash是预期值；不因返回recovered推断现场完整hash匹配。
- 不执行Agent、Main持久化、journal consumed或公开发布。

## 逐case业务结论与观察

<a id="case-V08-P1"></a>

### V08-P1 · 有效输入在端口合同内固定prepared ID并读回created，UUID新增为0。

执行核验：所列case与观察匹配。业务结论类型：**正常路径**。

夹具：内存 / 注入端口合同。

| 检查项 | 所列case范围 |
| --- | --- |
| 故障 / 前提 | 所选case内明确注入；正常路径无注入 |
| 显式动作 | 仅执行case中明确调用，不推断自动恢复 |
| 实际case身份 | `test/StrictPreparedRecipeGateway.test.ts` · strict prepared Recipe Gateway path authorizes the internal prepared ID, reads it back, and reports zero UUID allocation |

- 内存stored与vi.fn端口；无真实文件/SQLite/journal或进程崩溃。
- inspection的db/file hash为预设值；不证明现场字节完整性。

断言定位：`test/StrictPreparedRecipeGateway.test.ts` · `authorizes the internal prepared ID, reads it back, and reports zero UUID allocation`

```ts
expect(result.status).toBe('created');
```

该case依据原始Vitest结果和上述断言定位；没有额外探针状态快照。

模块：[M15-15](../maps/15-strict-production-authority/README.md#m-M15-15)

失败：本case未声明

返回具体步骤：[J04-S05](../journeys/j04.md#J04-S05)

<a id="case-V08-P2"></a>

### V08-P2 · 精确已有inspection返回recovered，本次不调用create。

执行核验：所列case与观察匹配。业务结论类型：**恢复验证**。

夹具：内存 / 注入端口合同。

| 检查项 | 所列case范围 |
| --- | --- |
| 故障 / 前提 | 所选case内明确注入；正常路径无注入 |
| 显式动作 | 仅执行case中明确调用，不推断自动恢复 |
| 实际case身份 | `test/StrictPreparedRecipeGateway.test.ts` · strict prepared Recipe Gateway path recovers an exact persist-before-consumed row without creating a duplicate |

- 内存stored与vi.fn端口；无真实文件/SQLite/journal或进程崩溃。
- inspection的db/file hash为预设值；不证明现场字节完整性。

断言定位：`test/StrictPreparedRecipeGateway.test.ts` · `recovers an exact persist-before-consumed row without creating a duplicate`

```ts
expect(create).not.toHaveBeenCalled();
```

该case依据原始Vitest结果和上述断言定位；没有额外探针状态快照。

模块：[M15-15](../maps/15-strict-production-authority/README.md#m-M15-15)

失败：[stf-prepared-after-write](../maps/15-strict-production-authority/README.md#f-stf-prepared-after-write)

返回具体步骤：[J04-S05](../journeys/j04.md#J04-S05)

<a id="case-V08-P3"></a>

### V08-P3 · create夹具先保存内存inspection再抛错；同身份重调recovered，总create仅一次。

执行核验：所列case与观察匹配。业务结论类型：**恢复验证**。

夹具：内存 / 注入端口合同。

| 检查项 | 所列case范围 |
| --- | --- |
| 故障 / 前提 | create设置内存stored后抛错 |
| 显式动作 | 同item/prepared/context显式重调 |
| 实际case身份 | `test/StrictPreparedRecipeGateway.test.ts` · strict prepared Recipe Gateway path replays a persist-before-journal-consumed crash without a second Recipe |

- 内存stored与vi.fn端口；无真实文件/SQLite/journal或进程崩溃。
- inspection的db/file hash为预设值；不证明现场字节完整性。

断言定位：`test/StrictPreparedRecipeGateway.test.ts` · `replays a persist-before-journal-consumed crash without a second Recipe`

```ts
expect(create).toHaveBeenCalledTimes(1);
```

该case依据原始Vitest结果和上述断言定位；没有额外探针状态快照。

模块：[M15-15](../maps/15-strict-production-authority/README.md#m-M15-15)

失败：[stf-prepared-after-write](../maps/15-strict-production-authority/README.md#f-stf-prepared-after-write)

返回具体步骤：[J04-S05](../journeys/j04.md#J04-S05)

<a id="case-V08-P4"></a>

### V08-P4 · 授权false或旧revision inspection均拒绝。

执行核验：所列case与观察匹配。业务结论类型：**拒绝验证**。

夹具：内存 / 注入端口合同。

| 检查项 | 所列case范围 |
| --- | --- |
| 故障 / 前提 | 授权返回false；另一个gateway返回旧revision |
| 显式动作 | 仅执行case中明确调用，不推断自动恢复 |
| 实际case身份 | `test/StrictPreparedRecipeGateway.test.ts` · strict prepared Recipe Gateway path fails closed for unauthorized or mismatched revision readback |

- 内存stored与vi.fn端口；无真实文件/SQLite/journal或进程崩溃。
- inspection的db/file hash为预设值；不证明现场字节完整性。
- 此case包含授权拒绝与revision冲突两段；冲突的精确断言另见对应failure条目。

断言定位：`test/StrictPreparedRecipeGateway.test.ts` · `fails closed for unauthorized or mismatched revision readback`

```ts
.rejects.toThrow('STRICT_PREPARED_PERSISTENCE_UNAUTHORIZED');
```

该case依据原始Vitest结果和上述断言定位；没有额外探针状态快照。

模块：[M15-15](../maps/15-strict-production-authority/README.md#m-M15-15)

失败：[stf-prepared-authorization](../maps/15-strict-production-authority/README.md#f-stf-prepared-authorization) · [stf-prepared-inspection-conflict](../maps/15-strict-production-authority/README.md#f-stf-prepared-inspection-conflict)

返回具体步骤：[J04-S05](../journeys/j04.md#J04-S05)

<a id="case-V08-P5"></a>

### V08-P5 · 评审后的payload变化在授权/inspection/create之前拒绝。

执行核验：所列case与观察匹配。业务结论类型：**拒绝验证**。

夹具：内存 / 注入端口合同。

| 检查项 | 所列case范围 |
| --- | --- |
| 故障 / 前提 | 修改被评审payload的多个字段 |
| 显式动作 | 仅执行case中明确调用，不推断自动恢复 |
| 实际case身份 | `test/StrictPreparedRecipeGateway.test.ts` · strict prepared Recipe Gateway path rejects an item changed after G1 review before journal authorization or write |

- 内存stored与vi.fn端口；无真实文件/SQLite/journal或进程崩溃。
- inspection的db/file hash为预设值；不证明现场字节完整性。

断言定位：`test/StrictPreparedRecipeGateway.test.ts` · `rejects an item changed after G1 review before journal authorization or write`

```ts
expect(inspectPreparedRecipe).not.toHaveBeenCalled();
```

该case依据原始Vitest结果和上述断言定位；没有额外探针状态快照。

模块：[M15-15](../maps/15-strict-production-authority/README.md#m-M15-15)

失败：[stf-prepared-item-mismatch](../maps/15-strict-production-authority/README.md#f-stf-prepared-item-mismatch)

返回具体步骤：[J04-S05](../journeys/j04.md#J04-S05)

<a id="case-V08-P6"></a>

### V08-P6 · G1→Admission→G2身份错配在端口访问之前拒绝。

执行核验：所列case与观察匹配。业务结论类型：**拒绝验证**。

夹具：内存 / 注入端口合同。

| 检查项 | 所列case范围 |
| --- | --- |
| 故障 / 前提 | Admission finalAdmittedFingerprint篡改 |
| 显式动作 | 仅执行case中明确调用，不推断自动恢复 |
| 实际case身份 | `test/StrictPreparedRecipeGateway.test.ts` · strict prepared Recipe Gateway path rejects a mismatched G1 → Admission → G2 chain before recovery inspection or write |

- 内存stored与vi.fn端口；无真实文件/SQLite/journal或进程崩溃。
- inspection的db/file hash为预设值；不证明现场字节完整性。

断言定位：`test/StrictPreparedRecipeGateway.test.ts` · `rejects a mismatched G1 → Admission → G2 chain before recovery inspection or write`

```ts
expect(authorizePreparedRecipe).not.toHaveBeenCalled();
```

该case依据原始Vitest结果和上述断言定位；没有额外探针状态快照。

模块：[M15-15](../maps/15-strict-production-authority/README.md#m-M15-15)

失败：[stf-prepared-authority-mismatch](../maps/15-strict-production-authority/README.md#f-stf-prepared-authority-mismatch)

返回具体步骤：[J04-S05](../journeys/j04.md#J04-S05)

<a id="case-V08-P7"></a>

### V08-P7 · ID只绑定规定身份；cell/parents变化可保留ID但preparedHash改变。

执行核验：所列case与观察匹配。业务结论类型：**正常路径**。

夹具：内存 / 注入端口合同。

| 检查项 | 所列case范围 |
| --- | --- |
| 故障 / 前提 | 所选case内明确注入；正常路径无注入 |
| 显式动作 | 仅执行case中明确调用，不推断自动恢复 |
| 实际case身份 | `test/ProductionPersistenceContracts.test.ts` · production persistence contracts derives a deterministic prepared Recipe ID from journal-bound identity |

- 纯内存合同，不涉及真实journal或存储。
- 仅比较ID不能代替preparedHash和完整授权链检查。

断言定位：`test/ProductionPersistenceContracts.test.ts` · `derives a deterministic prepared Recipe ID from journal-bound identity`

```ts
expect(relocated.preparedHash).not.toBe(left.preparedHash);
```

该case依据原始Vitest结果和上述断言定位；没有额外探针状态快照。

模块：[M15-15](../maps/15-strict-production-authority/README.md#m-M15-15)

失败：本case未声明

返回具体步骤：[J04-S05](../journeys/j04.md#J04-S05)

<a id="V09"></a>

## V09 · WAL checkpoint：真实reader阻挡、显式释放与同context重试

状态：passed · 快照生成时已核对原始报告、case、实际观察与来源；浏览器不实时访问ledger

环境：{"node":"v24.19.0","platform":"darwin","arch":"arm64","vitest":"4.1.6"}

实际执行：2026-10-23T16:41:31.561Z；case数：3。

原始记录：`architecture-atlas/runs/2026-10-23/v09-2026-10-23T16-41-28-384Z/report.json`

- 已提交数据可仍在WAL；拒绝receipt不等于回滚事务。
- FULL可能部分推进；当前样本不提供断电或全系统并发封存保证。
- validator只核对身份/回执，磁盘hash由probe独立读回。

## 逐case业务结论与观察

<a id="case-V09-W1"></a>

### V09-W1 · 旧读事务阻挡主文件追赶，释放reader后checkpoint回执hash匹配当次主文件。

执行核验：所列case与观察匹配。业务结论类型：**恢复验证**。

夹具：真实 I/O（范围见下方）。

| 检查项 | 所列case范围 |
| --- | --- |
| 故障 / 前提 | 真实SQLite旧读事务 |
| 显式动作 | 持有reader的调用方ROLLBACK，再次checkpoint |
| 实际case身份 | `test/ProductionPersistenceContracts.test.ts` · production persistence contracts refuses a checkpoint receipt while a reader prevents committed WAL pages from reaching the database file |

- 真实双连接，单进程，无其他新writer；不证明进程崩溃或停写封存。

断言定位：`test/ProductionPersistenceContracts.test.ts` · `refuses a checkpoint receipt while a reader prevents committed WAL pages from reaching the database file`

```ts
expect(receipt.databaseHash).toBe(hashBytes(fs.readFileSync(handle.resolver.databasePath)));
```

该case依据原始Vitest结果和上述断言定位；没有额外探针状态快照。

模块：[M15-17](../maps/15-strict-production-authority/README.md#m-M15-17)

失败：[stf-wal-not-sealed](../maps/15-strict-production-authority/README.md#f-stf-wal-not-sealed)

返回具体步骤：[J04-S08](../journeys/j04.md#J04-S08)

<a id="case-V09-W2"></a>

### V09-W2 · 错配runtime/revision/context不能混用handle或checkpoint；同handle注册的新连接不等于错配。

执行核验：所列case与观察匹配。业务结论类型：**拒绝验证**。

夹具：真实 I/O（范围见下方）。

| 检查项 | 所列case范围 |
| --- | --- |
| 故障 / 前提 | 旧handle配新runtime；旧回执配新context |
| 显式动作 | 仅执行case中明确调用，不推断自动恢复 |
| 实际case身份 | `test/ProductionPersistenceContracts.test.ts` · production persistence contracts rejects an old revision receipt and checkpoint under a new current context |

- validator重验身份和回执自洽，不重新读取当前磁盘。

断言定位：`test/ProductionPersistenceContracts.test.ts` · `rejects an old revision receipt and checkpoint under a new current context`

```ts
.toThrow('PRIVATE_CORPUS_REVISION_RUNTIME_MISMATCH');
```

该case依据原始Vitest结果和上述断言定位；没有额外探针状态快照。

模块：[M15-17](../maps/15-strict-production-authority/README.md#m-M15-17)

失败：[stf-checkpoint-context](../maps/15-strict-production-authority/README.md#f-stf-checkpoint-context)

返回具体步骤：[J04-S08](../journeys/j04.md#J04-S08)

<a id="case-V09-W3"></a>

### V09-W3 · writer已提交2行而旧reader只见1行；释放后同context重试，回执hash等于真实主文件。

执行核验：所列case与观察匹配。业务结论类型：**恢复验证**。

夹具：真实 I/O（范围见下方）。

| 检查项 | 所列case范围 |
| --- | --- |
| 故障 / 前提 | 真实reader固定旧快照；fixture busy_timeout=1ms |
| 显式动作 | reader owner显式ROLLBACK后重试Core FULL checkpoint |
| 实际case身份 | `alembic-core-architecture-atlas/probes/persistence-recovery.test.ts` · Atlas persistence recovery WAL reader blocking ends only after explicit release and checkpoint retry |

- FULL失败也可能部分推进，不承诺失败时主文件完全不变。
- checkpointAfterRetry是另一次PASSIVE观察，不是Core内部FULL原始返回。
- 没有调用宿主公开route或Serving发布。

断言定位：`alembic-core-architecture-atlas/probes/persistence-recovery.test.ts` · `WAL reader blocking ends only after explicit release and checkpoint retry`

```ts
expect(recovered.databaseHash).toBe(recovered.actualDatabaseHash);
```

<details><summary>实际状态观察与检查字段</summary>

```json
[
  {
    "fixture": "real-sqlite-two-connections",
    "expected": {
      "runId": "atlas-wal-run",
      "revisionId": "atlas-wal-revision",
      "analysisFixpointHash": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      "configReceiptHash": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "runtimeReceiptHash": "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
    },
    "before": {
      "writerRows": 1,
      "databaseHash": "sha256:06756a5b34b7e7f7107b363e3325da85c2ef684960e4a93737e486f90e77c038"
    },
    "staleHash": "sha256:06756a5b34b7e7f7107b363e3325da85c2ef684960e4a93737e486f90e77c038",
    "blocked": {
      "writerRows": 2,
      "readerRows": 1,
      "readerInTransaction": true,
      "receiptIssued": false,
      "passiveCheckpoint": {
        "busy": 0,
        "log": 1,
        "checkpointed": 0
      },
      "databaseHash": "sha256:06756a5b34b7e7f7107b363e3325da85c2ef684960e4a93737e486f90e77c038"
    },
    "recovered": {
      "writerRows": 2,
      "readerRows": 2,
      "readerInTransaction": false,
      "databaseHash": "sha256:59ef5d93e1ed6811fa094095db74b1e8e36b06e6ead063a67411d99985eff3ce",
      "actualDatabaseHash": "sha256:59ef5d93e1ed6811fa094095db74b1e8e36b06e6ead063a67411d99985eff3ce",
      "checkpointHash": "sha256:2e4d95d71f56d3dfe4afeff78fb1eff677e17d1cfa00f5dfc5e8a44d6b00cf59",
      "initReceiptHash": "sha256:8850b26c178ce8e87b7d8e21313a0ce982f960f55e203e1355cc68db52b9e9a9",
      "validationPassed": true,
      "checkpointAfterRetry": {
        "busy": 0,
        "log": 1,
        "checkpointed": 1
      }
    },
    "hashMatchesDisk": true,
    "sourceMainFileChanged": true,
    "scenario": "V09",
    "caseId": "V09-W3",
    "observationId": "checkpoint-state"
  }
]
```

- `checkpoint-state.blocked.writerRows` = `{"observationId":"checkpoint-state","field":"blocked.writerRows","equals":2}`
- `checkpoint-state.blocked.readerRows` = `{"observationId":"checkpoint-state","field":"blocked.readerRows","equals":1}`
- `checkpoint-state.blocked.readerInTransaction` = `{"observationId":"checkpoint-state","field":"blocked.readerInTransaction","equals":true}`
- `checkpoint-state.blocked.receiptIssued` = `{"observationId":"checkpoint-state","field":"blocked.receiptIssued","equals":false}`
- `checkpoint-state.recovered.writerRows` = `{"observationId":"checkpoint-state","field":"recovered.writerRows","equals":2}`
- `checkpoint-state.recovered.readerRows` = `{"observationId":"checkpoint-state","field":"recovered.readerRows","equals":2}`
- `checkpoint-state.recovered.readerInTransaction` = `{"observationId":"checkpoint-state","field":"recovered.readerInTransaction","equals":false}`
- `checkpoint-state.recovered.validationPassed` = `{"observationId":"checkpoint-state","field":"recovered.validationPassed","equals":true}`
- `checkpoint-state.hashMatchesDisk` = `{"observationId":"checkpoint-state","field":"hashMatchesDisk","equals":true}`
- `checkpoint-state.sourceMainFileChanged` = `{"observationId":"checkpoint-state","field":"sourceMainFileChanged","equals":true}`
- `checkpoint-state.recovered.databaseHash` = `{"observationId":"checkpoint-state","field":"recovered.databaseHash","equalsField":"recovered.actualDatabaseHash","format":"sha256"}`
- `checkpoint-state.recovered.databaseHash` = `{"observationId":"checkpoint-state","field":"recovered.databaseHash","notEqualsField":"staleHash","format":"sha256"}`
- `checkpoint-state.blocked.passiveCheckpoint.log` = `{"observationId":"checkpoint-state","field":"blocked.passiveCheckpoint.log","greaterThanField":"blocked.passiveCheckpoint.checkpointed"}`
- `checkpoint-state.recovered.checkpointAfterRetry.log` = `{"observationId":"checkpoint-state","field":"recovered.checkpointAfterRetry.log","equalsField":"recovered.checkpointAfterRetry.checkpointed"}`

</details>

模块：[M15-17](../maps/15-strict-production-authority/README.md#m-M15-17)

失败：[stf-wal-not-sealed](../maps/15-strict-production-authority/README.md#f-stf-wal-not-sealed)

返回具体步骤：[J04-S08](../journeys/j04.md#J04-S08)
