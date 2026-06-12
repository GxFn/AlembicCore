/**
 * isOwnDevRepo — 检测 projectRoot 是否应排除 Alembic 运行时数据创建
 *
 * 三层保护：
 *  1. isAlembicDevRepo — Alembic 自身源码仓库
 *  2. isAlembicEcosystemRepo — Alembic 生态项目（alembic-book 等）
 *  3. isExcludedProject — 综合判定：不适合创建知识库的项目
 *
 * 用于防止宿主运行时在不当目录创建 `.asd/` 运行时数据。
 *
 * isAlembicDevRepo 检测条件：
 *  1. projectRoot/package.json 的 name === 'alembic-ai'
 *  2. projectRoot/lib/bootstrap.ts 或 lib/Bootstrap.ts 存在（源码标记；双名过渡期见函数内注释）
 *  3. projectRoot/SOUL.md 存在（项目灵魂文档）
 * 或 package name === '@alembic/core' 且存在 AGENTS.md / src/index.ts。
 */

import fs from 'node:fs';
import path from 'node:path';

/** 多路径缓存（同一进程可能检测多个目录） */
const _cache = new Map<string, boolean>();

/** 排除项目缓存 */
const _excludeCache = new Map<string, { excluded: boolean; reason: string }>();

/**
 * 判断 dir 是否是 Alembic 自身的源码开发仓库
 * 结果按 dir 缓存，避免重复 IO
 */
export function isAlembicDevRepo(dir: string): boolean {
  const resolved = path.resolve(dir);
  const cached = _cache.get(resolved);
  if (cached !== undefined) {
    return cached;
  }

  let result = false;
  try {
    const pkgPath = path.join(resolved, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const raw = fs.readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(raw) as { name?: string };
      if (pkg.name === 'alembic-ai') {
        // 条件 2 & 3: 源码标记文件同时存在
        // TRANSITIONAL compatibility (Core half of the SN bootstrap rename
        // pair): Alembic renames lib/bootstrap.ts -> lib/Bootstrap.ts (sole
        // export class Bootstrap, class-position convention); accept BOTH
        // names so dev-repo detection survives the cross-repo rename window
        // on case-sensitive filesystems. Consumer: the Alembic b2 rename leg.
        // Reason: atomic cross-repo coupling (unilateral rename would
        // silently break PathGuard excluded-project protection). Removal
        // condition: b2 landed + accepted. Cleanup trigger: the next
        // Core-touching packet after b2 drops the old-name branch.
        // Owner: AlembicCore window.
        const hasBootstrap =
          fs.existsSync(path.join(resolved, 'lib', 'bootstrap.ts')) ||
          fs.existsSync(path.join(resolved, 'lib', 'Bootstrap.ts'));
        const hasSoul = fs.existsSync(path.join(resolved, 'SOUL.md'));
        result = hasBootstrap && hasSoul;
      } else if (pkg.name === '@alembic/core') {
        const hasAgents = fs.existsSync(path.join(resolved, 'AGENTS.md'));
        const hasCoreEntry = fs.existsSync(path.join(resolved, 'src', 'index.ts'));
        result = hasAgents && hasCoreEntry;
      }
    }
  } catch {
    // 读取失败 → 不是开发仓库
  }

  _cache.set(resolved, result);
  return result;
}

/**
 * 判断 dir 是否是 Alembic 生态项目（不应创建运行时数据）
 *
 * 检测条件：package.json 的 name 以 'alembic-' 或 '@alembic/' 开头
 * 例如 alembic-book、alembic-examples 等
 */
export function isAlembicEcosystemRepo(dir: string): boolean {
  const resolved = path.resolve(dir);
  try {
    const pkgPath = path.join(resolved, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const raw = fs.readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(raw) as { name?: string };
      return (
        typeof pkg.name === 'string' &&
        (pkg.name.startsWith('alembic-') || pkg.name.startsWith('@alembic/'))
      );
    }
  } catch {
    // 读取失败 → 不是
  }
  return false;
}

/**
 * 综合判定：项目是否应排除创建 .asd/ 运行时数据
 *
 * 当前排除：
 *  1. Alembic 源码仓库本身
 *  2. Alembic 生态项目（alembic-book 等）
 *  3. 存在 .asd-skip 标记文件的项目（用户手动排除）
 *
 * @returns { excluded: boolean; reason: string }
 */
export function isExcludedProject(dir: string): { excluded: boolean; reason: string } {
  const resolved = path.resolve(dir);
  const cached = _excludeCache.get(resolved);
  if (cached !== undefined) {
    return cached;
  }

  let result: { excluded: boolean; reason: string };

  if (isAlembicDevRepo(resolved)) {
    result = { excluded: true, reason: 'Alembic 源码开发仓库' };
  } else if (isAlembicEcosystemRepo(resolved)) {
    result = { excluded: true, reason: 'Alembic 生态项目' };
  } else if (fs.existsSync(path.join(resolved, '.asd-skip'))) {
    result = { excluded: true, reason: '项目包含 .asd-skip 标记' };
  } else {
    result = { excluded: false, reason: '' };
  }

  _excludeCache.set(resolved, result);
  return result;
}

/** 重置缓存（仅用于测试） */
export function _resetDevRepoCache() {
  _cache.clear();
  _excludeCache.clear();
}
