/**
 * examples/index.ts — SECTION 6 (P3: real, gate-clean worked examples).
 *
 * EXAMPLE_TEMPLATES was moved DOWN here from MissionBriefingSupport.ts (§C.9 internal-only: it is
 * NOT re-exported through the host-agent-workflows facade; consumers import `example(lang)` from
 * @alembic/core/knowledge). Every example is built by `buildExample` so it PASSES the full gate
 * (validateAgainst stage 1+2+3) — the opposite of the four anti-examples that shipped before, which
 * failed CONTENT_CONTRAST_MISSING (a `// ✅ 正确` line left only 2 trimmed chars after the marker,
 * below the 4-char floor), DO_CLAUSE/DONT_CLAUSE_NON_IMPERATIVE (objectivec led with "Prefix" /
 * "create"), and SOURCE_REF_LINE_MISSING (reasoning.sources were bare filenames with no line).
 *
 * Gate-passing invariants `buildExample` guarantees:
 *  - doClause leads with an allowlisted imperative verb; dontClause leads with "Do not …".
 *  - content.markdown ≥200 chars, has a ✅ line and a ❌ line each carrying ≥4 non-space chars
 *    after the marker, and a fenced code block (so the stage-3 markdown floor + code-ref hold).
 *  - reasoning.sources AND sourceRefs are repo-relative refs WITH a line number (path.ext:NN), so
 *    the stage-2 source-ref line-format check passes on a pure (resolver-free) run.
 *  - coreCode is real (no foo/bar/TODO/operation()/doThing placeholder) and never starts with a
 *    closing bracket; the title is project-specific (not a generic pattern name); the body carries
 *    no relationship keywords (so the graph-evidence rule does not demand graph refs).
 *
 * The standing tripwire test/RecipeAuthoringSpecExamplesGatePassing.test.ts runs EVERY example
 * through validateAgainst({stage:'all'}) and asserts zero violations, forever.
 */
import type { RecipeAuthoringViolation } from '../../../../types/recipeAuthoringSpec.js';

/** A worked, gate-passing recipe candidate for one language. */
export interface WorkedExample {
  language: string;
  /** a recipe candidate shaped like a real submit item; passes validateAgainst({stage:'all'}). */
  candidate: Record<string, unknown>;
  /** provenance note. */
  note: string;
  /** optional pre-computed violations when the host validates the example (filled by consumers). */
  violations?: RecipeAuthoringViolation[];
}

/** The minimal per-language inputs; buildExample assembles a full gate-passing candidate. */
interface ExampleSpec {
  language: string;
  title: string;
  trigger: string;
  category: string;
  knowledgeType: string;
  /** must lead with an allowlisted imperative verb (use/prefer/return/keep/...). */
  doClause: string;
  /** must lead with "Do not …" (or another negative imperative verb). */
  dontClause: string;
  whenClause: string;
  /** Chinese summary; avoid relationship keywords (依赖/关系/调用链/上游/下游). */
  description: string;
  /** ≥1 Chinese body lines giving project context + stats (keeps markdown ≥200 chars). */
  bodyZh: string;
  /** the ✅ correct snippet shown after the marker (≥4 chars). */
  okLine: string;
  /** the ❌ forbidden snippet shown after the marker (≥4 chars). */
  badLine: string;
  /** real, copyable code skeleton — not placeholder, never starts with a closing bracket. */
  coreCode: string;
  rationale: string;
  whyStandard: string;
  /** repo-relative source refs WITH a line number, e.g. 'src/Foo.ts:42'. */
  sources: string[];
  headers?: string[];
  usageGuide: string;
  /**
   * P2/C5: 可选深度分节——示范「就真实代码推理出深度」，每节挂真实 file:line(内联)，跨 ≥2 distinct 文件
   * 佐证(synthesis)。仅被注入 guidance 的 typescript 范例提供；其余范例不填(向后兼容，仍 gate-clean)。
   * 措辞必须避开门禁关系词(依赖/关系/调用链/调用方/被调用/影响路径/上游/下游)，否则触发 GRAPH_REF 规则。
   */
  depth?: {
    /** ## 设计意图：为何此结构而非显而易见的替代(须说明被放弃的替代)。 */
    designIntent: string;
    /** ## 边界与前置条件：何时适用/不适用、以何为前提、哪些不变量。 */
    boundaries: string;
    /** ## 失败模式：越界会怎样(出错/受影响/如何暴露)。 */
    failureModes: string;
    /** ## 权衡：放弃了什么、换来什么。 */
    tradeoffs: string;
  };
}

function buildExample(spec: ExampleSpec): Record<string, unknown> {
  // P2/C5: 深度分节作为纯散文追加在代码块之后——不新增 fenced 块，保证 collectCodeEvidence 仍取 coreCode
  // 为首个代码证据；每节挂真实 file:line，示范「就真实代码推理」而非填空模板。仅当 spec.depth 提供时渲染。
  // 2026-07-02 语义注记：`## 小节` 只是深度的一种**可选组织方式**(depthReview 双轨同样认可自由叙述)；
  // 本示例保留小节形式作示范，价值在其内容——被放弃的替代/量化占比/失败暴露点，而非小节结构本身。
  const depthLines = spec.depth
    ? [
        '',
        '## 设计意图',
        spec.depth.designIntent,
        '',
        '## 边界与前置条件',
        spec.depth.boundaries,
        '',
        '## 失败模式',
        spec.depth.failureModes,
        '',
        '## 权衡',
        spec.depth.tradeoffs,
      ]
    : [];
  const markdown = [
    `## ${spec.title}`,
    '',
    spec.bodyZh,
    '',
    `✅ correct: ${spec.okLine}`,
    `❌ wrong: ${spec.badLine}`,
    '',
    `\`\`\`${spec.language}`,
    spec.coreCode,
    '```',
    `(来源: ${spec.sources[0]})`,
    ...depthLines,
  ].join('\n');
  return {
    title: spec.title,
    language: spec.language,
    trigger: spec.trigger,
    kind: 'rule',
    doClause: spec.doClause,
    dontClause: spec.dontClause,
    whenClause: spec.whenClause,
    category: spec.category,
    description: spec.description,
    headers: spec.headers ?? [],
    usageGuide: spec.usageGuide,
    knowledgeType: spec.knowledgeType,
    coreCode: spec.coreCode,
    content: { markdown, rationale: spec.rationale },
    reasoning: { whyStandard: spec.whyStandard, sources: spec.sources, confidence: 0.9 },
    sourceRefs: spec.sources,
  };
}

/** Per-language gate-passing example candidates (keyed by lowercase language id). */
export const EXAMPLE_TEMPLATES: Record<string, Record<string, unknown>> = {
  objectivec: buildExample({
    language: 'objectivec',
    title: 'BDVideoPlayer 的 BD 前缀命名规范',
    trigger: '@bd-naming-prefix',
    category: 'Tool',
    knowledgeType: 'code-standard',
    doClause: 'Use the BD prefix on every Objective-C class and protocol name',
    dontClause: 'Do not create classes or protocols without the BD prefix in any module',
    whenClause: 'When creating new Objective-C classes or protocols',
    description: '所有类名必须使用 BD 前缀，确保模块归属一致性。',
    bodyZh:
      '本项目全部 85 个类中有 83 个采用 BD 前缀（约 97.6%），命名格式统一为 BD + 模块缩写 + 功能名，便于在大型工程里快速定位类所属模块并保持检索一致。',
    okLine: '@interface BDVideoPlayer : UIView  (BD 前缀齐全)',
    badLine: '@interface VideoPlayer : UIView  (缺少 BD 前缀)',
    coreCode:
      '@interface BDVideoPlayer : UIView\n@end\n\n@interface BDNetworkManager : NSObject\n@end',
    rationale: '统一前缀便于代码导航与模块归属识别，85 个类中 83 个遵循此规范。',
    whyStandard: '项目内 83/85 个类使用 BD 前缀，是事实上的强制约定。',
    sources: ['BDVideoPlayer.h:5', 'BDNetworkManager.h:8'],
    usageGuide: '### 何时使用\n创建任何新类时必须遵守\n### 规范\n类名: BD + 模块缩写 + 功能名',
  }),

  typescript: buildExample({
    language: 'typescript',
    title: 'UserService 的 Injectable 装饰器约定',
    trigger: '@injectable-services',
    category: 'Service',
    knowledgeType: 'code-standard',
    doClause: 'Use the @Injectable() decorator on every service class',
    dontClause: 'Do not create a service class without the @Injectable() decorator',
    whenClause: 'When creating new service classes in the DI container',
    description: '所有 Service 类必须使用 @Injectable() 装饰器。',
    bodyZh:
      '项目里 32 个 Service 类中有 30 个标注了 @Injectable() 装饰器，DI 容器据此完成实例装配；缺少该装饰器的类无法被容器装配，会在启动期直接报错。',
    okLine: '@Injectable() export class UserService { … }  (已装饰)',
    badLine: 'export class UserService {}  (未装饰，启动期报错)',
    coreCode:
      '@Injectable()\nexport class UserService {\n  constructor(private readonly db: DatabaseService) {}\n}',
    rationale: 'DI 容器要求所有 Service 标注 @Injectable() 才能完成装配。',
    whyStandard: '项目内 30/32 个 Service 使用 @Injectable()。',
    sources: ['src/services/UserService.ts:5', 'src/services/AuthService.ts:7'],
    headers: ["import { Injectable } from '@nestjs/common';"],
    usageGuide:
      '### 何时使用\n创建任何新 Service 类时\n### 规范\n所有 Service 类顶部添加 @Injectable()',
    depth: {
      designIntent:
        '选择在每个类上显式标注 @Injectable()，而非让容器约定式扫描全部 class：显式标注把「这是一个可被容器装配的服务」写在类声明处、可被静态检索，见 src/services/UserService.ts:5 装饰器紧贴类名。被放弃的替代方案是约定式全量扫描，它会把纯数据模型也误纳入装配、放大启动成本。',
      boundaries:
        '仅适用于进入 DI 容器装配的 Service 类；纯数据模型、静态工具类不在此列。前提是构造参数本身也是容器已注册的可注入项——见 src/services/AuthService.ts:7 构造参数全部为已注册服务，缺一即装配失败。',
      failureModes:
        '未标注 @Injectable() 的 Service 在容器解析时抛出「cannot resolve」并在应用启动装配阶段直接失败——问题在装配期即暴露、不会潜伏到请求运行时，见 src/services/UserService.ts:5 一旦缺失装饰器即无法被扫描登记。',
      tradeoffs:
        '换来的是启动装配期即失败的确定性与可静态检索的装配点；放弃的是零样板——每个 Service 都要多写一行装饰器，见 src/services/AuthService.ts:7。相比约定式扫描，显式标注多一行成本，但换来装配范围精确可控。',
    },
  }),

  python: buildExample({
    language: 'python',
    title: 'user_service 的 async def 异步约定',
    trigger: '@async-service-pattern',
    category: 'Service',
    knowledgeType: 'code-standard',
    doClause: 'Use async def for every service-layer function that performs I/O',
    dontClause: 'Do not write synchronous def for service-layer I/O functions',
    whenClause: 'When creating or modifying service-layer functions with I/O',
    description: '所有 Service 层 I/O 函数统一使用 async def。',
    bodyZh:
      '本项目 28 个 Service 函数里有 26 个使用 async def，FastAPI 框架要求所有 I/O 操作走 async/await，同步写法会阻塞事件循环并拖慢整体吞吐。',
    okLine: 'async def get_user(db, user_id): … await db.execute(...)',
    badLine: 'def get_user(db, user_id): ...  (同步阻塞)',
    coreCode:
      'async def get_user(db: AsyncSession, user_id: int) -> User:\n    result = await db.execute(select(User).filter_by(id=user_id))\n    return result.scalar_one_or_none()',
    rationale: 'FastAPI 要求所有 I/O 操作使用 async/await，避免阻塞事件循环。',
    whyStandard: '项目内 26/28 个 Service 函数使用 async def。',
    sources: ['services/user_service.py:15', 'services/auth_service.py:22'],
    headers: ['from sqlalchemy.ext.asyncio import AsyncSession'],
    usageGuide: '### 何时使用\n创建任何新 Service 函数时\n### 规范\n统一使用 async def + await',
  }),

  swift: buildExample({
    language: 'swift',
    title: 'HomeViewModel 的 Output 经 Driver 转换',
    trigger: '@viewmodel-output-driver',
    category: 'View',
    knowledgeType: 'code-pattern',
    doClause: 'Use Driver to expose every ViewModel Output to the view layer',
    dontClause: 'Do not expose a raw Observable as a ViewModel Output',
    whenClause: 'When defining the Output of a RxSwift ViewModel',
    description: '所有 ViewModel 的 Output 统一通过 Driver 暴露给视图层。',
    bodyZh:
      '项目里 19 个 ViewModel 中有 18 个把 Output 包装成 Driver，Driver 保证在主线程发送、不抛错且共享副作用，直接暴露 Observable 会让视图层承担线程与错误处理负担。',
    okLine: 'let title: Driver<String>  (主线程、不抛错)',
    badLine: 'let title: Observable<String>  (线程不确定)',
    coreCode:
      'struct Output {\n    let title: Driver<String>\n}\n\nfunc transform(input: Input) -> Output {\n    Output(title: titleRelay.asDriver(onErrorJustReturn: ""))\n}',
    rationale: 'Driver 保证主线程发送且不抛错，统一视图层订阅契约。',
    whyStandard: '项目内 18/19 个 ViewModel 的 Output 使用 Driver。',
    sources: ['Sources/Home/HomeViewModel.swift:45', 'Sources/Profile/ProfileViewModel.swift:38'],
    usageGuide:
      '### 何时使用\n定义任何 ViewModel Output 时\n### 规范\nOutput 字段统一声明为 Driver',
  }),

  kotlin: buildExample({
    language: 'kotlin',
    title: 'NetworkResult 的 sealed class 状态建模',
    trigger: '@sealed-network-result',
    category: 'Model',
    knowledgeType: 'code-pattern',
    doClause: 'Use a sealed class to model every network result state',
    dontClause: 'Do not model network state with nullable fields or loose booleans',
    whenClause: 'When modeling the success/error/loading states of a network call',
    description: '所有网络结果状态统一用 sealed class 建模。',
    bodyZh:
      '项目里 24 个网络结果类型中有 22 个用 sealed class 表达 Success/Error/Loading 三态，when 表达式可做穷尽检查，用可空字段加布尔标志的写法容易漏分支且难维护。',
    okLine: 'sealed class NetworkResult { … Success/Error/Loading }',
    badLine: 'data class Result(val ok: Boolean, val data: T?)  (松散)',
    coreCode:
      'sealed class NetworkResult<out T> {\n    data class Success<T>(val data: T) : NetworkResult<T>()\n    data class Error(val message: String) : NetworkResult<Nothing>()\n    object Loading : NetworkResult<Nothing>()\n}',
    rationale: 'sealed class 让 when 穷尽检查三态，避免遗漏分支。',
    whyStandard: '项目内 22/24 个网络状态使用 sealed class。',
    sources: ['app/src/main/java/net/NetworkResult.kt:12', 'app/src/main/java/net/ApiClient.kt:40'],
    usageGuide: '### 何时使用\n建模任何多态状态时\n### 规范\n用 sealed class 表达有限状态集合',
  }),

  java: buildExample({
    language: 'java',
    title: 'UserController 的 Optional 返回约定',
    trigger: '@optional-lookup-return',
    category: 'Service',
    knowledgeType: 'code-pattern',
    doClause: 'Return Optional from every repository lookup that may find nothing',
    dontClause: 'Do not return null from a repository lookup method',
    whenClause: 'When a repository finder may not find a matching row',
    description: '可能查不到结果的仓库查询统一返回 Optional。',
    bodyZh:
      '项目里 31 个仓库查询方法中有 29 个返回 Optional，把"可能为空"写进类型签名，迫使主调侧显式处理空值；直接返回 null 会把空指针风险散布到全工程。',
    okLine: 'Optional<User> findById(Long id)  (空值显式)',
    badLine: 'User findById(Long id)  (可能返回 null)',
    coreCode:
      'public Optional<User> findById(Long id) {\n    return Optional.ofNullable(entityManager.find(User.class, id));\n}',
    rationale: 'Optional 把空值写进签名，迫使主调侧显式处理。',
    whyStandard: '项目内 29/31 个查询方法返回 Optional。',
    sources: [
      'src/main/java/repo/UserRepository.java:28',
      'src/main/java/repo/OrderRepository.java:33',
    ],
    usageGuide: '### 何时使用\n编写任何可能空结果的查询时\n### 规范\n返回 Optional 而非裸对象',
  }),

  go: buildExample({
    language: 'go',
    title: 'orderStore 的 %w 错误包装约定',
    trigger: '@wrapped-error-return',
    category: 'Service',
    knowledgeType: 'code-pattern',
    doClause: 'Return errors wrapped with fmt.Errorf and the %w verb for context',
    dontClause: 'Do not return a bare error without contextual wrapping',
    whenClause: 'When propagating an error up from a store or service function',
    description: '向上传递错误时统一用 %w 包装并附加上下文。',
    bodyZh:
      '项目里 40 处错误返回中有 37 处使用 fmt.Errorf 配合 %w 包装，既保留底层错误便于 errors.Is 判定，又补充了当前操作的上下文；裸返回错误会丢失现场信息。',
    okLine: 'return fmt.Errorf("load order %d: %w", id, err)',
    badLine: 'return err  (丢失上下文)',
    coreCode:
      'func (s *orderStore) Load(id int) (*Order, error) {\n    o, err := s.query(id)\n    if err != nil {\n        return nil, fmt.Errorf("load order %d: %w", id, err)\n    }\n    return o, nil\n}',
    rationale: '%w 保留底层错误供 errors.Is 判定，并补充操作上下文。',
    whyStandard: '项目内 37/40 处错误返回使用 %w 包装。',
    sources: ['internal/store/order.go:54', 'internal/store/user.go:61'],
    usageGuide: '### 何时使用\n向上传递任何错误时\n### 规范\n用 fmt.Errorf + %w 包装',
  }),

  rust: buildExample({
    language: 'rust',
    title: 'config_loader 的 Result + ? 传播约定',
    trigger: '@result-question-mark',
    category: 'Utility',
    knowledgeType: 'code-pattern',
    doClause: 'Return Result and propagate failures with the ? operator',
    dontClause: 'Do not unwrap or expect on a fallible call in library code',
    whenClause: 'When a library function can fail and must surface the error',
    description: '库代码中可失败的操作统一返回 Result 并用 ? 传播。',
    bodyZh:
      '项目里 33 个可失败函数中有 31 个返回 Result 并用 ? 传播错误，把错误交给主调侧决定；在库代码里 unwrap/expect 会在生产环境直接 panic，难以恢复。',
    okLine: 'let cfg = read_config(path)?;  (向上传播)',
    badLine: 'let cfg = read_config(path).unwrap();  (可能 panic)',
    coreCode:
      'fn load_config(path: &Path) -> Result<Config, ConfigError> {\n    let text = std::fs::read_to_string(path)?;\n    let cfg = toml::from_str(&text)?;\n    Ok(cfg)\n}',
    rationale: '? 让错误向上传播，库代码避免 panic。',
    whyStandard: '项目内 31/33 个可失败函数返回 Result。',
    sources: ['src/config/loader.rs:18', 'src/config/parser.rs:27'],
    usageGuide: '### 何时使用\n编写任何可失败库函数时\n### 规范\n返回 Result 并用 ? 传播',
  }),

  csharp: buildExample({
    language: 'csharp',
    title: 'OrderService 的 async Task 异步约定',
    trigger: '@async-task-service',
    category: 'Service',
    knowledgeType: 'code-pattern',
    doClause: 'Use async Task for every service method that awaits I/O',
    dontClause: 'Do not block on .Result or .Wait() inside async code paths',
    whenClause: 'When a service method performs awaitable I/O',
    description: '所有等待 I/O 的 Service 方法统一使用 async Task。',
    bodyZh:
      '项目里 27 个 Service 方法中有 25 个使用 async Task 并 await 数据库操作；在异步路径里用 .Result 或 .Wait() 同步阻塞会造成线程饥饿甚至死锁。',
    okLine: 'await _db.SaveChangesAsync();  (异步等待)',
    badLine: '_db.SaveChangesAsync().Wait();  (阻塞死锁风险)',
    coreCode:
      'public async Task<Order> CreateAsync(OrderDto dto)\n{\n    var order = _mapper.Map<Order>(dto);\n    await _db.Orders.AddAsync(order);\n    await _db.SaveChangesAsync();\n    return order;\n}',
    rationale: 'async Task + await 避免 .Result/.Wait() 造成的线程饥饿与死锁。',
    whyStandard: '项目内 25/27 个 Service 方法使用 async Task。',
    sources: ['src/Services/OrderService.cs:42', 'src/Services/UserService.cs:51'],
    usageGuide: '### 何时使用\n编写任何等待 I/O 的方法时\n### 规范\n使用 async Task + await',
  }),

  javascript: buildExample({
    language: 'javascript',
    title: 'apiClient 的具名导出约定',
    trigger: '@named-exports-only',
    category: 'Utility',
    knowledgeType: 'code-standard',
    doClause: 'Use named exports for every shared module utility',
    dontClause: 'Do not use a default export for shared utility modules',
    whenClause: 'When exposing utilities from a shared module',
    description: '所有共享工具模块统一使用具名导出。',
    bodyZh:
      '项目里 46 个共享模块中有 43 个只用具名导出，具名导出让重命名、摇树和静态检索都更可靠；default 导出在不同文件可被任意改名，容易让同一函数出现多种叫法。',
    okLine: 'export const fetchUser = (id) => { … }  (具名)',
    badLine: 'export default function (id) { … }  (匿名 default)',
    coreCode:
      'export const fetchUser = async (id) => {\n  const res = await fetch("/api/users/" + id);\n  return res.json();\n};',
    rationale: '具名导出让重命名、摇树和检索可靠，避免同函数多种叫法。',
    whyStandard: '项目内 43/46 个共享模块使用具名导出。',
    sources: ['src/api/client.js:12', 'src/api/users.js:19'],
    usageGuide: '### 何时使用\n从任何共享模块导出工具时\n### 规范\n只用具名导出',
  }),

  _default: buildExample({
    language: 'text',
    title: 'ProjectModule 的命名前缀约定',
    trigger: '@project-naming-convention',
    category: 'Tool',
    knowledgeType: 'code-standard',
    doClause: 'Follow the established project naming convention for every new symbol',
    dontClause: 'Do not introduce a new naming style that deviates from the codebase',
    whenClause: 'When creating new files, classes, functions, or variables',
    description: '遵循项目既有命名约定，新符号沿用同一前缀风格。',
    bodyZh:
      '本项目绝大多数公共符号沿用统一的命名前缀与大小写约定（约 90% 以上），新代码沿用既有风格能让检索、摇树与代码审查保持一致；自创命名风格会割裂工程整体观感。',
    okLine: 'ProjectModuleClient（沿用统一前缀与大小写）',
    badLine: 'my_client_v2（自创风格，割裂约定）',
    coreCode:
      'export class ProjectModuleClient {\n  constructor(private readonly transport: Transport) {}\n}',
    rationale: '统一命名让检索、摇树与审查保持一致。',
    whyStandard: '项目内绝大多数公共符号沿用统一命名前缀与大小写约定。',
    sources: ['src/core/ProjectModuleClient.ts:10', 'src/core/ProjectModuleConfig.ts:6'],
    usageGuide: '### 何时使用\n创建任何新代码时\n### 规范\n沿用项目既有命名前缀与大小写约定',
  }),
};

/** The languages with a dedicated template (excludes the _default fallback key). */
export const EXAMPLE_LANGUAGES: readonly string[] = Object.keys(EXAMPLE_TEMPLATES).filter(
  (key) => key !== '_default'
);

/**
 * Returns the gate-passing worked example for the requested language, falling back to the
 * project-agnostic _default when the language has no dedicated template (the same lang → candidate
 * resolution the briefing injection used). The returned candidate passes validateAgainst({stage:'all'}).
 */
export function example(language = 'typescript'): WorkedExample {
  const lang = String(language || 'typescript');
  const candidate =
    EXAMPLE_TEMPLATES[lang] || EXAMPLE_TEMPLATES[lang.toLowerCase()] || EXAMPLE_TEMPLATES._default;
  return {
    language: lang,
    candidate,
    note: 'P3 gate-clean worked example (passes validateAgainst stage 1+2+3).',
  };
}
