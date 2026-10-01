import crypto from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SourceFileNode, SourceFileNodeInput } from '../../domain/source-graph/index.js';
import { throwIfSourceReadAborted } from '../../infrastructure/io/ProjectSourceReader.js';
import Logger from '../../infrastructure/logging/Logger.js';
import { LanguageService } from '../../shared/LanguageService.js';
import type { InventoryFile } from './SourceGraphFileAnalyzer.js';
import {
  type NormalizedIndexOptions,
  normalizeExtension,
  normalizeRepoRelative,
} from './SourceGraphIndexOptions.js';

/** 索引范围内的全部文件，按仓内相对路径排序。清单不完整时抛错，不返回残缺结果。 */
export async function collectInventory(options: NormalizedIndexOptions): Promise<InventoryFile[]> {
  throwIfSourceReadAborted(options);
  const files: InventoryFile[] = [];
  for (const graphRoot of options.graphRoots) {
    await walkDirectory(graphRoot, options, files);
  }
  return files.sort((left, right) => left.repoRelativePath.localeCompare(right.repoRelativePath));
}

async function walkDirectory(
  directory: string,
  options: NormalizedIndexOptions,
  files: InventoryFile[]
): Promise<void> {
  throwIfSourceReadAborted(options);
  let entries: Dirent[];
  try {
    if (
      options.privateRuntimeRoot &&
      (await fs.realpath(directory)) === options.privateRuntimeRoot
    ) {
      Logger.debug('Source graph excludes its private SDK runtime directory', {
        directory,
        reason: 'codegraph-runtime',
      });
      return;
    }
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    // 不完整清单不能被解释成“文件已删除”，否则增量索引会发布空的新一代事实。
    Logger.getInstance().error('Source graph inventory failed; previous generation retained', {
      directory,
      projectRoot: options.projectRoot,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    throwIfSourceReadAborted(options);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!options.ignoreDirectories.has(entry.name)) {
        await walkDirectory(absolutePath, options, files);
      }
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const extension = normalizeExtension(path.extname(entry.name));
    if (!options.includeExtensions.has(extension)) {
      continue;
    }
    const stat = await fs.stat(absolutePath);
    files.push({
      absolutePath,
      repoRelativePath: toRepoRelative(options.projectRoot, absolutePath),
      // 语言标签来自全仓唯一的扩展名表；解析器语言由文件事实层另行判定。
      language: LanguageService.langFromExt(extension),
      classification: classificationForPath(absolutePath),
      sizeBytes: stat.size,
      mtimeMs: Math.trunc(stat.mtimeMs),
      extension,
    });
  }
}

/** 与上一代相比内容变了、新增或消失的文件。以内容哈希为准，不信 size/mtime。 */
export async function detectChangedFiles(
  options: NormalizedIndexOptions,
  baseFiles: SourceFileNode[],
  currentByPath: Map<string, InventoryFile>
): Promise<{ changedFiles: string[]; deletedFiles: string[] }> {
  const changedFiles = new Set<string>();
  const deletedFiles = new Set<string>();
  const baseByPath = new Map(baseFiles.map((file) => [file.repoRelativePath, file]));

  for (const baseFile of baseFiles) {
    throwIfSourceReadAborted(options);
    const current = currentByPath.get(baseFile.repoRelativePath);
    if (!current) {
      deletedFiles.add(baseFile.repoRelativePath);
      continue;
    }
    // size/mtime可被编辑器或恢复操作保持，不能证明事实仍对应正文；hash语义与索引时一致。
    const content = await fs.readFile(current.absolutePath, {
      encoding: 'utf8',
      signal: options.signal,
    });
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    if (hash !== baseFile.contentHash) {
      changedFiles.add(current.repoRelativePath);
      Logger.getInstance().debug('Source graph detected changed source content', {
        filePath: current.repoRelativePath,
        previousHash: baseFile.contentHash,
        contentHash: hash,
        metadataUnchanged:
          current.sizeBytes === baseFile.sizeBytes && current.mtimeMs === baseFile.mtimeMs,
      });
    }
  }

  for (const repoPath of currentByPath.keys()) {
    if (!baseByPath.has(repoPath)) {
      changedFiles.add(repoPath);
    }
  }

  return {
    changedFiles: Array.from(changedFiles).sort(),
    deletedFiles: Array.from(deletedFiles).sort(),
  };
}

export function normalizeRepoPathList(paths: string[], projectRoot: string): string[] {
  return Array.from(new Set(paths.map((item) => normalizeInputPath(item, projectRoot)))).sort();
}

function normalizeInputPath(input: string, projectRoot: string): string {
  const trimmed = input.trim();
  if (path.isAbsolute(trimmed)) {
    return toRepoRelative(projectRoot, trimmed);
  }
  return normalizeRepoRelative(trimmed);
}

function toRepoRelative(projectRoot: string, absolutePath: string): string {
  return normalizeRepoRelative(path.relative(projectRoot, absolutePath));
}

function classificationForPath(filePath: string): SourceFileNodeInput['classification'] {
  const normalized = filePath.replaceAll(path.sep, '/').toLowerCase();
  if (
    normalized.includes('/test/') ||
    normalized.includes('/tests/') ||
    /\.test\.[jt]sx?$/.test(normalized)
  ) {
    return 'test';
  }
  if (normalized.endsWith('.md') || normalized.endsWith('.mdx')) {
    return 'documentation';
  }
  if (/\.(json|ya?ml|toml)$/.test(normalized)) {
    return 'config';
  }
  if (normalized.includes('/dist/') || normalized.includes('/generated/')) {
    return 'generated';
  }
  return 'source';
}
