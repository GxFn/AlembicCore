# 项目分析的读取与会话边界

宿主通过 `@alembic/core/project-context` 查询实时项目，通过
`@alembic/core/project-context-foundation` 捕获和重开认证事实。两者不能共用一个
隐式的“当前项目”状态，也不能把实时查询结果当成完整冻结文件系统的重放结果。

## 发现会话

`DiscovererRegistry.withSession()` 覆盖检测、加载、读取和结果投影。内置 discoverer
使用每次会话独立的实例。扩展可用 `register(instance, factory)` 提供实例工厂；工厂
必须返回独立实例。

旧的 `register(instance)` 保留对象身份，由 Core 按对象串行使用；同一对象注册到不同
registry 也共用队列。取消排队不会越过仍在执行的前序请求，已开始的 detector 必须结束
后才能释放对象。回调需返回投影后的值，不能返回 discoverer 供之后使用，也不要重入
同一个旧实例的会话。直接使用旧 `detect()/getAll()` 的调用方仍须自行遵守这个会话边界。

## 捕获期间的源码读取

共用 source loader 的七类查询（source-slice、file-symbols、file-flow、anchor-range、
module、module-layers、map）通过非序列化的 `onSourceFileRead` 传递实际读取的原始字节。
Node host port 生成 `sourceFileReads`，以相对路径和完整 SHA256 记录读取版本。同一文件
重复读到相同内容可合并；读到不同版本必须全部保留。

capture 在接受查询输出前，对照 inventory 中的原始 blob hash 检查这些收据。读取内容
不一致或不在捕获 inventory 中时，抛出 `PROJECT_CONTEXT_SOURCE_STATE_DRIFT`，整次捕获
不能发布。宿主可从新捕获开始重试；Core 不自动重试。这样可以发现文件被临时修改又还原
的 ABA 情况，前后文件树检查不能单独证明这一点。

现有公开 ref 的短文本 hash、历史 artifact 格式和读取方式保持兼容。原始字节 hash 不从
UTF-8 解码后的文本重新计算。包装 Node host port 的 adapter 必须保留 `sourceFileReads`；
旧自定义 port 仍可省略该字段，但需自行保证其查询输出与捕获输入一致。自定义 handler
读取源码时应传递 execution context，不能只转发 AbortSignal。

该检查还不是完整输入闭包：repo/discovery 内部的直接源码及 manifest 读取、目录成员、
导入目标存在性、discoverer preference 等尚未统一绑定。历史 artifact 也不会因此获得
新的保证。完整冻结分析需要把这些支持输入及其身份一并纳入捕获，不能用 inventory 中
“没有这个键”推断原文件系统不存在该输入。

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
