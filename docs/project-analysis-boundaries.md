# 项目分析的读取与会话边界

宿主通过 `@alembic/core/project-context` 查询实时项目，通过
`@alembic/core/project-context-foundation` 捕获和重开认证事实。两者不能共用一个
隐式的“当前项目”状态，也不能把实时查询结果当成完整冻结文件系统的重放结果。

## 分析会话

普通 `ProjectContext.execute()` 为每次查询创建独立会话。嵌套的 module/layers/map/
anchor 查询复用实际读取的源码和一次 AST 提取，symbols 与 flow 从同一摘要投影。
源码在查询期间改变时，已经读取的文件仍使用同一版本；下一次独立查询会读取新版本。

整批事实收集使用既有包入口新增的 `withProjectContextSession`：

```ts
import { withProjectContextSession } from '@alembic/core/project-context';

const facts = await withProjectContextSession(async (context) => {
  const symbols = await context.execute({ kind: 'file-symbols', scope, payload: { filePath } });
  const flow = await context.execute({ kind: 'file-flow', scope, payload: { filePath } });
  return { symbols, flow };
});
```

回调内共享已读源码及所需符号/调用事实；Core 的 Plan collector 已使用此入口。
不同 root/repo 的内容不混用，sourceFolder 等导航字段按每个请求保留。返回值可由调用方
修改，不会污染后续缓存。批次内请求按接收顺序执行，各自保留 AbortSignal；退出时停止
接单、排空已接收请求并清理缓存，回调异常也执行同样的清理。不能保存执行器在回调结束
后继续使用，也不应把会话用于长期监控或无限批次。

会话只缓存实际读取的源码及紧凑投影，不保留完整 AST 树/指标摘要。普通实时会话的目录、
manifest、偏好及导入存在性仍实时读取；认证捕获通过独立 reader 记录这些输入。源码及
提取缓存按 reader 身份隔离，捕获、重放和后续捕获不会互相复用旧事实。inventory 读取
和终态 fence 仍独立读取真实源树。

## 发现会话

`DiscovererRegistry.withSession()` 覆盖检测、加载、读取和结果投影。内置 discoverer
使用每次会话独立的实例。扩展可用 `register(instance, factory)` 提供实例工厂；工厂
必须返回独立实例。

旧的 `register(instance)` 保留对象身份，由 Core 按对象串行使用；同一对象注册到不同
registry 也共用队列。取消排队不会越过仍在执行的前序请求，已开始的 detector 必须结束
后才能释放对象。回调需返回投影后的值，不能返回 discoverer 供之后使用，也不要重入
同一个旧实例的会话。直接使用旧 `detect()/getAll()` 的调用方仍须自行遵守这个会话边界。

记录/重放会话要求显式工厂，并要求实例声明支持注入 reader。九类内置发现器均符合此
约定；旧扩展实例仍可用于实时查询，但不能自动获得完整输入捕获保证。会话期间替换
reader 或追加未确认的发现器会使该次捕获失败。

## 捕获期间的源码读取

共用 source loader 的七类查询（source-slice、file-symbols、file-flow、anchor-range、
module、module-layers、map）通过非序列化的 `onSourceFileRead` 传递实际读取的原始字节。
Node host port 生成 `sourceFileReads`，以相对路径和完整 SHA256 记录读取版本。同一文件
重复读到相同内容可合并；读到不同版本必须全部保留。

物理读取观察与版本消费分开：缓存命中仍通过内部通知携带原始字节的完整 hash，并进入
当前查询的 `sourceFileReads`。因此复用会话再次捕获时，旧缓存不能被误绑定到新的
inventory。每个查询都核对所用版本，同时避免重复磁盘 IO 和 AST 解析。

capture 在接受查询输出前，对照 inventory 中的原始 blob hash 检查这些收据。读取内容
不一致或不在捕获 inventory 中时，抛出 `PROJECT_CONTEXT_SOURCE_STATE_DRIFT`，整次捕获
不能发布。宿主可从新捕获开始重试；Core 不自动重试。这样可以发现文件被临时修改又还原
的 ABA 情况，前后文件树检查不能单独证明这一点。

现有公开 ref 的短文本 hash、历史 artifact 格式和读取方式保持兼容。原始字节 hash 不从
UTF-8 解码后的文本重新计算。包装 Node host port 的 adapter 必须保留 `sourceFileReads`；
旧自定义 port 仍可省略该字段，但需自行保证其查询输出与捕获输入一致。自定义 handler
读取源码时应传递 execution context，不能只转发 AbortSignal。

## 完整分析输入记录

内置 Node host port 对 Core 执行器和 `withProjectContextSession` 的执行器自动启用
`createInputCapture`。九类发现器和九类查询共用只读输入协议，记录文件原始字节、目录
成员与类型、stat、realpath，以及解析后的 scope/preference。已知不存在与未曾捕获的
操作有不同含义；重放遇到遗漏会锁存失败，即使业务层的旧 catch 吞掉异常也不能发布认证。

捕获先预置 inventory 字节，然后执行请求矩阵；再使用新的纯内存 reader 重算同一矩阵，
比较规范化输出，并检查实际输入未漂移。支持输入包含清单、空目录和不存在性，独立于
源码扩展名/排除策略。mtime 不参与输入身份，业务配置中的普通字符串也不作为文件路径
重绑定。产物仅保存 root 标识与相对路径；支持路径只读，不用于物化或写回文件。

新产物可携带 `facts.inputClosure`，其字节按 hash 复用原 chunk 池；闭包 hash 同时绑定
manifest 和 `SourceRevisionVectorV1`。仅修改支持配置也会让旧事实版本失效。旧 artifact
以及没有捕获 hook 的自定义 host port 沿用原协议，不自动获得这项保证。包装 Node host
port 的 adapter 必须转发 `createInputCapture`，并透传 `executeRequest` 的完整参数。

实时新鲜性检查应调用 `NodeProjectContextFoundationHostPorts.observeInputClosureHash`，
传入产物的 closure/chunks、当前 repositories 与 controlRoot，然后将观察所得 hash 作为
`buildSourceRevisionVectorV1(entries, inputClosureHash)` 的第二个参数。它重新检查已认证
读集，保留不存在的观察，传播异常和取消，并统一软链接 root；不能直接复制旧 hash。
这只判断旧输入是否仍成立，不表示新的查询结果已经重新认证。无闭包的历史产物省略该参数。

## 部分结果

模块目录扫描失败时，保留已读文件，同时返回带目录路径及系统错误码的 error 诊断。
部分子树不可读不等于空目录；该诊断不能降为普通 advisory 后继续认证成功。

模块依赖匹配到多个文件 owner 或同名模块时，保留全部候选引用并返回 `ambiguous` 错误。
这些候选不参与确定依赖边、环、层级和热点排名，也不计为外部包；关闭外部依赖展示不会
隐藏项目内部的归属歧义。修正模块归属后重新查询才能生成确定关系。

图索引的内部完整 generation 读取与面向展示的分页查询职责不同。增量继承必须读取全部
旧边；展示页的默认条数不能变成下一代持久化图的容量。旧文件的解析失败、跳过或部分
状态也必须随 generation 保留，直到实际修复或删除对应文件。

显式目标的关系查询先定位目标关联边，再应用返回预算。搜索的连通性排名仍采用原有
采样规则，不能把这项修复理解为所有查询都完成全图遍历。

SourceGraph 读取实时正文时，用索引保存的文本 hash 核验内容，同一查询复用核验过的
文本。内容变化则本次查询标为 stale，无法核验则标为 unavailable，返回诊断并清除
正文；查询不会修改持久化 generation 或自动重建。此检查针对实际读取的正文，不代表
重新扫描过所有未读取文件。宿主需完成索引更新后再请求当前源码证据。
