/**
 * RecipeSourceRefRepository — recipe_source_refs 表 CRUD (Drizzle ORM)
 *
 * Recipe 来源引用桥接表：建立 Recipe ↔ 源码文件的映射关系。
 * 表使用复合主键 (recipe_id, source_path)，没有独立 id 列。
 *
 * 主要消费者：SourceRefReconciler
 */

import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { DrizzleDB } from '../../infrastructure/database/drizzle/index.js';
import { recipeSourceRefs } from '../../infrastructure/database/drizzle/schema.js';

/* ═══ 类型定义 ═══ */

export interface RecipeSourceRefEntity {
  recipeId: string;
  sourcePath: string;
  status: string;
  newPath: string | null;
  verifiedAt: number;
  /** U6 内容级保鲜：源 region 内容指纹（可空；首次迁移/插入为 null，由 reconcile 回填）。 */
  contentFp: string | null;
}

export interface RecipeSourceRefInsert {
  recipeId: string;
  sourcePath: string;
  status?: string;
  newPath?: string | null;
  verifiedAt: number;
  /**
   * U6 内容级保鲜指纹。仅在显式提供时写入：
   *   - 插入：缺省 → null；
   *   - upsert 冲突更新：undefined → 保留旧指纹（不被 stale/renamed 等无指纹路径误清空）。
   */
  contentFp?: string | null;
}

/* ═══ Repository 实现 ═══ */

export class RecipeSourceRefRepositoryImpl {
  readonly #drizzle: DrizzleDB;

  constructor(drizzle: DrizzleDB) {
    this.#drizzle = drizzle;
  }

  /* ─── 查询 ─── */

  /** 按 Recipe ID 查询所有关联的源引用 */
  findByRecipeId(recipeId: string): RecipeSourceRefEntity[] {
    return this.#drizzle
      .select()
      .from(recipeSourceRefs)
      .where(eq(recipeSourceRefs.recipeId, recipeId))
      .all() as RecipeSourceRefEntity[];
  }

  /** 按源文件路径查询所有关联的引用 */
  findBySourcePath(sourcePath: string): RecipeSourceRefEntity[] {
    return this.#drizzle
      .select()
      .from(recipeSourceRefs)
      .where(eq(recipeSourceRefs.sourcePath, sourcePath))
      .all() as RecipeSourceRefEntity[];
  }

  /** 按状态查询 */
  findByStatus(status: string): RecipeSourceRefEntity[] {
    return this.#drizzle
      .select()
      .from(recipeSourceRefs)
      .where(eq(recipeSourceRefs.status, status))
      .all() as RecipeSourceRefEntity[];
  }

  /** 查询全部来源引用（Plan ledger 读时投影使用） */
  findAll(): RecipeSourceRefEntity[] {
    return this.#drizzle.select().from(recipeSourceRefs).all() as RecipeSourceRefEntity[];
  }

  /** 查找指定复合键 */
  findOne(recipeId: string, sourcePath: string): RecipeSourceRefEntity | null {
    const row = this.#drizzle
      .select()
      .from(recipeSourceRefs)
      .where(
        and(eq(recipeSourceRefs.recipeId, recipeId), eq(recipeSourceRefs.sourcePath, sourcePath))
      )
      .limit(1)
      .get();
    return (row as RecipeSourceRefEntity) ?? null;
  }

  /** 查询所有 stale 引用 */
  findStale(): RecipeSourceRefEntity[] {
    return this.findByStatus('stale');
  }

  /** 查询所有 drifted 引用（U6：内容指纹漂移，文件在但 region 内容变；下游 P3 gate 消费）。 */
  findDrifted(): RecipeSourceRefEntity[] {
    return this.findByStatus('drifted');
  }

  /** 统计条数 */
  count(): number {
    const row = this.#drizzle.select({ cnt: sql<number>`count(*)` }).from(recipeSourceRefs).get();
    return row?.cnt ?? 0;
  }

  /* ─── 写入 ─── */

  /** UPSERT — 插入或更新（按复合主键） */
  upsert(data: RecipeSourceRefInsert): void {
    this.#drizzle
      .insert(recipeSourceRefs)
      .values({
        recipeId: data.recipeId,
        sourcePath: data.sourcePath,
        status: data.status ?? 'active',
        newPath: data.newPath ?? null,
        verifiedAt: data.verifiedAt,
        contentFp: data.contentFp ?? null,
      })
      .onConflictDoUpdate({
        target: [recipeSourceRefs.recipeId, recipeSourceRefs.sourcePath],
        set: {
          status: data.status ?? 'active',
          newPath: data.newPath ?? null,
          verifiedAt: data.verifiedAt,
          // content_fp 只在显式提供时更新：undefined → 不写该列，保留旧指纹
          // （stale/renamed 等无指纹路径的 upsert 不会误清空已回填指纹）。
          ...(data.contentFp !== undefined ? { contentFp: data.contentFp } : {}),
        },
      })
      .run();
  }

  /** 更新状态 */
  updateStatus(recipeId: string, sourcePath: string, status: string, newPath?: string): boolean {
    const set: Record<string, unknown> = { status };
    if (newPath !== undefined) {
      set.newPath = newPath;
    }
    const result = this.#drizzle
      .update(recipeSourceRefs)
      .set(set)
      .where(
        and(eq(recipeSourceRefs.recipeId, recipeId), eq(recipeSourceRefs.sourcePath, sourcePath))
      )
      .run();
    return result.changes > 0;
  }

  /* ─── 删除 ─── */

  /** 按 Recipe ID 删除所有关联引用 */
  deleteByRecipeId(recipeId: string): number {
    const result = this.#drizzle
      .delete(recipeSourceRefs)
      .where(eq(recipeSourceRefs.recipeId, recipeId))
      .run();
    return result.changes;
  }

  /** 删除指定复合键 */
  deleteOne(recipeId: string, sourcePath: string): boolean {
    const result = this.#drizzle
      .delete(recipeSourceRefs)
      .where(
        and(eq(recipeSourceRefs.recipeId, recipeId), eq(recipeSourceRefs.sourcePath, sourcePath))
      )
      .run();
    return result.changes > 0;
  }

  /** 检查表是否可访问（SourceRefReconciler 使用） */
  isAccessible(): boolean {
    try {
      this.#drizzle
        .select({ recipeId: recipeSourceRefs.recipeId })
        .from(recipeSourceRefs)
        .limit(1)
        .get();
      return true;
    } catch {
      return false;
    }
  }

  /** Stale counts grouped by recipe (for SourceRefReconciler signal emission) */
  getStaleCountsByRecipe(): Array<{ recipeId: string; staleCount: number; totalCount: number }> {
    // CO4 defect repair: the previous correlated subquery referenced the
    // outer table by its base name inside a scope that aliased the same
    // table (FROM recipe_source_refs r2) — SQLite resolved it to r2,
    // making the predicate tautological, so totalCount silently reported
    // the WHOLE-TABLE row count instead of the per-recipe total
    // (regression test: RecipeSourceRefRepositoryFloor.test.ts). Two
    // grouped queries avoid correlated-scope ambiguity entirely.
    const staleRows = this.#drizzle
      .select({
        recipeId: recipeSourceRefs.recipeId,
        staleCount: sql<number>`count(*)`,
      })
      .from(recipeSourceRefs)
      .where(inArray(recipeSourceRefs.status, ['stale', 'drifted']))
      .groupBy(recipeSourceRefs.recipeId)
      .all();
    const totalRows = this.#drizzle
      .select({
        recipeId: recipeSourceRefs.recipeId,
        totalCount: sql<number>`count(*)`,
      })
      .from(recipeSourceRefs)
      .groupBy(recipeSourceRefs.recipeId)
      .all();
    const totals = new Map(totalRows.map((r) => [r.recipeId, Number(r.totalCount)]));
    return staleRows.map((r) => ({
      recipeId: r.recipeId,
      staleCount: Number(r.staleCount),
      totalCount: totals.get(r.recipeId) ?? Number(r.staleCount),
    }));
  }

  /** Find all entries with status='renamed' and non-null new_path */
  findRenamed(): RecipeSourceRefEntity[] {
    return this.#drizzle
      .select()
      .from(recipeSourceRefs)
      .where(and(eq(recipeSourceRefs.status, 'renamed'), isNotNull(recipeSourceRefs.newPath)))
      .all() as RecipeSourceRefEntity[];
  }

  /** Replace source path (updates composite key column) — used by SourceRefReconciler.applyRepairs */
  replaceSourcePath(
    recipeId: string,
    oldSourcePath: string,
    newSourcePath: string,
    verifiedAt: number
  ): void {
    this.#drizzle
      .update(recipeSourceRefs)
      .set({
        sourcePath: newSourcePath,
        status: 'active',
        newPath: null,
        verifiedAt,
      })
      .where(
        and(eq(recipeSourceRefs.recipeId, recipeId), eq(recipeSourceRefs.sourcePath, oldSourcePath))
      )
      .run();
  }

  /** 查询多个 Recipe 的非 stale 来源引用（SearchEngine _supplementDetails 用） */
  findActiveByRecipeIds(ids: string[]) {
    if (ids.length === 0) {
      return [];
    }
    return this.#drizzle
      .select({
        recipeId: recipeSourceRefs.recipeId,
        sourcePath: recipeSourceRefs.sourcePath,
        status: recipeSourceRefs.status,
        newPath: recipeSourceRefs.newPath,
      })
      .from(recipeSourceRefs)
      .where(and(inArray(recipeSourceRefs.recipeId, ids), ne(recipeSourceRefs.status, 'stale')))
      .all();
  }
}
