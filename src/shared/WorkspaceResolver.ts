/**
 * WorkspaceResolver — Ghost Mode 感知的工作区路径解析器
 *
 * 核心思想：提供 `dataRoot` — 所有运行时数据和知识库的根目录。
 *   - 标准模式: dataRoot = projectRoot（与原有行为完全一致）
 *   - Ghost 模式: dataRoot = ~/.asd/workspaces/<id>/（零项目侵入）
 *
 * 消费者只需将 `path.join(projectRoot, '.asd', ...)` 改为
 * `path.join(resolver.dataRoot, '.asd', ...)` 即可自动适配 Ghost 模式。
 *
 * projectRoot 始终指向真实项目目录（用于代码分析、AST 解析等）。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { AlembicFolderNames, PartialAlembicFolderNames } from './folderNames.js';
import { resolveFolderNames } from './folderNames.js';
import { detectKnowledgeBaseDir, SPEC_FILENAME } from './ProjectMarkers.js';
import {
  getGhostWorkspaceDir,
  ProjectRegistry,
  type ProjectRegistryInspection,
  type WorkspaceMode,
} from './ProjectRegistry.js';
import {
  loadProjectScopeForFolder,
  type ProjectDescriptor,
  type ProjectScopeSummary,
  resolveProjectScopeForFolder,
  summarizeProjectScopeDescriptor,
} from './ProjectScope.js';

export interface WorkspaceFacts {
  targetProjectRoot: string;
  projectRealpath: string;
  registryPath: string;
  registered: boolean;
  mode: WorkspaceMode;
  ghost: boolean;
  projectId: string | null;
  expectedProjectId: string;
  projectScope: ProjectScopeSummary | null;
  projectScopeId: string | null;
  controlRoot: string | null;
  folders: ProjectScopeSummary['folders'];
  currentFolderId: string | null;
  dataRoot: string;
  dataRootSource: 'project-root' | 'ghost-registry';
  workspaceExists: boolean;
  ghostMarker: ProjectRegistryInspection['ghostMarker'];
  runtimeDir: string;
  databasePath: string;
  knowledgeBaseDir: string;
  knowledgeDir: string;
  recipesDir: string;
  skillsDir: string;
  candidatesDir: string;
  wikiDir: string;
}

export class WorkspaceResolver {
  /** 真实项目根目录（用于代码分析） */
  readonly projectRoot: string;

  /** 数据根目录（所有 .asd/ 和知识库写入的基准路径） */
  readonly dataRoot: string;

  /** 是否处于 Ghost 模式 */
  readonly ghost: boolean;

  /** 项目 ID（来自 ProjectRegistry） */
  readonly projectId: string | null;

  /** 抽象 ProjectScope（多 folder 模式），为空时保持旧单根解析语义 */
  readonly projectScope: ProjectDescriptor | null;

  /** 当前物理 folder 在 ProjectScope 内的 ID */
  readonly currentFolderId: string | null;

  /** 知识库目录名（如 'Alembic'） */
  readonly knowledgeBaseDir: string;

  /** 目录名约定 */
  readonly folderNames: AlembicFolderNames;

  constructor(opts: {
    projectRoot: string;
    ghost?: boolean;
    projectId?: string;
    projectScope?: ProjectDescriptor | null;
    currentFolderId?: string | null;
    knowledgeBaseDir?: string;
    folderNames?: PartialAlembicFolderNames;
  }) {
    this.projectRoot = path.resolve(opts.projectRoot);
    this.folderNames = resolveFolderNames(opts.folderNames);
    this.knowledgeBaseDir =
      opts.knowledgeBaseDir ??
      detectKnowledgeBaseDir(this.projectRoot, this.folderNames.project.knowledgeBase);
    const inspection = ProjectRegistry.inspect(this.projectRoot);
    this.projectScope = opts.projectScope ?? null;
    const scopeResolution = this.projectScope
      ? resolveProjectScopeForFolder(this.projectScope, this.projectRoot)
      : null;
    this.currentFolderId =
      opts.currentFolderId ??
      scopeResolution?.currentFolderId ??
      this.projectScope?.currentFolderId ??
      null;

    if (this.projectScope) {
      // ProjectScope 首版固定 Ghost 写入边界；projectRoot 仍是当前源码 folder。
      this.ghost = true;
      this.projectId = opts.projectId ?? this.projectScope.projectId;
      this.dataRoot = this.projectScope.dataRoot;
      return;
    }

    this.ghost = opts.ghost ?? false;

    if (this.ghost) {
      // Ghost 模式：从 ProjectRegistry 查 ID 或用显式传入的 ID
      this.projectId = opts.projectId ?? inspection.projectId ?? null;
      if (!this.projectId) {
        throw new Error(
          `[WorkspaceResolver] Ghost 模式需要项目已注册。请先由宿主初始化 Alembic 工作区`
        );
      }
      this.dataRoot = getGhostWorkspaceDir(this.projectId);
    } else {
      this.projectId = opts.projectId ?? null;
      this.dataRoot = this.projectRoot;
    }
  }

  /**
   * 从 ProjectRegistry 自动创建 resolver
   * 自动检测项目是否为 Ghost 模式
   */
  static fromProject(
    projectRoot: string,
    opts: {
      currentFolderId?: string | null;
      folderNames?: PartialAlembicFolderNames;
      projectScope?: ProjectDescriptor | null;
    } = {}
  ): WorkspaceResolver {
    const inspection = ProjectRegistry.inspect(projectRoot);
    return new WorkspaceResolver({
      projectRoot,
      ghost: inspection.ghost,
      projectId: inspection.projectId ?? undefined,
      projectScope: opts.projectScope,
      currentFolderId: opts.currentFolderId,
      folderNames: opts.folderNames,
    });
  }

  static fromProjectScopeRegistry(
    projectRoot: string,
    opts: {
      singleRoot?: boolean;
      folderNames?: PartialAlembicFolderNames;
      registryPath?: string;
    } = {}
  ): WorkspaceResolver {
    if (opts.singleRoot === true) {
      return WorkspaceResolver.fromProject(projectRoot, { folderNames: opts.folderNames });
    }
    const projectScope = loadProjectScopeForFolder(projectRoot, {
      registryPath: opts.registryPath,
    });
    return WorkspaceResolver.fromProject(projectRoot, {
      projectScope,
      folderNames: opts.folderNames,
    });
  }

  /**
   * 生成 N0-data-location 可直接记录的路径事实。
   * projectRoot 始终是源码位置；dataRoot 是运行时和知识库写入边界。
   */
  toFacts(): WorkspaceFacts {
    const inspection = ProjectRegistry.inspect(this.projectRoot);
    const projectScope = this.projectScope
      ? summarizeProjectScopeDescriptor(this.projectScope, this.currentFolderId)
      : null;
    return {
      targetProjectRoot: this.projectRoot,
      projectRealpath: inspection.projectRealpath,
      registryPath: inspection.registryPath,
      registered: inspection.registered,
      mode: this.ghost ? 'ghost' : 'standard',
      ghost: this.ghost,
      projectId: this.projectId,
      expectedProjectId: inspection.expectedProjectId,
      projectScope,
      projectScopeId: projectScope?.projectScopeId ?? null,
      controlRoot: projectScope?.controlRoot ?? null,
      folders: projectScope?.folders ?? [],
      currentFolderId: projectScope?.currentFolderId ?? null,
      dataRoot: this.dataRoot,
      dataRootSource: this.ghost ? 'ghost-registry' : 'project-root',
      workspaceExists: fs.existsSync(this.dataRoot),
      ghostMarker: this.ghost ? inspection.ghostMarker : null,
      runtimeDir: this.runtimeDir,
      databasePath: this.databasePath,
      knowledgeBaseDir: this.knowledgeBaseDir,
      knowledgeDir: this.knowledgeDir,
      recipesDir: this.recipesDir,
      skillsDir: this.skillsDir,
      candidatesDir: this.candidatesDir,
      wikiDir: this.wikiDir,
    };
  }

  // ─── 运行时路径（.asd/ 下） ──────────────────────

  /** 运行时目录: .asd/ */
  get runtimeDir(): string {
    return path.join(this.dataRoot, this.folderNames.project.runtime);
  }

  /** 数据库路径: .asd/alembic.db */
  get databasePath(): string {
    return path.join(this.runtimeDir, 'alembic.db');
  }

  /** 日志目录: .asd/logs */
  get logsDir(): string {
    return path.join(this.runtimeDir, this.folderNames.project.logs);
  }

  /** 报告目录: .asd/logs/reports */
  get reportsDir(): string {
    return path.join(this.logsDir, 'reports');
  }

  /** 信号日志目录: .asd/logs/signals */
  get signalsDir(): string {
    return path.join(this.logsDir, 'signals');
  }

  /** 错误追踪目录: .asd/logs/errors */
  get errorsDir(): string {
    return path.join(this.logsDir, 'errors');
  }

  /** 对话存储目录: .asd/conversations */
  get conversationsDir(): string {
    return path.join(this.runtimeDir, 'conversations');
  }

  /** 缓存目录: .asd/cache */
  get cacheDir(): string {
    return path.join(this.runtimeDir, this.folderNames.project.cache);
  }

  /** 记忆文件: .asd/memory.jsonl (legacy) */
  get memoryPath(): string {
    return path.join(this.runtimeDir, 'memory.jsonl');
  }

  /** 项目配置: .asd/config.json */
  get configPath(): string {
    return path.join(this.runtimeDir, 'config.json');
  }

  /** Bootstrap 检查点: .asd/bootstrap-checkpoint */
  get checkpointPath(): string {
    return path.join(this.runtimeDir, 'bootstrap-checkpoint');
  }

  /** 上下文存储: .asd/context */
  get contextDir(): string {
    return path.join(this.runtimeDir, this.folderNames.project.context);
  }

  /** 记忆嵌入: .asd/context/memory_embeddings.json */
  get memoryEmbeddingsPath(): string {
    return path.join(this.runtimeDir, 'context', 'memory_embeddings.json');
  }

  /** Skills 迁移目录: .asd/skills */
  get runtimeSkillsDir(): string {
    return path.join(this.runtimeDir, this.folderNames.project.skills);
  }

  // ─── 知识库路径（Alembic/ 下） ────────────────────

  /** 知识库根目录: Alembic/ */
  get knowledgeDir(): string {
    return path.join(this.dataRoot, this.knowledgeBaseDir);
  }

  /** Recipes 目录: Alembic/recipes */
  get recipesDir(): string {
    return path.join(this.knowledgeDir, this.folderNames.project.recipes);
  }

  /** Candidates 目录: Alembic/candidates */
  get candidatesDir(): string {
    return path.join(this.knowledgeDir, this.folderNames.project.candidates);
  }

  /** Skills 目录: Alembic/skills */
  get skillsDir(): string {
    return path.join(this.knowledgeDir, this.folderNames.project.skills);
  }

  /** Wiki 目录: Alembic/wiki */
  get wikiDir(): string {
    return path.join(this.knowledgeDir, this.folderNames.project.wiki);
  }

  /** Boxspec 文件: Alembic/Alembic.boxspec.json */
  get specPath(): string {
    return path.join(this.knowledgeDir, SPEC_FILENAME);
  }

  /** Recipes 索引: Alembic/recipes/index.json */
  get recipesIndexPath(): string {
    return path.join(this.recipesDir, 'index.json');
  }
}

export default WorkspaceResolver;
