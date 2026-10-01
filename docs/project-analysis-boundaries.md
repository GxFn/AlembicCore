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

## 严格分析会话

宿主通过 `withCodeGraphProjectContextSession({ dataRoot, signal }, callback)` 创建认证捕获与
图构建使用的分析作用域。回调拿到原生 ProjectContext 执行器和 `{ engineHash, engine,
runtimeRoot }`；它保留完整输入记录能力，不能再包成未声明读取能力的任意执行器。

入口名字里的 CodeGraph 来自早期实现：那时会话在子进程里用 CodeGraph SDK 提取 JS/TS 符号，
并在冻结输入上运行 SDK 的项目解析。现在会话的全部事实来自自有的文件事实（`core/facts`）与
链接器（`core/linking`）：不启动进程、不使用 SDK、不需要预先声明源码清单。导出的名字与签名
保持不变。CodeGraph 只在 SourceGraph 索引里作为外部链接来源使用（见"外部引擎的边"）。

与普通会话的区别只有一点：**不给部分结果**。认证捕获会把空结果当成"这个文件确实没有声明"，
所以 JS/TS 文件出现下面两种情况时，file-symbols 与 file-flow 返回明确的 `query-unavailable`，
而不是残缺的符号表：

- 语法无法验证：文件带真实语法错误。语法包不认识但合法的类型层语法（`export type * from`、
  类型实参里的 `import()` 类型）不算语法错误。
- 声明覆盖不完整：`namespace` 成员与匿名 default 声明，这两种形式本层不提取成员。

其他语言的语法包对合法源码也会报错，不据此判不可用；它们和 Guard 的行为与普通会话相同。

`runtimeRoot` 是 `dataRoot/.asd/codegraph-sessions` 的 canonical 路径（`/var` 与
`/private/var` 这类别名不能绕过私有目录边界），会话开始时创建。会话自己不往里写东西；索引
接入外部引擎时在这里建临时镜像。宿主必须把位于源码范围内的 runtimeRoot 加入 inventory 排除
策略。`privateDirectories` 在会话上只校验形式，目录发现的排除由 host port 负责（见"认证捕获
里的目录视图与历史闭包"）。`timeoutMs` 已不使用。作用域任何阶段的 owner 取消都不能发布成功：
开始前取消不创建目录，回调期间到达的取消在回调返回后抛出；回调结束后执行器不可再用。

`getCodeGraphProjectContextIdentity()` 返回自有分析引擎的身份：分析规则版本加全部语法包的
内容哈希。它不含 Node 版本、平台或进程参数——同一套规则与语法包在任何宿主上给出相同结果，
查询它也不启动进程。共享 Graph build 应在 acquire 前把 engineHash 放入缓存键；认证 producer
用 engineHash 作为 parserHash。改变语法提取、文件事实或链接规则时必须提高分析规则版本
（`infrastructure/analysis/AnalysisEngineIdentity` 的 `ANALYSIS_VERSION`），不能沿用旧身份。

### 符号与调用事实

符号、导入导出、调用点来自同一份文本的一次解析，symbols 与 flow 共享这次分析；原有只取符号
的注入接口仍可用。公开符号保持既有的 ref 生成规则与按行的 range。同一行上同名同类的多个声明
（getter 与 setter、写在一行的重载）用 UTF-16 列范围区分，签名也按列切出；没有碰撞的符号不带
列。声明节点的语法种类、真实位置等内部证据不进入公开 SymbolSummary 或 ref。

调用点带实际调用范围、参数数量、await、receiver 与词法拥有者，含 `new` 与 JSX 元素。调用关系
只在有语法证据时连接到 symbol ref，证据的种类见下节"调用链接"。未知 receiver、参数遮蔽或歧义
保留 unresolved，字面量上的方法调用（例如数组的 includes）不按方法裸名连到项目函数；真实顶层
owner 连接已有 file ref。普通关系保留行级 ref，同一 ref 对应多个真实调用位置时才附列消歧，
所以同一行上的两次相同调用各有自己的 ref。callers/callees 是同一文件观察的不同排序，不能视为
跨文件反向调用索引，也不代表静态分析已证明运行时分派。

JS/TS imports/exports 从同一棵已解析 AST 的模块语法节点生成。注释、字符串与模板正文不构成
依赖；模板插值中的真实调用仍可提取。该投影不改变旧 AstFileSummary 或 ImportRecord 序列化
形态，保留原解析预算与非 JS 生产方。

带来源 specifier 的重导出也建立文件依赖。file-flow 保留其 `exports` 种类及原关系 ID，通过
同次查询的 reader 解析目标 file ref；重导出不创建本地绑定，不能借同名私有函数造 symbol 端点。
modules/layers/map 只将这类 exports 纳入依赖，普通本地导出仍表示公共面。import 与
export-from 共用一次目标观察，解析所需的存在性和不存在性都参与输入记录与重放。源码候选顺序
由共享函数管理：真实 `.js/.mjs/.cjs` 优先，缺失时才映射到匹配的 TS 源码；`feature.v2` 等带点
目录仍支持 index 入口，不能因点号被当作输出扩展名。

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
或 default 无法定位到声明时不产出目标，不按顺序或距离猜。

说明符到文件的解析只有一份规则（`core/linking/moduleResolver`），协议与索引各自只提供读取通道。
它依次认四种写法：

- 相对路径（含 `.`、`..`）。
- tsconfig / jsconfig 的路径别名（`paths`、`baseUrl`）。取离导入文件最近的 `tsconfig.json`
  （其次 `jsconfig.json`），跟随相对路径的 `extends`（含数组形式，最多四层），允许注释与尾随
  逗号；规则与 TypeScript 一致——`paths` 整体覆盖继承来的 `paths`，目标相对 `baseUrl`，没有
  `baseUrl` 时相对声明它的配置文件。多个模式命中时取最具体的一个，目标按写出的顺序尝试。
- 项目内的包。包目录的来源有三个：导入方所在的包自己（自引用）；它用 `file:` / `link:` 声明的
  本地依赖；导入方所属 workspace 里同名的成员。workspace 成员由根清单声明（`package.json` 的
  `workspaces`、`pnpm-workspace.yaml`、`lerna.json` 的 `packages`，支持 `*`、`**` 与 `!` 排除），
  不在成员模式里的同名清单不算；同名成员不止一个时不选。入口取 `exports`（子路径、带 `*` 的
  模式、条件对象），没有 `exports` 时依次取 `source`、`types`、`module`、`main`，子路径直接对应
  包目录下的路径。
- `#` 开头的说明符：导入方所在包的 `imports`。

包入口常常写的是构建产物（`./dist/index.js`、`./dist/index.d.ts`），分析要的是源码。包自己的
tsconfig 同时写明 `outDir` 与 `rootDir` 时按它换回源码，这有配置为证。两者缺一时只剩目录惯例
（`dist`、`build`、`out`、`lib` 等对应 `src` 或包根）：协议不按惯例猜，这类导入的调用保持
unresolved；索引收下惯例找到的目标，但把经它得到的边标为可信档（见"SourceGraph 索引接入"）。
`dist`、`build`、`out` 与 tsconfig 的 `outDir` 之下的文件本身从不作为包入口的目标。

都不是的说明符是项目外的包（或包名形式的 `extends` 共享预设），没有目标。

导入绑定链接在普通实时查询和认证捕获里都执行，目标文件经同一个 reader 按需读取：实时查询
读当前文件，捕获登记实际消费的源码版本，重放得到相同结果。它只读被引用到的文件，不需要
预先声明项目源码清单。模块配置（tsconfig / jsconfig、各级 `package.json`、workspace 清单）与
workspace 成员目录同样经 reader 读取：读过的内容与"候选不存在"的观察都进入输入记录，一次会话内
同一个 reader 对同一目录只解析一次。

类型层级链接（JS/TS）：类与接口写出的父类型名字是模块作用域里的标识符，按同文件顶层声明或
import 绑定（含类型导入、命名空间成员）找到声明。同名的本地声明与导入并存、表达式形式的父类
都不产出目标。

链接器是纯函数，通过 `ModuleGraphAccess` 取其他模块的声明事实，自己不读磁盘。同一组链接器
服务两个消费者：ProjectContext 的 `file-flow` 按需链接单个文件，SourceGraph 索引链接整个项目。
`file-flow` 的调用方只认直接拥有者；索引另外把匿名回调、嵌套函数里的调用归到包住它的声明。

## 认证捕获里的目录视图与历史闭包

认证捕获不运行任何 SDK 项目解析。跨文件目标由"调用链接"一节的链接器给出，目标文件与模块配置
都经捕获的 reader 按需读取，读到的内容、目录观察与"不存在"的观察一起进入 input closure；
Replay 缺少其中任何一条都会以 `PROJECT_SOURCE_INPUT_UNCAPTURED` 失败，不会把缺记录当成
"没有这个文件"继续。Foundation 捕获仍先声明 `sourceFiles`——它是快照格式的一部分并参与
hash——但分析不依赖这份清单，也没有按仓库的源文件数量或字节上限。

宿主通过 `NodeProjectContextFoundationHostPortsOptions.privateDirectories` 声明自己的产物
目录，例如认证存储：使用规范化的绝对路径，在捕获前创建固定目录，并纳入宿主 inventory 排除
策略。同一数组也传给 `CodeGraphProjectContextOptions.privateDirectories`，会话只校验它的
形式。host port 在原始 Recording/Replay reader 外提供目录发现投影，并为真实 Git status 添加
literal exclude pathspec；策略以 `project-input-view` 配置记录保存，随源码 root 重绑定，
Replay 使用捕获时的策略，不受本次 dataRoot 位置影响。discoverer、repo/module 目录扫描在首次
查询前取得该策略；原始目录记录与显式文件读取保持完整，发布产物不会被回读为源码，也不会让
无变化的源码从 clean 判为 dirty。不声明私有目录时保留原 Git 状态语义；历史闭包没有视图策略
时重放原发现路径。这些目录必须由宿主拥有，不能覆盖源码根；Core 不创建或迁移宿主存储。新策略
须进入宿主配置身份；历史产物的 freshness 应继续使用其已接受的版本，不能偷偷套用新排除。

早期版本的捕获会在闭包里留下两类观察：`codegraph-input-view`（SDK 发现视图的排除策略）与
`codegraph-git`（SDK 发起的只读 Git 命令）。新捕获不再产生它们。带有这些记录的历史闭包仍可
解码，`observeInputClosureHash` 仍按原策略重新观察物理输入，不用新的宿主配置替换旧策略。
这些历史产物的 parserHash 是旧引擎的身份，与当前 engineHash 不同，宿主按既有规则重新捕获。

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
`codeGraph` 选项不影响符号与自有链接的结果；它进入索引身份、把私有运行目录排除在清单之外，
并打开外部引擎这个独立的链接来源（见"外部引擎的边"）。

清单默认包含有解析器的全部扩展名（来自 `core/facts/parserLanguage` 的唯一映射，含
`.m`/`.mm`/`.h`、`.mts`/`.cts`、`.dart`、`.kts`），外加只做清单不做解析的文档与配置文件。
语言标签取自 `LanguageService`。

索引按文件写三类边，全部带来源与分级（`metadata.resolution = { linker, strategy, tier }`）：

- `imports`：JS/TS 的导入与 export-from，每个（来源文件 → 目标文件）一条，
  `metadata.dependencyKind` 记首条绑定的种类，任一条是 re-export 时 `metadata.reexport = true`。
  `resolution.strategy` 说明说明符是怎么落到文件的：`relative-specifier`、`path-alias`、
  `package-entry`、`package-import`，或按目录惯例找回的 `package-source-convention`。
- `extends` / `implements`：JS/TS 的父类型名字经同文件声明或 import 绑定连到声明。
  解析不到声明的父类型（包里的类型、其他语言）只把名字留在符号的 `metadata.heritage` 上。
- `calls`：同文件链接与导入绑定链接的结果，一个调用点一条，带调用点位置。
  `metadata.callKind` 区分 call / new / jsx；实例化就是目标为类型的调用边。
  `metadata.callerAttribution` 说明调用方怎么定的：declaration 是调用点的直接拥有者；
  enclosing 是拥有者为匿名回调、嵌套函数、对象字面量方法或初始化表达式时，归到包住它的
  最内层声明；module 是没有任何声明包住它，归文件自身。

自有链接器的边 tier 为 certain、provenance 为 deterministic。唯一的例外是经过"按目录惯例找回的
包入口"的边（文件依赖，以及穿过这个模块的调用与层级边）：tier 为 trusted、provenance 为
heuristic、confidence 0.9，策略带 `+source-convention` 后缀。未解析的调用点不入库，
文件元数据的 `callSites = { total, linked }` 记数量。存储顺序是文件依赖、跨文件符号边、
文件内符号边，受预算截断的查询因此先拿到跨文件信息。

### 外部引擎的边

传了 `codeGraph` 时，索引在自有部分完成之后再用 CodeGraph 的原生模式跑一遍，采用它解析出的
调用、实例化、继承、协议与文件依赖。它是补充来源：Swift / ObjC 的跨文件关系、TS/JS 里已知类型的
成员调用与自有链接器解析不了的导入。只采用核对过准确率的语言（Swift、ObjC、TS/JS）。

运行方式：把本代完整解析过的源码与模块配置文件（tsconfig、jsconfig、package.json）以符号链接
镜像到宿主私有目录 `<dataRoot>/.asd/codegraph-sessions/native-*`，在子进程里对镜像建索引，读出
结果后整个镜像删除。CodeGraph 的索引库落在镜像里，目标项目目录不会被写入任何东西。CodeGraph
记录的文件内容哈希与索引的不一致时，涉及该文件的边全部不采用。

CodeGraph 只贡献"这个位置连到那个声明"，两端的身份都换成自有符号：调用方取包住引用位置的最内层
自有声明，目标按"文件 + 起始行 + 名字"对齐。边的 provenance 为 heuristic，confidence 取 CodeGraph
的置信度，`metadata.resolution = { linker: 'codegraph', strategy, tier }`。分级：

- **trusted**：导入、限定名、文件路径；已知类型的成员访问（置信度 ≥ 0.8）；`Type.member` 形式且
  接收者就是目标所属类型；不带接收者的调用连到自由函数，或连到调用方自己所属类型的成员（Swift 的
  隐式 self，含类型主体与 extension 分在两个文件）；ObjC 带参数的选择器全项目唯一；两端都是项目内
  真实类型声明的实例化、继承与协议关系。
- **candidate**：其余全部——按短名字撞上的方法、低置信度的成员访问、合成的协议分发边、JS/TS 的
  唯一名匹配、目标对不上自有符号的边。候选边入库，但默认不出现在任何查询结果里；查询显式传
  `includeCandidates` 才能看到，并且不能当作事实使用。

不采用的边按原因计数写进代际元数据 `externalLinker.dropped`：目标是框架或系统头文件的占位节点；
调用被解析成调用方自身（`super.x()`、`[super init]`、重载之间）；类型引用的目标只是 `extension`
而项目里没有该类型的声明；层级关系的主语是框架类型；与自有链接器的边重复或冲突；内容已变化。
CodeGraph 把 `extension T` 也当成类型节点——T 在项目里有唯一声明时改指向那个声明。

外部边每一代整体重新导入，增量构建不沿用上一代的外部边。引擎没装、超时或出错时这一代照常发布，
只是没有外部边，`externalLinker = { status: 'unavailable', reason }`；这不产生阻塞就绪的诊断。
取消不算降级，照常向上抛，不发布代际。

普通符号ID保持path#name，成员使用qualifiedName；真正碰撞才增加声明kind和真实范围。
文件的#module锚点保留给库存/导入边与模块顶层的调用，用户同名变量另行消歧。变量箭头绑定
保持 variable 类别。成员在同文件有唯一容器声明时带 `containerSymbolId`。接口只收方法签名，
属性签名不产出符号。内部声明kind/range不进入ProjectContext公开SymbolSummary/ref。

解析状态：JS/TS 带真实语法错误的文件记为 failed，不入符号；语法包不认识但合法的类型层语法
（`export type * from`、类型实参里的 `import()` 类型）不算语法错误。其他语言的语法包对合法源码
也会报错，不据此判失败。`namespace` 成员与匿名 default 声明没有符号，文件照常入库并在文件元数据
`uncoveredSyntax` 里记下。压缩或生成物形态的文件只留声明，记为 partial。

增量构建的结果必须与同一文件集合上的全量构建相同。没改内容的文件在三种情况下也要重新链接：
文件集合变化时，所有做模块解析的文件重来；说明符解析读过的配置文件内容变化时同样全部重来
（代际元数据 `moduleConfigFiles` 记着读过哪些：tsconfig / jsconfig 及经 `extends` 继承、名字
不限的配置，各级 `package.json` 与 workspace 清单；与解析无关的 JSON 变化不牵连源码）；只有源码内容变化时，重连直接导入它的文件，
以及经 re-export 链拿到它声明的文件。沿用自上一代的文件被当作链接目标时按需重读声明，
内容必须仍是上一代记录的那一份。来源文件被重新分析的边一律重算；指向内容已变文件的
其余符号边不沿用。

索引器、文件分析、链接、配置身份分别负责代际编排、单文件事实、出边、继承判定。身份包含
SourceGraph自身提取版本、有效scope/roots、扫描配置和解析预算；接入外部引擎时提取版本里另有
自有分析引擎的 engineHash（与严格会话报告的是同一个值）、外部引擎版本与采用规则版本。
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
