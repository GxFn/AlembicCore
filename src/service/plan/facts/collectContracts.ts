// planFacts/collect-contracts —— 三个宿主共用的 ProjectContext 采集器（collectPlanProjectContext）的
// 输入与回执契约。F6（2026-10-06）把 Alembic、Plugin 与 Core 三份采集器合成 Core 的一份：
// 上限、范围与来源标签都从这里传进去，采集过程的取舍（种子来源、丢掉的种子、明细文件）从这里回报。

/** 范围里的一个文件夹（ProjectScope 成员），路径相对 projectRoot。字符串形式等价于只给 path。 */
export interface PlanCollectSourceFolder {
  path: string;
  displayName?: string;
  id?: string;
  repositoryId?: string;
  role?: string;
}

/**
 * 采集上限。不给的项沿用 Plan 路径今天的行为：全部模块取明细、不取文件明细。
 * 宿主（冷启动、重扫）按自己的预算传。
 */
export interface PlanCollectLimits {
  /** repo 扫描与源码清单的文件上限。 */
  maxFiles?: number;
  /** 进 `map` 的模块数；超出时按文件数留大的，丢掉的名字写进回执。默认不设上限。 */
  maxModuleSeeds?: number;
  /** 取 `module` / `module-layers` 明细的模块数。默认不设上限。 */
  maxModuleDetails?: number;
  /** 取 `file-flow` / `file-symbols` / `anchor-range` 的文件数。默认 0。 */
  maxFileDetails?: number;
  /** 大于 0 时，每个明细文件再取这么多行 `source-slice` 正文。默认 0（不取正文）。 */
  sourceSliceLines?: number;
}

/**
 * 采集范围。给了它就不再按 projectRoot 查 ProjectScope 注册表；
 * 主仓库是 `repoRoot`（默认角色为 primary-source 的文件夹，否则第一个文件夹，否则 projectRoot 自己），
 * 其余文件夹各作为一个整体种子进 `map`。
 */
export interface PlanCollectScope {
  displayName?: string;
  projectId?: string;
  sourceFolders?: ReadonlyArray<string | PlanCollectSourceFolder>;
  repoRoot?: string;
  /** 只保留落在这些目录里的模块（目录与模块互为前缀都算）。 */
  moduleScope?: readonly string[];
}

export interface PlanCollectOptions {
  limits?: PlanCollectLimits;
  scope?: PlanCollectScope;
  /** 请求的来源标签，进每个信封的 project.source。默认 `codex-host-plan`。 */
  source?: string;
  signal?: AbortSignal;
}

/** 采集过程的回执：范围从哪来、种子从哪来、按上限丢了什么、挑了哪些明细文件。 */
export interface PlanCollectionReport {
  source: string;
  scopeSource: 'explicit' | 'project-scope-registry' | 'project-root';
  /** `repo-modules`：种子来自仓库的模块划分；`source-folders`：主仓库没有划分、只有范围文件夹；`none`：没有种子。 */
  seedSource: 'repo-modules' | 'source-folders' | 'none';
  limits: {
    maxFiles?: number;
    maxModuleSeeds?: number;
    maxModuleDetails?: number;
    maxFileDetails: number;
    sourceSliceLines: number;
  };
  /** 被 `maxModuleSeeds` 挤掉的模块名。 */
  droppedModuleSeeds: string[];
  /** 被 `moduleScope` 过滤掉的模块名。 */
  filteredModuleSeeds: string[];
  /** 源码清单是否到了 `maxFiles` 上限。 */
  sourceScanTruncated: boolean;
  /** 取了明细的文件。 */
  detailFiles: string[];
}
