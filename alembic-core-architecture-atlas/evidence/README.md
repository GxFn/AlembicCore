# 独立运行证据

由明确执行命令产生回执，再由inventory:write派生。通过只对所列样本及来源身份成立。

<a id="V01"></a>

## V01 · 知识文件先行：DB分歧、阻断与显式同步

状态：passed · 快照生成时已核对原始报告、case、实际观察与来源；浏览器不实时访问ledger

环境：{"node":"v24.19.0","platform":"darwin","arch":"arm64","vitest":"4.1.6"}

实际执行：2026-10-23T13:41:21.658Z；case数：22。

原始记录：`architecture-atlas/runs/2026-10-23/v01-2026-10-23T13-41-16-867Z/report.json`

- create/update/quality/deprecate共用一套真实文件/DB夹具；不覆盖delete语义。
- sync helper实际调用KnowledgeSyncService.syncAll(runtime.sqlite)，异常中的reconcileVia字符串仍是KnowledgeSyncService.sync；图谱应区分提示与实际恢复命令。
- 不证明关系、审计、事件监听器、vector全链原子性，也不证明真实宿主接通。
- 本回执按完整Core产品库存绑定来源；主要实现路径用于阅读导航，不代表完整传递调用闭包。

<a id="V02"></a>

## V02 · 源码索引：内容身份、代际取消与显式追赶

状态：passed · 快照生成时已核对原始报告、case、实际观察与来源；浏览器不实时访问ledger

环境：{"node":"v24.19.0","platform":"darwin","arch":"arm64","vitest":"4.1.6"}

实际执行：2026-10-23T13:41:26.237Z；case数：6。

原始记录：`architecture-atlas/runs/2026-10-23/v02-2026-10-23T13-41-21-660Z/report.json`

- 这些case不证明外部CodeGraph补边完整，也未修复R06的callSitesComplete传播问题。
- partial case中parser-timeout由maxParseBytes预算产生，不是实际CPU挂起或系统超时实验。
- SourceGraph scope/数据库均是临时fixture，没有真实项目索引变化。
- 本回执按完整Core产品库存绑定来源；主要实现路径用于阅读导航，不代表完整传递调用闭包。

<a id="V03"></a>

## V03 · 认证工件与租约：中断后同身份重放

状态：passed · 快照生成时已核对原始报告、case、实际观察与来源；浏览器不实时访问ledger

环境：{"node":"v24.19.0","platform":"darwin","arch":"arm64","vitest":"4.1.6"}

实际执行：2026-10-23T13:41:30.905Z；case数：4。

原始记录：`architecture-atlas/runs/2026-10-23/v03-2026-10-23T13-41-26-238Z/report.json`

- 通过步骤hook模拟中断，不是杀进程、断电或磁盘硬件故障实验。
- 实测同进程新store实例，不是独立操作系统进程恢复；不得用fresh process描述V03。
- 没有并发读者逐瞬间读取JSON的探针；标题without exposing partial JSON只对应原子步骤设计和可读重放结果，不能扩展成全时序证明。
- 不自动接管其他run，不自动重新执行consumer adapter。
- 本回执按完整Core产品库存绑定来源；主要实现路径用于阅读导航，不代表完整传递调用闭包。

<a id="V04"></a>

## V04 · 向量WAL：快照写失败后显式flush与重开

状态：passed · 快照生成时已核对原始报告、case、实际观察与来源；浏览器不实时访问ledger

环境：{"node":"v24.19.0","platform":"darwin","arch":"arm64","vitest":"4.1.6"}

实际执行：2026-10-23T13:41:31.829Z；case数：3。

原始记录：`architecture-atlas/runs/2026-10-23/v04-2026-10-23T13-41-30-906Z/report.json`

- destroy会同步保存；第三case明确恢复旧快照构造输入，不能称destroy等价进程崩溃。
- 前两case不是独立进程重启；是新adapter实例重开。
- 不证明断电fsync整体保证，也不证明坏CRC对应丢失数据可修复。
- 不调用embedding provider，也不覆盖知识live-truth/filter/publication全链。
- 本回执按完整Core产品库存绑定来源；主要实现路径用于阅读导航，不代表完整传递调用闭包。

<a id="V05"></a>

## V05 · 严格语义评审离线回执：V4/V5序列化、新进程重验与篡改拒绝

状态：passed · 快照生成时已核对原始报告、case、实际观察与来源；浏览器不实时访问ledger

环境：{"node":"v24.19.0","platform":"darwin","arch":"arm64","vitest":"4.1.6"}

实际执行：2026-10-23T13:41:39.356Z；case数：4。

原始记录：`architecture-atlas/runs/2026-10-23/v05-2026-10-23T13-41-31-829Z/report.json`

- CLI只能运行SharedHarvestSemanticEvidenceAuthority主文件；DurableSemanticDispositionFreshProcess是嵌套support，单独无env运行会skip，不能算独立通过。
- 外层Vitest JSON expected4 cases，不应把两个子进程case误计为外层6；父case的stdout断言提供nested通过依据。
- Gateway名称包含Agent但本样本全在Core；没有修改或启动AlembicAgent。
- 断言是签名、receipt binding、request结构与验证合同；reviewer内容由fixture给定，不证明真实模型评审质量。
- 未覆盖Main持久化/实际发布，未修复R01，也未针对当前消费端expectedSemanticRequest换请求做独立负例；不要关联stf-current-request-mismatch为已实测。
- 本回执按完整Core产品库存绑定来源；主要实现路径用于阅读导航，不代表完整传递调用闭包。
- 子进程通过由外层case断言其输出含1 passed证明；本回执只保存外层原始报告，不声称保存了子进程独立stdout。
