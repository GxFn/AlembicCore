# 向量接口与内部职责

公共接入继续使用 `@alembic/core/vector`。内部实现按协议适配、索引编排、
可用性决策和排名计算拆分；这些文件不增加 package exports。

| 文件 | 输入与输出 | 责任 |
| --- | --- | --- |
| `infrastructure/vector/EmbeddingPort.ts` | query/document 文本 → 向量 | 用途契约、旧 `embed` 协议转换、串行兼容与调用前后取消检查 |
| `service/vector/EmbeddingPort.ts` | 原有导入 → 同一类型与类 | 保持既有导出路径，转发 infrastructure 中的实现 |
| `infrastructure/vector/BatchEmbedder.ts` | 带 ID 文档 → ID/vector Map | 文本截断、批次/并发、结果对应及批次失败后的部分成功处理 |
| `infrastructure/vector/IndexingPipeline.ts` | 文件/索引请求 → 索引结果 | 扫描、chunk/enrichment、批处理和索引写入编排 |
| `service/vector/VectorAvailability.ts` | 原始 provider → 可用性 DTO | 唯一的 provider 探测决策，不缓存、不生成 embedding |
| `service/vector/VectorService.ts` | 应用请求 → 搜索/维护/诊断 | 公开可用性、索引服务编排及生成版本接入 |
| `service/vector/SyncCoordinator.ts` | 知识事件/对账请求 → 串行索引变更 | 去抖队列、最后事件覆盖、失败回队、排空与对账 |
| `shared/WeightedRrfAccumulator.ts` | 原始名次与通道 → 有序累积证据 | 两处旧入口共用的加权 RRF 数学与稳定排序 |
| `HybridRetriever.ts` / `HnswVectorAdapter.ts` | 各自召回结果 → 原有 DTO | ID 提取、参数默认值、payload 选择与输出字段 |

## Embedding 协议与批次边界

`LegacyEmbedProviderAdapter` 是旧 `embed(string|string[])` 的唯一协议适配实现。
它保留 query/document 用途，先尝试支持的批量请求，批量拒绝或返回不适用的
扁平结果时回退串行。诊断包含 provider、数量和固定失败原因；provider 的任意
异常文本可能包含文档，不能原样复制进新增回退日志。

适配器串行执行每个请求时，在 await 前后检查 `AbortSignal`。最后一个请求结束前
发生的取消也会拒绝成功结果，保留原始取消 reason。旧 provider 不接收 signal，
这只提供协作式取消，不会终止正在运行的底层网络请求。

BatchEmbedder 调用文档用途。它保留历史上只有 `embedQuery`/`embedDocuments`
而没有 capability descriptor 的双方法接入，不能因内部统一而改用更严格的类型
守卫拒绝这条路径。transport capacity hint 在构造时读取一次。

协议转换与批次恢复有不同粒度：适配器保证一次用途调用的返回约定，批处理层负责
ID 对应和部分成功结果。删除批处理层的恢复会丢失现有可用结果。
外层仍负责 provider runtime、凭据和网络传输。

## 可用性与生命周期

探测始终使用原始 provider，保留方法的 `this`；适配后的 port 不能替代它。

| provider 情况 | available | status | probeStatus |
| --- | --- | --- | --- |
| 缺失 | false | unavailable | not-applicable |
| 已配置但无探测方法 | true | available | not-supported |
| 探测通过 | true | available | available |
| 探测未通过 | false | degraded | unavailable |
| 探测抛错 | false | degraded | error |

VectorService 返回完整 DTO；SyncCoordinator 消费 available，并在探测错误时保留
原诊断。每次调用都读取当前状态，不缓存也不额外发起 embedding。
`getStats().embedProviderAvailable` 仍表示已配置，不能拿它替代 readiness。

队列以 entry ID 去重并保留最后到达的事件；排序不依赖已移除的私有 timestamp。
contextual enrichment 由 IndexingPipeline 执行，coordinator 的兼容配置仍接受该项。
宿主先排空 VectorService，再关闭其持有的 store；服务不取得共享 store 的关闭权。
启动与定时维护的对账时机仍由宿主明确决定。

## 排名内核与响应边界

两个旧入口共享 `weight * (1 / (k + originalIndex + 1))` 的累积。
重复 ID 的 total 包含每次出现，单通道 rank/score/contribution 保留最后一次证据；
同分排序保留 Map 首次插入次序。原始通道分数只作为证据保留。

调用方继续承担不同契约：HybridRetriever 跳过无效 ID 但保留其名次占位，缺失通道
rank 为 Infinity；HNSW 保留自己的 ID 规则，缺失通道字段是 own undefined。
两者的 payload、k/alpha 默认规则与结果形状各自保留。累加器的首次总分初始化
显式保留 HNSW sparse 直接取贡献的算术语义，避免改变旧入口允许的 signed zero。

canonical KnowledgeRetrieval 的 Recipe truth、region、预算和补窗，以及 JSON adapter
的线性融合，均有独立业务语义，不能因为都处理搜索结果而套用这个内部累加器。

## 测试责任

- `EmbeddingPort.test.ts`：用途、旧协议兼容、最后一次 await 的取消与回退诊断。
- `HnswVector.test.ts`：HNSW 图、量化、真实 store 查询和 HNSW RRF 输出契约。
- `VectorPersistence.test.ts`：二进制快照、迁移、WAL 保留/恢复与并发落盘。
- `VectorPipeline.test.ts`：chunk/embedding/文件扫描到真实索引的增量写入与清理。
- `SearchRanking.test.ts`：通用 HybridRetriever 的排名、默认值和 payload 契约。
- `VectorAvailability.test.ts`：五态、方法接收者、探测次数及配置统计的不同语义。
- `SyncCoordinator.test.ts` / `VectorService.test.ts`：队列、失败恢复、维护与服务编排。
- package、分层及四个 Core 边界测试继续负责宿主与公共接口边界。

Core 持有上述算法和恢复行为的完整覆盖；宿主通过真实 package 导入验证
pipeline→持久化/重开→混检链路，另保留 DI、provider 选择、维护等待和关闭顺序测试。
宿主无需复制同一组算法断言；删除副本前须核对每项独有行为的归属。

## 设计参考

[Elastic RRF 文档](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion)
说明按名次融合不同检索器结果。本实现沿用既有加权公式与 DTO，不引入其服务端参数限制。
[Node.js AbortSignal 文档](https://nodejs.org/download/release/v22.15.0/docs/api/globals.html#abortsignalthrowifaborted)
定义 `throwIfAborted()` 抛出原始 reason；适配器在异步边界执行该检查。
