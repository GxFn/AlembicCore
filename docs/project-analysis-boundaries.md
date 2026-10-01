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

## CodeGraph 文件分析

宿主可通过 `withCodeGraphProjectContextSession({ dataRoot, signal }, callback)` 创建
真实 SDK 分析作用域。回调拿到原生 ProjectContext 执行器和 `{ engineHash, engine,
runtimeRoot }`；它保留完整输入记录能力，不能再包成未声明读取能力的任意执行器。
该入口需要 Node.js 22.5+；既有普通 ProjectContext 入口仍使用原 AST 实现。

当前固定官方 `@colbymchenry/codegraph@1.6.0`，在独立子进程设置官方
`CODEGRAPH_KERNEL=0`，通过公开 `extractFromSource` 分析传入字符串。SDK只在
`dataRoot/.asd/codegraph-sessions` 的唯一临时子目录内初始化，`index:false` 不创建活动
源码全图。带有已声明捕获清单的会话另按下节运行私有项目解析。
宿主必须将位于源码范围内的固定 runtimeRoot 加入 inventory 排除策略。
退出时停止接单、排空已接受查询、关闭并等待进程退出，然后删除该临时子目录。
超时或取消会终止在途 SDK 任务；作用域任何阶段的 owner 取消均不能发布成功。
单个请求取消后先等待旧进程退出，健康owner的后续请求才可惰性重开同一身份的worker；
不能把一个repo的deadline扩散为其它repo也被取消。worker同时启用SDK建议的
`--liftoff-only`，在需要标志的早期Node 22/23版本显式启用`node:sqlite`，实际启动参数
一并进入身份并在READY中核对。

`getCodeGraphProjectContextIdentity()` 只读取 SDK/平台包版本、Node、worker字节和
规范化策略身份，不启动进程。共享 Graph build 应在 acquire 前将 engineHash 放入缓存
键，在真正的 build(ownerSignal) 回调中创建 SDK 作用域；不能让单个订阅者拥有共享 worker。
认证 producer 应使用实际 engineHash 作为 parserHash。改变规范化或 AST 补充策略时，
必须更新对应策略版本并复核兼容矩阵，不能沿用旧身份假称新引擎结果。

JS 家族的具名符号由CodeGraph节点提供事实，Alembic继续生成既有refs；同行
同名节点不能按 SDK id 去重，确有碰撞时使用已验证的 UTF-16 列区分。AST通过真实节点位置
对应跨行箭头绑定、私有方法占位；仅补已证实的声明方法、构造参数属性与 JS constructor
this 属性。普通SDK声明丢失时明确返回不可用，不以全量旧结果掩盖。

1.6.0 对匿名默认声明、namespace 的投影不完整，本入口按真实 AST 形态返回明确的覆盖
不可用；语法错误也不能因 SDK `errors=[]` 被认证为空成功。导出标志、已有非碰撞范围与
类别保留兼容语义。非JS语言和Guard目前继续使用原生产方。
SourceGraph的JS/TS符号可按下节显式接入；不得把这些入口描述成全部AST或完整图索引已迁移。

file-flow从同一次SDK提取取得未解析的calls/instantiates候选，AST为同一文本位置提供
实际调用范围、参数数量、await、receiver与词法owner。符号与flow共享内部完整文件分析
入口；原有只符号的注入接口仍可用。SDK节点ID不能证明调用者身份：同行方法可能共用ID，
匿名回调也可能归在SDK外层节点。完全等价的重复候选只有在AST位置和重数一致时才能采用，
不能按遍历顺序配对；观察缺失或不一致时返回明确不可用。SDK 1.6未表达的JSX标签、主动
省略的字面量receiver调用（例如数组的includes）仅通过对应AST语法形态补充，保留既有
噪声策略；字面量调用也不能按方法裸名连到项目函数。

调用关系只在有语法证据时连接到symbol ref，证据分两类，见下节"调用链接"。未知receiver、
参数遮蔽或歧义保留unresolved；真实顶层owner连接已有file ref。普通关系保留行级ref，
同一ref对应多个真实调用位置时才附列消歧。callers/callees是同一文件观察的不同排序，
不能视为跨文件反向调用索引，也不代表静态分析已证明运行时分派。

JS/TS imports/exports从同一棵已解析AST的模块语法节点生成，替代原文本扫描器。
注释、字符串与模板正文不构成依赖；模板插值中的真实调用仍可提取。该投影不改变旧
AstFileSummary或ImportRecord序列化形态，保留原解析预算与非JS生产方。

带来源specifier的重导出也建立文件依赖。file-flow保留其`exports`种类及原关系ID，
通过同次查询的reader解析目标file ref；重导出不创建本地绑定，不能借同名私有函数造
symbol端点。modules/layers/map只将这类exports纳入依赖，普通本地导出仍表示公共面。
import与export-from共用一次目标观察，解析所需的存在性和不存在性都参与输入记录与重放。
源码候选顺序由共享函数管理：真实`.js/.mjs/.cjs`优先，缺失时才映射到匹配TS源码；
`feature.v2`等带点目录仍支持index入口，不能因点号被当作输出扩展名。

## 调用链接

调用点到声明的连接由 `core/linking` 的链接器给出，按证据强度依次执行，后者不得改写前者。

同文件链接：调用点的词法绑定或 `this`/`self` 接收者指向本文件声明。调用方与被调方都用
声明节点的真实范围比对；公开符号的行级 range 只为兼容保留，对不上多行签名。Swift、Kotlin、
Java、Dart 的方法体里省略接收者的调用先在本类型成员里找，成员优先于模块级同名函数；
Python、Go、Rust 的成员调用必须写出接收者，裸调用不当成成员。这些语言的插件没有词法绑定
证据，同名局部闭包会被当成成员，属于已知近似。

导入绑定链接（JS/TS）：调用点的被调标识符在词法上绑定到一条 import 时，沿"说明符 →
目标文件 → 导出表"找到声明。覆盖具名、default、namespace 成员、导入类的静态成员、`new`
与 JSX 元素；跟随具名转发与 `export *`，上限 8 层。类型导入不是运行时绑定；参数或局部变量
遮蔽时绑定范围不相等，不会连接。目标不唯一（同名的类与函数、多个 `export *` 命中不同声明）
或 default 无法定位到声明时不产出目标，不按顺序或距离猜。只处理相对说明符。

导入绑定链接在普通实时查询和认证捕获里都执行，目标文件经同一个 reader 按需读取：实时查询
读当前文件，捕获登记实际消费的源码版本，重放得到相同结果。它只读被引用到的文件，不需要
预先声明项目源码清单。

类型层级链接（JS/TS）：类与接口写出的父类型名字是模块作用域里的标识符，按同文件顶层声明或
import 绑定（含类型导入、命名空间成员）找到声明。同名的本地声明与导入并存、表达式形式的父类
都不产出目标。

链接器是纯函数，通过 `ModuleGraphAccess` 取其他模块的声明事实，自己不读磁盘。同一组链接器
服务两个消费者：ProjectContext 的 `file-flow` 按需链接单个文件，SourceGraph 索引链接整个项目。
`file-flow` 的调用方只认直接拥有者；索引另外把匿名回调、嵌套函数里的调用归到包住它的声明。

## 冻结输入上的 CodeGraph 项目解析

本节的 SDK 项目解析只处理导入绑定链接没有解析的 import 调用点（tsconfig 路径别名、包入口）。
相对导入的调用全部已有目标时不启动 SDK 项目分析；已有目标不会被 SDK 结果改写。


Main/Plugin 的原生 Foundation 捕获先声明 `sourceFiles`，再把同一 reader 交给分析会话。
该清单只列出本次选定的源码身份；源码字节继续来自既有 blob/read receipts，配置和目录
观察不会自动成为源码清单。旧 V1 快照没有该字段时保持旧 hash 和读取语义；普通 live
单文件查询不因启用 SDK 自动扫描全仓。

Core 在每个 reader/repo 内使用公开 `indexFiles` 与 `resolveReferences`。SDK 的同步
文件读取通过独立进程内的冻结读集适配，tsconfig/extends/package、目录、stat、realpath
和有限只读 Git 命令均进入同一 snapshot。缺项读取通过额外私有 pipe 同步等待父进程的
同一个 reader 返回真实结果，然后继续当前图，不返回临时空值或假 ENOENT。
每个 Recording/Replay 视图独立构图；Replay 缺记录、权限错误或取消立即终止项目。
SDK 自己吞掉读取异常，也不能发布失败输入对应的结果。
Git 验证使用当前验证 signal；重放不启动 Git。真实图数据库只存在私有临时目录。

SDK 的目录发现视图会排除位于已绑定根内的宿主 `.asd` 状态目录；原始 reader 仍保存
真实目录项，显式源码清单和文件读取不因此删减。排除策略以 `codegraph-input-view`
配置记录，随源码 root 重绑定；Replay 使用捕获时的策略，不受本次 dataRoot 位置影响。
Git 输入通过真实 literal exclude pathspec 获取，同一命令的不同策略有独立输入身份。
新鲜度校验沿用已接受的策略并重新观察物理输入，不能用新宿主配置替换旧策略。
缺少该配置的历史 V1 snapshot 保持原有发现语义，不为兼容而吞掉未捕获读取。
runtime 根规范化真实路径，避免 `/var` 与 `/private/var` 等别名绕过私有目录边界。

宿主还可通过 `CodeGraphProjectContextOptions.privateDirectories` 声明自己的产物目录，
例如认证存储。使用规范化的绝对路径，在捕获前创建固定目录，并把同一数组传给
`NodeProjectContextFoundationHostPortsOptions.privateDirectories`，同时纳入宿主 inventory
排除策略。前者绑定 SDK 发现视图；后者在原始 Recording/Replay reader 外提供通用目录
发现投影，并为真实 Git status 添加 literal exclude pathspec。通用投影以
`project-input-view` 保存；SDK 的额外 runtime 排除保留 `codegraph-input-view` 兼容键。
discoverer、repo/module 目录扫描在首次查询前取得该策略，原始目录记录与显式文件读取
保持完整，发布产物不会被回读为源码或让无变化源码从 clean 判为 dirty。
不声明私有目录时保留原 Git 状态语义；历史闭包无通用视图策略时重放原发现路径。
这些目录必须由宿主拥有，不能覆盖源码根；Core 不创建或迁移宿主存储。新策略须进入
宿主配置身份；历史产物的 freshness 应继续使用其已接受的版本，不能偷偷套用新排除。

这是固定 SDK 1.6 的输入适配，**不是操作系统沙箱或任意插件执行环境**。不执行项目代码；
未知 IO 形态、越出已接受 roots 的支持输入、宿主绝对路径配置和私有 runtime 输入明确
不可用。当前每仓上限为 2,000 个 JS/TS 源文件、32 MiB 源码，单图最多 262,144 个去重
动态支持读取。该累计上界来自旧 64 轮×4,096 的最大读取量；流式协议取消单批限制，
并非保留旧两维准入规则。超限返回诊断，不裁剪后冒称完整。非 JS 生产方保持原行为。
SDK timeout 保留剩余计算时间，在父端 reader 执行时暂停，不因每次读取而重置。
父端取消会关闭通道、终止并等待 child 退出，迟到的旧 response 不进入新请求。

实际跨文件目标仍投影到既有 file-flow：调用位置、词法 import 绑定、目标同文本符号和
无碰撞身份同时成立时才接纳 SDK `import` 候选。参数遮蔽、type-only、动态 receiver、
SDK 节点碰撞及猜测式全局匹配保持 unresolved。SDK 1.6 会把首个导出函数误作 default，
因此默认导入还要求目标具有明确 default 导出证据；缺证据的默认重导出等形式不会补猜。

不同仓库即使有相同相对路径也分开建图；导航字段按当前请求投影。缓存命中仍报告本次
消费的源码版本，Replay 使用独立 reader 重新运行 SDK。新增目标不改变既有调用点 ref ID，
只补 `to/targetRef`。这里仍不是跨仓反向 callers 索引，也不保证运行时动态分派正确。
SourceGraph live SQLite 索引继续使用下节的独立能力边界。

项目准备只建立 SDK 结果的文件/调用位置索引，Alembic 的目标声明证据按实际访问的目标
文件加载。每个目标文件仍做完整 SDK 覆盖、碰撞和默认导出核验，不按单个候选省略这些
检查。声明与符号/调用查询共用同 reader、同源码版本的紧凑语法证据；调用模式升级才
补提取调用事实。自定义后端和公开 refs 都获得独立可变副本，不能修改会话内部缓存。

已经声明的清单和 root 绑定可在 reader 生命周期内复用；每次命中仍检查取消及失败锁存，
并保留完整源码消费收据。热查询不重新导出全部 blob；首次准备发送已有 snapshot，
动态读取只传单项事实，由原 reader 记录，收尾再冻结完整闭包。一次 freshness 检查中的
Git 请求共用一个只读 Replay 解码视图，实际 Git 重观察、输入 hash 校验和新闭包校验
保持独立。新策略不执行旧 unknown 分叉，闭包可能比旧策略小；新引擎身份参与认证，
不能用不同策略的 snapshotHash 相同作为正确性标准。

## SourceGraph 索引接入

已有 `SourceGraphLifecycleService` 接受
`{ projectRoot, projectScopeDescriptor, codeGraph: { dataRoot }, signal }`。
`dataRoot` 是宿主的绝对私有数据目录；传完整ProjectScope时，projectRoot应锚到它的
controlRoot，保证各成员的文件路径相对于同一个根。
明确声明的ProjectScope没有源码folder时直接报告错误，不回退扫描controlRoot，也不发布
空壳generation。未声明descriptor的旧单目录调用仍以projectRoot作为来源。

索引的事实只有一个来源：`core/facts` 的文件事实。所有语言走同一条路径，没有按语言或按
是否接入外部引擎分叉的提取实现。每个文件只读一次文本，内容 hash、符号、导入导出、调用点
都从这一份文本产生；它不借公共 ProjectContext envelope 重新读取 live 文件。
`codeGraph` 选项不影响符号与自有链接的结果，只进入索引身份并把私有运行目录排除在清单之外；
外部引擎的边作为独立的链接来源接入。

清单默认包含有解析器的全部扩展名（来自 `core/facts/parserLanguage` 的唯一映射，含
`.m`/`.mm`/`.h`、`.mts`/`.cts`、`.dart`、`.kts`），外加只做清单不做解析的文档与配置文件。
语言标签取自 `LanguageService`。

索引按文件写三类边，全部带来源与分级（`metadata.resolution = { linker, strategy, tier }`）：

- `imports`：JS/TS 的相对导入与 export-from，每个（来源文件 → 目标文件）一条，
  `metadata.dependencyKind` 记首条绑定的种类，任一条是 re-export 时 `metadata.reexport = true`。
- `extends` / `implements`：JS/TS 的父类型名字经同文件声明或 import 绑定连到声明。
  解析不到声明的父类型（包里的类型、其他语言）只把名字留在符号的 `metadata.heritage` 上。
- `calls`：同文件链接与导入绑定链接的结果，一个调用点一条，带调用点位置。
  `metadata.callKind` 区分 call / new / jsx；实例化就是目标为类型的调用边。
  `metadata.callerAttribution` 说明调用方怎么定的：declaration 是调用点的直接拥有者；
  enclosing 是拥有者为匿名回调、嵌套函数、对象字面量方法或初始化表达式时，归到包住它的
  最内层声明；module 是没有任何声明包住它，归文件自身。

自有链接器的边 tier 为 certain、provenance 为 deterministic。未解析的调用点不入库，
文件元数据的 `callSites = { total, linked }` 记数量。存储顺序是文件依赖、跨文件符号边、
文件内符号边，受预算截断的查询因此先拿到跨文件信息。

普通符号ID保持path#name，成员使用qualifiedName；真正碰撞才增加声明kind和真实范围。
文件的#module锚点保留给库存/导入边与模块顶层的调用，用户同名变量另行消歧。变量箭头绑定
保持 variable 类别。成员在同文件有唯一容器声明时带 `containerSymbolId`。接口只收方法签名，
属性签名不产出符号。内部声明kind/range不进入ProjectContext公开SymbolSummary/ref。

解析状态：JS/TS 带真实语法错误的文件记为 failed，不入符号；语法包不认识但合法的类型层语法
（`export type * from`、类型实参里的 `import()` 类型）不算语法错误。其他语言的语法包对合法源码
也会报错，不据此判失败。`namespace` 成员与匿名 default 声明没有符号，文件照常入库并在文件元数据
`uncoveredSyntax` 里记下。压缩或生成物形态的文件只留声明，记为 partial。

增量构建的结果必须与同一文件集合上的全量构建相同。没改内容的文件在两种情况下也要重新链接：
文件集合变化时，所有做相对导入解析的文件重来；只有内容变化时，重连直接导入它的文件，
以及经 re-export 链拿到它声明的文件。沿用自上一代的文件被当作链接目标时按需重读声明，
内容必须仍是上一代记录的那一份。来源文件被重新分析的边一律重算；指向内容已变文件的
其余符号边不沿用。

索引器、文件分析、链接、配置身份分别负责代际编排、单文件事实、出边、继承判定。身份包含
SourceGraph自身提取版本、接入外部引擎时的 engineHash、有效scope/roots、扫描配置和解析预算。
旧快照缺少完整身份，或任一策略变化时，必须全量重提取；禁止保留旧符号却给新快照换版本标签。
旧generation仍可读取，查询/分页预算和SQLite同步事务不变。

freshness检查以与索引一致的UTF-8正文hash核对实际内容，size/mtime相等不再跳过核验。
因此等长修改并恢复时间戳仍会进入增量追赶；仅触碰时间戳且正文相同仍noop。这个检查
需要读取库存文件的正文，不是单纯stat优化，也不声称得到原子的全项目快照。

构建被取消时不发布新代际。固定私有runtime父目录始终排除，即使调用方自定义
ignoreDirectories；不会删除同目录中其它会话的资源。真实语法失败会持久化为明确解析诊断。

查询的低置信与歧义诊断只看查询与符号本身的匹配强度；图连通度只参与排序。被调用得多
不能证明某个符号就是查询要找的那一个。

SourceGraph是live辅助观测，不自动继承certified input closure的保证。下游库存计数提示
同时表达freshness/ready；部分覆盖不能被计数误称为完整就绪。

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
