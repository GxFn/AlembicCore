/**
 * Mission Briefing 构建器 — 宿主 Agent 驱动 Bootstrap 的核心数据构建
 *
 * 将 ProjectContext 给出的项目信息（目标、依赖图、层与热点、本地包）
 * + 维度定义 + 提交规范 + 执行计划 整合为一站式 Mission Briefing，
 * 让宿主 Agent (Cursor/Copilot) 拥有全部必要上下文来完成代码分析。
 *
 * 设计原则：
 *   - 100KB 响应硬上限，大项目自动降级压缩
 *   - 文件内容永远不包含 → Agent 自己读更快
 *   - Example 按项目主语言自适应
 *   - Tier 编号使用 1/2/3（与 tier-scheduler.js 一致）
 *
 * @module bootstrap/MissionBriefingBuilder
 */

import { buildDimensionSubmissionSpec } from '../../../../domain/dimension/DimensionCatalogPayload.js';
import { getDimensionSOP } from '../../../../domain/dimension/DimensionSop.js';
// P3 §C.9: the worked examples moved DOWN into the RecipeAuthoringSpec module; consume them via
// example(lang) from the knowledge module (NOT EXAMPLE_TEMPLATES through the host-agent facade).
import { example as recipeExample } from '../../../../domain/knowledge/recipe-authoring-spec/index.js';
import {
  buildProjectContextPresenterInput,
  type ProjectContextEnvelope,
  type ProjectContextPresenterInput,
  type ProjectContextResult,
} from '../../../../domain/project-context/index.js';
import type {
  DependencyGraph,
  DimensionDef,
  LocalPackageModule,
} from '../../../../types/ProjectSnapshot.js';
import { TierScheduler } from '../../planning/dimensions/TierScheduler.js';
import { buildEvidenceStarters } from './EvidenceStarterBuilder.js';
import {
  applyBriefingCompressionPolicy,
  type BriefingProfile,
  buildExecutionInstructions,
  createBriefingPlan,
  projectRescanEvidenceHints,
  type RescanBriefingInput,
  type ResponseBudget,
  SUBMISSION_SCHEMA,
} from './MissionBriefingSupport.js';

// ── 本地类型定义 ────────────────────────────────────────────

/** Guard rule 聚合条目 */
interface RuleMapEntry {
  ruleId: string;
  count: number;
  example: string | null;
}

/** 维度任务 (enrichDimensionTask 返回值) */
interface DimensionTask {
  id: string;
  label?: string;
  tier: number;
  outputType: string;
  status: string;
  analysisGuide: string | Record<string, unknown>;
  submissionSpec: { preSubmitChecklist?: Record<string, unknown>; [key: string]: unknown };
  skillMeta?: { name: string; description: string; format: string };
  evidenceStarters?: Record<string, { hint: string; data: unknown }>;
}

/** Target 信息 */
interface TargetInfo {
  name: string;
  type?: string;
  inferredRole?: string;
  fileCount?: number;
}

/** 压缩后的协议 */
interface CompressedProtocol {
  name: string;
  file?: string | null;
  methodCount: number;
  conformers?: string[];
}

/** 压缩后的 AST 类 */
interface CompressedAstClass {
  name: string;
  kind?: string;
  superclass?: string | null;
  file?: string | null;
  methodCount: number;
  protocols?: string[];
}

/** Mission Briefing 结构 */
interface MissionBriefing {
  projectMeta: Record<string, unknown>;
  ast: {
    available: boolean;
    compressionLevel?: string;
    summary?: string | { text: string; kindDistribution: Record<string, number>; insight: string };
    classes: CompressedAstClass[];
    protocols: CompressedProtocol[];
    categories?: { baseClass?: string; name: string; file?: string | null; methods: string[] }[];
    patterns?: Record<string, unknown>;
    metrics?: {
      totalMethods?: number;
      avgMethodsPerClass?: number;
      maxNestingDepth?: number;
      complexMethods?: number;
      longMethods?: number;
    } | null;
  };
  architectureOverview?: {
    style: string;
    layers: { name: string; modules: string[]; fileCount: number; role: string }[];
    externalDeps: { name: string; role: string }[];
    keyInsights: string[];
  } | null;
  technologyStack?: { name: string; role: string; usedBy: string[] }[] | null;
  keyAbstractions?:
    | {
        name: string;
        kind: string;
        module: string;
        significance: string;
        detail: string;
      }[]
    | null;
  codeEntityGraph: { totalEntities: number; totalEdges: number } | null;
  callGraph: { methodEntities: number; callEdges: number; durationMs: number } | null;
  dependencyGraph: {
    nodes: { id: string; label: string; fileCount?: number; dependentCount?: number }[];
    edges: unknown[];
  } | null;
  guardFindings: {
    totalViolations: number;
    errors: number;
    warnings: number;
    topViolations: RuleMapEntry[];
  } | null;
  targets: { name: string; type: string; inferredRole?: string; fileCount?: number }[];
  dimensions: DimensionTask[];
  languageExtension: unknown;
  submissionSchema: Record<string, unknown>;
  languageStats: Record<string, number> | null;
  executionPlan: { tiers: unknown[]; totalDimensions: number; workflow: string };
  panorama: {
    layers: Array<{ level: number; name: string; modules: string[] }>;
    couplingHotspots: Array<{ module: string; fanIn: number; fanOut: number }>;
    cyclicDependencies: Array<{ cycle: string[]; severity: string }>;
    knowledgeGaps: Array<{
      dimension: string;
      dimensionName: string;
      recipeCount: number;
      status: string;
      priority: string;
    }>;
  } | null;
  mustCoverModules: {
    totalLocalPackages: number;
    modules: {
      name: string;
      packageName: string;
      fileCount: number;
      inferredRole?: string;
      keyFiles: string[];
    }[];
    instruction: string;
  } | null;
  session: Record<string, unknown>;
  meta?: {
    responseSizeKB?: number;
    compressionLevel?: string;
    warnings?: string[];
    profile?: BriefingProfile;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** buildMissionBriefing 参数 */
interface MissionBriefingParams {
  projectMeta: Record<string, unknown>;
  depGraphData?: DependencyGraph | null;
  targets?: (string | TargetInfo)[];
  activeDimensions: DimensionDef[];
  session: { toJSON(): Record<string, unknown> };
  languageExtension?: unknown;
  languageStats?: Record<string, number> | null;
  panoramaResult?: Record<string, unknown> | null;
  localPackageModules?: LocalPackageModule[];
  profile?: BriefingProfile;
  rescan?: RescanBriefingInput;
  responseBudget?: Partial<ResponseBudget>;
}

export interface ProjectContextMissionBriefingInput {
  projectContext:
    | ProjectContextPresenterInput
    | readonly ProjectContextEnvelope<ProjectContextResult>[];
  activeDimensions: DimensionDef[];
  session: { toJSON(): Record<string, unknown> };
  projectMeta?: Record<string, unknown>;
  languageExtension?: unknown;
  profile?: BriefingProfile;
  rescan?: RescanBriefingInput;
  responseBudget?: Partial<ResponseBudget>;
}

// ── 维度指引构建 ────────────────────────────────────────────

/**
 * 将 base-dimensions 中的维度定义转换为 Mission Briefing 中的维度任务对象
 *
 * 取自 bootstrap-analyst.buildAnalystPrompt() + DIMENSION_CONFIGS_V3 + StyleGuide
 *
 * @param dim base-dimensions.js 中的维度定义
 * @param tier 维度所在 tier 编号 (1/2/3)
 * @returns Mission Briefing 维度任务对象
 */
function enrichDimensionTask(dim: DimensionDef, tier: number): DimensionTask {
  // ── analysisGuide: SOP 化 — 优先使用维度专属 SOP，否则回退通用指引 ──
  const sop = getDimensionSOP(dim.id);
  let analysisGuide: {
    goal: string;
    focus: string;
    steps: Array<Record<string, unknown>>;
    timeEstimate: string;
    commonMistakes: string[];
  };

  if (sop) {
    // SOP 结构化模式: steps + timeEstimate + commonMistakes
    analysisGuide = {
      goal: `分析项目的${dim.label}`,
      focus: dim.guide || '',
      steps: sop.steps,
      timeEstimate: sop.timeEstimate || '1-5 min',
      commonMistakes: sop.commonMistakes || [],
    };
  } else {
    // 无显式 SOP 的维度 (Enhancement Pack 等): 自动生成结构化 SOP
    // 保持 analysisGuide 为对象格式，确保 SOP 覆盖率
    analysisGuide = {
      goal: `分析项目的${dim.label}`,
      focus: dim.guide || '',
      steps: [
        {
          phase: '1. 全局扫描',
          action: `搜索项目中与 ${dim.label} 相关的核心文件和关键模式`,
          expectedOutput: '识别 3-5 个核心文件和主要模式',
          tools: ['grep_search 搜索关键词', '浏览核心目录结构'],
        },
        {
          phase: '2. 深度验证',
          action: `阅读 5+ 个核心文件，验证 ${dim.label} 的实现方式是否一致`,
          expectedOutput: '每个模式至少有 3 个文件证据，含具体行号',
          tools: ['code({ action: "read" }) 逐个阅读核心文件'],
        },
        {
          phase: '3. 异常检测',
          action: '搜索不符合主流模式的例外，确认是否为历史遗留或特殊例外',
          expectedOutput: '识别例外模式及其原因',
        },
        {
          phase: '4. 提交',
          action:
            '按项目特写格式提交知识候选（**最少 3 条，目标 5 条**，将不同关注点拆为独立候选）',
          qualityChecklist: [
            '候选数量 ≥3（1-2 条是不合格的，不同关注点必须拆分为独立候选）',
            '每个 content ≥200 字符',
            '每个候选引用 ≥3 个文件路径',
            'coreCode 提供可复制的完整代码骨架',
          ],
        },
      ],
      timeEstimate: '1-5 min',
      commonMistakes: [
        '不要只扫描 1 个文件就提交 — 至少读 5+ 个文件验证模式一致性',
        'content 中必须有 (来源: Full/Path/FileName.ext:行号) 标注具体出处，必须是从项目根开始的完整相对路径',
        '【跨维度去重】每条候选必须属于当前维度的独有视角 — 禁止将同一知识点换个角度重复提交到多个维度来充数，宁可少提交也不要重复',
        '【本地子包覆盖】如果项目有本地子包/模块（如 Packages/ 下的包），必须同时分析其内部实现，不得只看主项目对其的调用',
      ],
    };
  }

  // ── submissionSpec: 唯一真源（P2.1 collapse）──
  // 与 DimensionCatalogPayload 共用同一个由 RecipeAuthoringSpec 模块喂入的构建器：候选下限统一为 >=3、
  // 并显式列出真实祈使动词白名单与 >=3 distinct-files 证据下限，使指引==门禁（guidance==gate）。
  const submissionSpec = buildDimensionSubmissionSpec(dim.knowledgeTypes || []);

  // ── skillMeta ──
  const sm = dim.skillMeta as { name?: string; description?: string } | null | undefined;
  const skillMeta = dim.skillWorthy
    ? {
        name: sm?.name || `project-${dim.id}`,
        description: sm?.description || `${dim.label} skill (auto-generated)`,
        format: 'Markdown 正文，需包含 # 标题、列表、代码块等结构化内容，≥100 字符',
      }
    : undefined;

  return {
    id: dim.id,
    label: dim.label,
    tier, // 1/2/3 与 tier-scheduler.js 一致
    outputType: dim.dualOutput ? 'dual' : dim.skillWorthy ? 'skill' : 'candidate',
    status: 'pending',
    analysisGuide,
    // fresh-literal spread bridges the strict DimensionSubmissionSpec to the loose, mutable
    // briefing-task shape the compaction view (CompressibleDimensionTask) needs.
    submissionSpec: { ...submissionSpec },
    skillMeta,
  };
}

export { buildEvidenceStarters } from './EvidenceStarterBuilder.js';

// ── Architecture Overview 自动推断 ────────────────────────

/** 知名外部依赖的角色映射 */
const KNOWN_DEPENDENCIES: Record<string, string> = {
  // Swift / iOS
  alamofire: 'HTTP networking',
  moya: 'Network abstraction over Alamofire',
  rxswift: 'Reactive programming (ReactiveX)',
  rxcocoa: 'RxSwift UIKit bindings',
  combine: 'Apple reactive framework',
  kingfisher: 'Image downloading & caching',
  sdwebimage: 'Image downloading & caching',
  snapkit: 'Auto Layout DSL',
  lottie: 'Animation rendering',
  realm: 'Mobile database',
  coredata: 'Apple persistence framework',
  swiftui: 'Declarative UI framework',
  // JavaScript / TypeScript
  react: 'UI component framework',
  vue: 'Progressive UI framework',
  angular: 'Full-featured UI framework',
  express: 'HTTP server framework',
  nestjs: 'Enterprise Node.js framework',
  axios: 'HTTP client',
  prisma: 'Database ORM',
  sequelize: 'SQL ORM',
  mongoose: 'MongoDB ODM',
  tailwindcss: 'Utility-first CSS',
  webpack: 'Module bundler',
  vite: 'Frontend build tool',
  jest: 'Testing framework',
  vitest: 'Vite-native testing',
  redux: 'State management',
  zustand: 'Lightweight state management',
  // Go
  gin: 'HTTP web framework',
  echo: 'HTTP web framework',
  gorm: 'Go ORM',
  cobra: 'CLI framework',
  // Python
  django: 'Full-stack web framework',
  flask: 'Micro web framework',
  fastapi: 'Async web framework',
  sqlalchemy: 'SQL toolkit & ORM',
  pytorch: 'Deep learning framework',
  tensorflow: 'Machine learning framework',
  pandas: 'Data analysis library',
  numpy: 'Numerical computing',
};

/**
 * 从 targets + depGraph + localPackageModules 自动推断架构概览
 */
function buildArchitectureOverview(
  targets: MissionBriefing['targets'],
  depGraphData: DependencyGraph | null,
  localPackageModules?: LocalPackageModule[]
): MissionBriefing['architectureOverview'] {
  if (!targets || targets.length === 0) {
    return null;
  }

  // ── 分层: 按 inferredRole 分组 ──
  const roleGroups: Record<string, { modules: string[]; fileCount: number }> = {};
  for (const t of targets) {
    const role = t.inferredRole || 'unknown';
    if (!roleGroups[role]) {
      roleGroups[role] = { modules: [], fileCount: 0 };
    }
    roleGroups[role].modules.push(t.name);
    roleGroups[role].fileCount += t.fileCount || 0;
  }

  // 层级命名映射
  const ROLE_LAYER_MAP: Record<string, { name: string; priority: number; role: string }> = {
    app: {
      name: 'App Shell',
      priority: 0,
      role: 'Application entry point, coordinators, DI assembly',
    },
    core: {
      name: 'Core Infrastructure',
      priority: 2,
      role: 'Shared infrastructure libraries, base classes, utilities',
    },
    networking: {
      name: 'Networking',
      priority: 2,
      role: 'Network client, middleware, API definitions',
    },
    feature: {
      name: 'Feature Modules',
      priority: 1,
      role: 'Per-feature UI, view models, business logic',
    },
    ui: { name: 'UI Components', priority: 2, role: 'Shared UI components, themes, extensions' },
    test: { name: 'Tests', priority: 3, role: 'Unit tests, integration tests, mocks' },
    unknown: { name: 'Other', priority: 3, role: 'Uncategorized modules' },
  };

  const layers: { name: string; modules: string[]; fileCount: number; role: string }[] = [];
  for (const [role, group] of Object.entries(roleGroups)) {
    if (role === 'test') {
      continue;
    } // 测试模块不加入架构层
    const layerDef = ROLE_LAYER_MAP[role] || ROLE_LAYER_MAP.unknown;
    // 合并同优先级的层
    const existing = layers.find((l) => l.name === layerDef.name);
    if (existing) {
      existing.modules.push(...group.modules);
      existing.fileCount += group.fileCount;
    } else {
      layers.push({
        name: layerDef.name,
        modules: [...group.modules],
        fileCount: group.fileCount,
        role: layerDef.role,
      });
    }
  }
  // 按 priority 排序 (App Shell → Features → Core → Other)
  layers.sort((a, b) => {
    const pa = Object.values(ROLE_LAYER_MAP).find((v) => v.name === a.name)?.priority ?? 99;
    const pb = Object.values(ROLE_LAYER_MAP).find((v) => v.name === b.name)?.priority ?? 99;
    return pa - pb;
  });

  // ── 外部依赖识别 ──
  const externalDeps: { name: string; role: string }[] = [];
  const localModuleNames = new Set(targets.map((t) => t.name));
  if (depGraphData?.nodes) {
    for (const n of depGraphData.nodes) {
      const id = typeof n === 'string' ? n : n.id || '';
      const label = typeof n === 'string' ? n : n.label || id;
      if (!localModuleNames.has(id) && !localModuleNames.has(label)) {
        const knownRole = KNOWN_DEPENDENCIES[label.toLowerCase()];
        externalDeps.push({
          name: label,
          role: knownRole || 'third-party dependency',
        });
      }
    }
  }

  // ── 关键洞察 ──
  const insights: string[] = [];
  const totalFiles = targets.reduce((s, t) => s + (t.fileCount || 0), 0);
  const featureGroup = roleGroups.feature;
  const coreGroup = roleGroups.core;
  const networkGroup = roleGroups.networking;

  // 本地子包占比
  if (localPackageModules && localPackageModules.length > 0) {
    const pkgFiles = localPackageModules.reduce((s, m) => s + m.fileCount, 0);
    const pct = totalFiles > 0 ? Math.round((pkgFiles / totalFiles) * 100) : 0;
    insights.push(
      `${localPackageModules.length} local packages provide ${pct}% of the codebase (${pkgFiles}/${totalFiles} files)`
    );
  }

  // Feature 模块特征
  if (featureGroup) {
    const avgFiles = Math.round(featureGroup.fileCount / featureGroup.modules.length);
    if (avgFiles <= 5) {
      insights.push(
        `Feature modules are thin (avg ${avgFiles} files) — business logic likely concentrates in core infrastructure`
      );
    } else {
      insights.push(
        `Feature modules average ${avgFiles} files each — self-contained feature architecture`
      );
    }
  }

  // 最大基础设施模块
  if (coreGroup || networkGroup) {
    const infraModules = [...(coreGroup?.modules || []), ...(networkGroup?.modules || [])];
    const heaviest = targets
      .filter((t) => infraModules.includes(t.name))
      .sort((a, b) => (b.fileCount || 0) - (a.fileCount || 0));
    if (heaviest.length > 0 && heaviest[0].fileCount) {
      insights.push(
        `${heaviest[0].name} (${heaviest[0].fileCount} files) is the heaviest infrastructure module`
      );
    }
  }

  // 推断架构风格
  let style = 'Monolithic application';
  if (localPackageModules && localPackageModules.length >= 2) {
    style = 'Modular monolith (local packages)';
  } else if (targets.length >= 5 && featureGroup && featureGroup.modules.length >= 3) {
    style = 'Feature-modular architecture';
  }

  return { style, layers, externalDeps, keyInsights: insights };
}

/**
 * 从外部依赖图中提取技术栈信息
 */
function buildTechnologyStack(
  depGraphData: DependencyGraph | null,
  targets: MissionBriefing['targets']
): MissionBriefing['technologyStack'] {
  if (!depGraphData?.nodes || !depGraphData?.edges) {
    return null;
  }

  const localModuleNames = new Set(targets.map((t) => t.name));
  const stack: { name: string; role: string; usedBy: string[] }[] = [];

  for (const n of depGraphData.nodes) {
    const id = typeof n === 'string' ? n : n.id || '';
    const label = typeof n === 'string' ? n : n.label || id;
    if (localModuleNames.has(id) || localModuleNames.has(label)) {
      continue;
    }
    const role = KNOWN_DEPENDENCIES[label.toLowerCase()] || 'third-party dependency';
    // 找出哪些模块依赖它
    const usedBy = (depGraphData.edges || [])
      .filter((e) => {
        const edge = e as { to?: string; from?: string };
        return edge.to === id || edge.to === label;
      })
      .map((e) => (e as { from: string }).from)
      .filter((f) => localModuleNames.has(f))
      .slice(0, 5);
    stack.push({ name: label, role, usedBy });
  }

  return stack.length > 0 ? stack : null;
}

// ── Panorama 摘要构建 ──────────────────────────────────────

/**
 * 从 PanoramaResult 提取 layers / couplingHotspots / cycles / gaps
 * 用于注入 MissionBriefing，使宿主 Agent 获得项目全景视野
 */
// ── 本地子包/模块 — mustCoverModules ────────────────────────

/**
 * 构建 mustCoverModules 段落 — 标记来自本地子包的基础设施模块
 *
 * 语言无关：只依赖 Discoverer 返回的 target metadata 中的 isLocalPackage 标记。
 * 无论 SPM (Swift)、monorepo (TS)、Gradle subproject (Java/Kotlin)，
 * 只要某 target 来自非主 projectRoot 的子目录，就被视为本地子包。
 *
 * @param localPackageModules Phase 1 收集的子包信息
 * @returns mustCoverModules 段落
 */
function buildMustCoverModules(
  localPackageModules?: LocalPackageModule[]
): MissionBriefing['mustCoverModules'] {
  if (!localPackageModules || localPackageModules.length === 0) {
    return null;
  }
  return {
    totalLocalPackages: localPackageModules.length,
    modules: localPackageModules.map((m) => ({
      name: m.name,
      packageName: m.packageName,
      fileCount: m.fileCount,
      inferredRole: m.inferredRole,
      keyFiles: m.keyFiles || [],
    })),
    instruction:
      '【强制覆盖】以下本地子包/模块是项目的基础设施层，包含核心抽象和共享服务。' +
      '每个维度分析时必须同时覆盖主项目代码和这些子包代码。' +
      '提交的知识候选中必须包含子包源码的完整相对路径和行号（如 Packages/AOXNetworkKit/Sources/.../NetworkClient.swift:42），' +
      '不得仅引用主项目中对子包的调用，而忽略子包内部的实现细节。' +
      '对于 architecture、code-pattern、best-practice 维度，至少要有 1 条候选直接引用子包的核心实现文件。',
  };
}

function summarizePanorama(
  panoramaResult: Record<string, unknown> | null
): MissionBriefing['panorama'] {
  if (!panoramaResult) {
    return null;
  }
  try {
    // ProjectContext/snapshot 已归一为数组；旧扫描结果仍使用 levels/Map/cycles。
    // 在此统一形状再应用同一预算，避免已有结构事实被当作空结果。
    const layerHierarchy = panoramaResult.layers as
      | { levels?: Array<{ level: number; name: string; modules: string[] }> }
      | Array<{ level: number; name: string; modules: string[] }>
      | undefined;
    const layers = Array.isArray(layerHierarchy) ? layerHierarchy : (layerHierarchy?.levels ?? []);

    // PanoramaResult.modules: Map<string, PanoramaModule>
    const modules = panoramaResult.modules as
      | Map<string, { name: string; fanIn: number; fanOut: number }>
      | undefined;
    const normalizedHotspots = Array.isArray(panoramaResult.couplingHotspots)
      ? (panoramaResult.couplingHotspots as Array<{
          module: string;
          fanIn: number;
          fanOut: number;
        }>)
      : null;
    const couplingHotspots = normalizedHotspots ? [...normalizedHotspots] : [];
    if (!normalizedHotspots && modules instanceof Map) {
      for (const [, mod] of modules) {
        if (mod.fanIn >= 10 || mod.fanOut >= 10) {
          couplingHotspots.push({ module: mod.name, fanIn: mod.fanIn, fanOut: mod.fanOut });
        }
      }
      couplingHotspots.sort((a, b) => b.fanIn + b.fanOut - (a.fanIn + a.fanOut));
    }

    // PanoramaResult.cycles: CyclicDependency[]
    const cycles = (panoramaResult.cyclicDependencies ?? panoramaResult.cycles ?? []) as Array<{
      cycle: string[];
      severity: string;
    }>;

    // PanoramaResult.gaps: KnowledgeGap[] (dimension-based)
    const gaps =
      ((panoramaResult.knowledgeGaps ?? panoramaResult.gaps) as Array<{
        dimension: string;
        dimensionName: string;
        recipeCount: number;
        status: string;
        priority: string;
      }>) ?? [];

    return {
      layers: layers.slice(0, 10),
      couplingHotspots: couplingHotspots.slice(0, 10),
      cyclicDependencies: cycles.slice(0, 10),
      knowledgeGaps: gaps.slice(0, 20),
    };
  } catch {
    return null;
  }
}

// ── Mission Briefing 主构建函数 ──────────────────────────────

/**
 * 构建 Mission Briefing
 *
 * 项目信息来自 ProjectContext（见 buildProjectContextMissionBriefing）。旧的项目快照输入
 * （AST 汇总、实体图、调用图、Guard 审计、增量计划）已没有生产方，对应的入参与汇总逻辑已删除；
 * 简报里的 `ast`、`keyAbstractions`、`codeEntityGraph`、`callGraph`、`guardFindings` 这几个键
 * 仍然保留，取值固定为"没有这类数据"，宿主读到的形状不变。
 *
 * @param opts.projectMeta 项目元数据
 * @param opts.depGraphData 模块依赖图
 * @param opts.targets 目标列表
 * @param opts.activeDimensions signal-aware dimension selection result
 * @param opts.skills 已加载的 bootstrap skills
 * @param opts.session GenerateSession 实例
 * @returns Mission Briefing 响应数据
 */
export function buildMissionBriefing({
  projectMeta,
  depGraphData,
  targets,
  activeDimensions,
  session,
  languageExtension, // §7.1: 语言扩展（反模式、Guard 规则、Agent 注意事项）
  languageStats, // §7.4: 完整语言分布统计
  panoramaResult, // §M1: Phase 1.8 全景数据
  localPackageModules, // 本地子包模块信息
  profile,
  rescan,
  responseBudget,
}: MissionBriefingParams) {
  const briefingPlan = createBriefingPlan({ profile, rescan, responseBudget });
  const scheduler = new TierScheduler();

  // ── 构建维度任务列表 (v2: 附带 evidenceStarters) ──
  const dimensions = activeDimensions.map((dim: DimensionDef) => {
    const tierIndex = scheduler.getTierIndex(dim.id);
    // 优先使用 DEFAULT_TIERS 定义；未定义则取 tierHint；兜底 Tier 1
    const tier =
      tierIndex >= 0 ? tierIndex + 1 : typeof dim.tierHint === 'number' ? dim.tierHint : 1;
    const task: DimensionTask = enrichDimensionTask(dim, tier);

    // v2: 从依赖图与全景数据中提取维度相关的证据启发
    const evidenceStarters = buildEvidenceStarters(dim, {
      depGraphData,
      panoramaResult,
    });
    if (evidenceStarters) {
      task.evidenceStarters = evidenceStarters;
    }

    return task;
  });

  // ── 选择语言自适应的 example（gate-clean，来自 RecipeAuthoringSpec 模块）──
  const lang = String(projectMeta.primaryLanguage || 'text');
  const example = recipeExample(lang).candidate;

  // ── 组装 ──

  // ── 依赖图节点去重 ──
  const dedupedDepNodes: {
    id: string;
    label: string;
    fileCount?: number;
    dependentCount?: number;
  }[] = [];
  if (depGraphData?.nodes) {
    const nodeMap = new Map<
      string,
      { id: string; label: string; fileCount?: number; dependentCount: number }
    >();
    for (const n of depGraphData.nodes) {
      const id = typeof n === 'string' ? n : n.id || '';
      const label = typeof n === 'string' ? n : n.label || id;
      const fileCount = typeof n === 'string' ? undefined : n.fileCount;
      if (!nodeMap.has(id)) {
        nodeMap.set(id, { id, label, fileCount, dependentCount: 0 });
      } else {
        const existingNode = nodeMap.get(id);
        if (fileCount && existingNode && !existingNode.fileCount) {
          existingNode.fileCount = fileCount;
        }
      }
    }
    // 计算每个节点被多少模块依赖（fan-in）
    for (const e of depGraphData.edges || []) {
      const edge = e as { to?: string };
      if (edge.to && nodeMap.has(edge.to)) {
        const targetNode = nodeMap.get(edge.to);
        if (targetNode) {
          targetNode.dependentCount++;
        }
      }
    }
    for (const node of nodeMap.values()) {
      dedupedDepNodes.push(node);
    }
  }

  // ── targets 构建 ──
  const builtTargets = (targets || []).map((t: string | TargetInfo) => ({
    name: typeof t === 'string' ? t : t.name,
    type: typeof t === 'string' ? 'target' : t.type || 'target',
    inferredRole: typeof t === 'string' ? undefined : t.inferredRole,
    fileCount: typeof t === 'string' ? undefined : t.fileCount,
  }));

  const briefing: MissionBriefing = {
    projectMeta,

    // 没有 AST 汇总的生产方；键与空形状保留给读这个字段的宿主。
    ast: { available: false, classes: [], protocols: [], categories: [], patterns: {} },

    // 高层次架构概览 — Agent 一目了然项目结构
    architectureOverview: buildArchitectureOverview(
      builtTargets,
      depGraphData ?? null,
      localPackageModules
    ),

    // 技术栈 — 外部依赖的角色识别
    technologyStack: buildTechnologyStack(depGraphData ?? null, builtTargets),

    // 关键抽象 — Agent 优先分析的核心类/协议
    keyAbstractions: null,

    codeEntityGraph: null,

    callGraph: null,

    dependencyGraph:
      dedupedDepNodes.length > 0
        ? {
            nodes: dedupedDepNodes,
            edges: (depGraphData?.edges || []).slice(0, 100),
          }
        : null,

    guardFindings: null,

    targets: builtTargets,

    dimensions,

    // §7.1: 语言扩展信息 (反模式、Guard 规则、Agent 注意事项)
    languageExtension: languageExtension || null,

    submissionSchema: {
      ...SUBMISSION_SCHEMA,
      example,
    },

    // 完整语言统计（按文件扩展名计数）
    languageStats: languageStats || null,

    executionPlan: buildExecutionInstructions({
      activeDimensions,
      profile: briefingPlan.profile,
      rescan: briefingPlan.rescan,
    }),

    panorama: summarizePanorama(panoramaResult ?? null),

    // 本地子包/模块 — 必须覆盖的基础设施模块
    mustCoverModules: buildMustCoverModules(localPackageModules),

    session: session.toJSON(),
  };

  if (briefingPlan.profile === 'rescan-host-agent' && briefingPlan.rescan) {
    briefing.evidenceHints = projectRescanEvidenceHints(briefingPlan.rescan);
  }

  applyBriefingCompressionPolicy(briefing, briefingPlan.responseBudget);
  briefing.meta = { ...briefing.meta, profile: briefingPlan.profile };

  return briefing;
}

export function buildProjectContextMissionBriefing({
  projectContext,
  activeDimensions,
  session,
  projectMeta,
  languageExtension,
  profile,
  rescan,
  responseBudget,
}: ProjectContextMissionBriefingInput): MissionBriefing {
  const presenterInput = normalizeProjectContextPresenterInput(projectContext);
  const briefing = buildMissionBriefing({
    projectMeta: {
      ...buildProjectContextProjectMeta(presenterInput),
      ...projectMeta,
      projectInformationSource: 'project-context',
    },
    targets: buildProjectContextTargets(presenterInput),
    activeDimensions,
    session,
    languageExtension: languageExtension ?? null,
    languageStats: buildProjectContextLanguageStats(presenterInput),
    depGraphData: buildProjectContextDependencyGraph(presenterInput),
    localPackageModules: buildProjectContextLocalPackageModules(presenterInput),
    panoramaResult: buildProjectContextPanoramaReplacement(presenterInput),
    profile,
    rescan,
    responseBudget,
  }) as MissionBriefing;

  briefing.projectContext = {
    source: 'project-context',
    project: presenterInput.project,
    refs: presenterInput.refs.map((ref) => ({
      id: ref.id,
      kind: ref.kind,
      label: ref.label,
      filePath: ref.scope.filePath,
      range: ref.scope.range,
      repoId: ref.scope.repoId,
    })),
    sourceFiles: presenterInput.files.map((file) => ({
      filePath: file.filePath,
      repoId: file.repoId,
      language: file.language,
      lineCount: file.lineCount,
    })),
    unavailable: presenterInput.unavailable,
    warnings: presenterInput.warnings,
  };
  briefing.meta = {
    ...briefing.meta,
    projectInformationSource: 'project-context',
    projectContextEnvelopeCount: presenterInput.envelopes.length,
  };

  return briefing;
}

function normalizeProjectContextPresenterInput(
  input: ProjectContextPresenterInput | readonly ProjectContextEnvelope<ProjectContextResult>[]
): ProjectContextPresenterInput {
  return 'project' in input ? input : buildProjectContextPresenterInput(input);
}

function buildProjectContextProjectMeta(
  input: ProjectContextPresenterInput
): Record<string, unknown> {
  const repoName = input.repo?.repo.name;
  const projectRoot = input.project.projectRoot;
  return {
    name: input.project.displayName ?? repoName ?? basename(projectRoot) ?? 'project-context',
    primaryLanguage: inferProjectContextPrimaryLanguage(input),
    fileCount: input.files.length,
    projectType:
      input.repo?.packageSystems[0]?.kind ?? input.repo?.buildSystems[0]?.kind ?? 'project-context',
    projectRoot,
  };
}

function buildProjectContextTargets(input: ProjectContextPresenterInput): TargetInfo[] {
  const moduleFileCounts = new Map(
    input.modules.map((moduleContext) => [
      moduleContext.module.name,
      moduleContext.ownedFiles.length,
    ])
  );
  const repoTargets = input.repo?.targets.map((target) => ({
    name: target.name,
    type: target.kind ?? 'target',
    fileCount:
      (moduleFileCounts.has(target.name)
        ? moduleFileCounts.get(target.name)
        : target.refs.length) || undefined,
  }));
  if (repoTargets?.length) {
    return repoTargets;
  }
  return input.modules.map((moduleContext) => ({
    name: moduleContext.module.name,
    type: moduleContext.module.kind ?? 'module',
    inferredRole: moduleContext.module.role,
    fileCount: moduleContext.ownedFiles.length,
  }));
}

function buildProjectContextLanguageStats(
  input: ProjectContextPresenterInput
): Record<string, number> {
  const stats = new Map<string, number>();
  for (const file of input.files) {
    if (file.language) {
      stats.set(file.language, (stats.get(file.language) ?? 0) + 1);
    }
  }
  // repo 给的是同一 scope 的总量；files 常为已读子集，只补缺少统计的语言。
  for (const language of input.repo?.languages ?? []) {
    stats.set(language.language, language.fileCount ?? stats.get(language.language) ?? 0);
  }
  return Object.fromEntries(
    [...stats.entries()].sort(([left], [right]) => left.localeCompare(right))
  );
}

function buildProjectContextDependencyGraph(
  input: ProjectContextPresenterInput
): DependencyGraph | null {
  const nodes = [
    ...(input.map?.modules.map((module) => ({
      id: module.id,
      label: module.name,
      fileCount: module.ownedFileCount,
    })) ?? []),
    ...input.moduleLayers.flatMap((layerContext) =>
      layerContext.layers.map((layer) => ({
        id: layer.id,
        label: layer.name,
        fileCount: layer.fileGroups?.length,
      }))
    ),
  ];
  const edges = [
    ...(input.map?.majorFlows.flatMap((flow) => {
      const from = flow.refs[0]?.id ?? flow.refs[0]?.label;
      const to = flow.refs[1]?.id ?? flow.refs[1]?.label;
      return from && to ? [{ from, to, type: flow.summary }] : [];
    }) ?? []),
    ...input.fileFlows.flatMap((flow) =>
      [...flow.imports, ...flow.callees, ...flow.outflow].flatMap((relation) => {
        const from = relation.fromRef?.id ?? relation.from?.label ?? flow.file.filePath;
        const to = relation.toRef?.id ?? relation.to?.label ?? relation.label;
        return from && to ? [{ from, to, type: relation.kind }] : [];
      })
    ),
  ];

  if (!nodes.length && !edges.length) {
    return null;
  }
  return { nodes, edges };
}

function buildProjectContextLocalPackageModules(
  input: ProjectContextPresenterInput
): LocalPackageModule[] {
  const moduleContexts = input.modules.map((moduleContext) => ({
    name: moduleContext.module.name,
    packageName: moduleContext.module.name,
    fileCount: moduleContext.ownedFiles.length,
    inferredRole: moduleContext.module.role,
    keyFiles: moduleContext.ownedFiles.slice(0, 6).map((file) => file.filePath),
  }));
  if (moduleContexts.length) {
    return moduleContexts;
  }
  return (
    input.map?.modules.map((module) => ({
      name: module.name,
      packageName: module.name,
      fileCount: module.ownedFileCount ?? 0,
      inferredRole: module.role,
      keyFiles: [],
    })) ?? []
  );
}

function buildProjectContextPanoramaReplacement(
  input: ProjectContextPresenterInput
): Record<string, unknown> | null {
  if (!input.map && !input.moduleLayers.length && !input.unavailable.length) {
    return null;
  }
  return {
    source: 'project-context',
    layers:
      input.map?.layers.map((layer) => ({
        level: layer.order ?? 0,
        name: layer.name,
        modules:
          input.map?.modules
            .filter(
              (module) => module.configLayer === layer.id || module.configLayer === layer.name
            )
            .map((module) => module.name) ?? [],
      })) ?? [],
    couplingHotspots:
      input.map?.hotspots.map((hotspot) => ({
        module: hotspot.ref.label ?? hotspot.ref.id,
        fanIn: Math.round(hotspot.score),
        fanOut: 0,
      })) ?? [],
    cyclicDependencies:
      input.map?.cycles.map((cycle) => ({
        cycle: cycle.refs.map((ref) => ref.label ?? ref.id),
        severity: cycle.summary,
      })) ?? [],
    projectContextUnavailable: input.unavailable.map((item) => ({
      queryLevel: item.queryLevel,
      reason: item.reason,
    })),
  };
}

function inferProjectContextPrimaryLanguage(input: ProjectContextPresenterInput): string {
  const repoLanguage = input.repo?.languages[0]?.language;
  if (repoLanguage) {
    return repoLanguage;
  }
  const stats = buildProjectContextLanguageStats(input);
  return Object.entries(stats).sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'unknown';
}

function basename(pathValue: string): string | undefined {
  return pathValue.split('/').filter(Boolean).pop();
}
