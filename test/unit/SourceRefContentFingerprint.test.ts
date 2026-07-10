/**
 * U6-Core phase 2 — 源 region 内容指纹 + drift reconcile（真 SQLite + 真磁盘文件）。
 *
 * 覆盖：①指纹独立（computeSourceRegionFingerprint ≠ computeKnowledgeHash，互不调用）、
 * parseSourceLineRange 解析、②CG⑥a 首填 null→只回填不改 status、
 * ③drift：region 内变→drifted+fp 变+verified_at 刷新；region 外变→保持 active 不误报。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DatabaseConnection } from '../../src/infrastructure/database/DatabaseConnection.js';
import { resetDrizzle } from '../../src/infrastructure/database/drizzle/index.js';
import { RecipeSourceRefRepositoryImpl } from '../../src/repository/sourceref/RecipeSourceRefRepository.js';
import { computeKnowledgeHash } from '../../src/service/knowledge/KnowledgeFileWriter.js';
import {
  computeSourceRegionFingerprint,
  parseSourceLineRange,
  SourceRefReconciler,
} from '../../src/service/knowledge/SourceRefReconciler.js';
import pathGuard from '../../src/shared/PathGuard.js';

const REL = 'src/widget.ts';
const SOURCE_REF = `${REL}:2-3`; // region = 第 2-3 行

// 第 1/4/5 行在 region 外，第 2-3 行在 region 内。
const FILE_V1 = [
  'export const HEADER = 1;',
  "function regionStart() { return 'A'; }",
  "function regionEnd() { return 'B'; }",
  'export const FOOTER = 2;',
  'const OUTSIDE = 3;',
  '',
].join('\n');

// region 内（第 2 行）改动
const FILE_REGION_CHANGED = FILE_V1.replace("return 'A'", "return 'A2'");
// 仅 region 外（第 5 行）改动
const FILE_OUTSIDE_CHANGED = FILE_V1.replace('const OUTSIDE = 3', 'const OUTSIDE = 99');

function writeSource(tmpDir: string, content: string): void {
  const dir = path.join(tmpDir, 'src');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'widget.ts'), content);
}

describe('U6 ① 指纹独立 + parseSourceLineRange（纯函数）', () => {
  it('同一 .md 内容：computeSourceRegionFingerprint ≠ computeKnowledgeHash（域分隔，互不调用）', () => {
    const md = '# Title\n\nbody text\n\n```ts\nfn()\n```\n';
    expect(computeSourceRegionFingerprint(md)).not.toBe(computeKnowledgeHash(md));
    // 16-hex 输出
    expect(computeSourceRegionFingerprint(md)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('region 截取 ≠ 全文；行尾归一（\\r\\n 与 \\n 同 region 同指纹）', () => {
    const content = 'a\nb\nc\nd\n';
    expect(computeSourceRegionFingerprint(content, { start: 2, end: 3 })).not.toBe(
      computeSourceRegionFingerprint(content)
    );
    expect(computeSourceRegionFingerprint('a\r\nb\r\nc\r\n', { start: 2, end: 2 })).toBe(
      computeSourceRegionFingerprint('a\nb\nc\n', { start: 2, end: 2 })
    );
  });

  it('parseSourceLineRange 解析 :N / :N-M(:col) / #LN / #LN-LM / 无后缀', () => {
    expect(parseSourceLineRange('a.ts:45')).toEqual({ start: 45, end: 45 });
    expect(parseSourceLineRange('a.ts:45-60')).toEqual({ start: 45, end: 60 });
    expect(parseSourceLineRange('a.ts:45-60:3')).toEqual({ start: 45, end: 60 });
    expect(parseSourceLineRange('a.ts#L45')).toEqual({ start: 45, end: 45 });
    expect(parseSourceLineRange('a.ts#L45-L60')).toEqual({ start: 45, end: 60 });
    expect(parseSourceLineRange('a.ts')).toEqual({});
  });
});

describe('U6 ②③ drift reconcile（真 SQLite + 真磁盘文件）', () => {
  let tmpDir: string;
  let connection: DatabaseConnection;
  let repo: RecipeSourceRefRepositoryImpl;
  let reconciler: SourceRefReconciler;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'u6-fp-'));
    process.env.ALEMBIC_QUIET = '1';
    pathGuard._reset();
    pathGuard.configure({ projectRoot: tmpDir, knowledgeBaseDir: 'Alembic' });
    connection = new DatabaseConnection({ path: '.asd/alembic.db' });
    await connection.connect();
    await connection.runMigrations();
    repo = new RecipeSourceRefRepositoryImpl(connection.getDrizzle());
    connection
      .db!.prepare(
        'INSERT INTO knowledge_entries (id, title, createdAt, updatedAt) VALUES (?, ?, 1, 1)'
      )
      .run('r1', 'Recipe r1');
    // 每仓 per-recipe 路径不触 knowledgeRepo，stub 即可。
    reconciler = new SourceRefReconciler(
      tmpDir,
      repo,
      {} as unknown as ConstructorParameters<typeof SourceRefReconciler>[2]
    );
  });

  afterEach(() => {
    connection.close();
    resetDrizzle();
    pathGuard._reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const reconcileOnce = () =>
    reconciler.reconcileRecipeSourceRefs(
      { id: 'r1', reasoning: { sources: [SOURCE_REF] } },
      { force: true }
    );

  it('P2 提交即落锚：全新 recipe（无既有源锚行）reconcile 立即 seed content_fp（消除真空窗）', async () => {
    // submit → refreshCreatedRecipeFreshness → reconcileRecipeSourceRefs 的首建路径:
    // 无 pre-upsert 行,走 #insertSourceRef,应即刻算当前 region 指纹作基线,
    // 而非等下一轮 reconcile。基线 = 提交时的真实内容(此刻文件仍是提交态)。
    writeSource(tmpDir, FILE_V1);
    expect(repo.findOne('r1', SOURCE_REF)).toBeNull(); // 提交前无锚

    await reconcileOnce();

    const row = repo.findOne('r1', SOURCE_REF);
    expect(row?.status).toBe('active');
    // 锚已在,且是提交态指纹——后续任何 reconcile 都对"提交时的真相"比对。
    expect(row?.contentFp).toBe(computeSourceRegionFingerprint(FILE_V1, { start: 2, end: 3 }));

    // 反证真空窗已闭:落锚后 region 内容变 → 下一轮 reconcile 立即判 drifted。
    writeSource(tmpDir, FILE_REGION_CHANGED);
    await reconcileOnce();
    expect(repo.findOne('r1', SOURCE_REF)?.status).toBe('drifted');
  });

  it('②CG⑥a：首轮 content_fp=null → 只回填指纹、status 保持 active（不误判 drifted）', async () => {
    writeSource(tmpDir, FILE_V1);
    // 模拟迁移后老行：active 但 content_fp 为 null（不传 contentFp）。
    repo.upsert({ recipeId: 'r1', sourcePath: SOURCE_REF, status: 'active', verifiedAt: 1000 });
    expect(repo.findOne('r1', SOURCE_REF)?.contentFp).toBeNull();

    await reconcileOnce();

    const row = repo.findOne('r1', SOURCE_REF);
    expect(row?.status).toBe('active'); // CG⑥a：status 不变
    expect(row?.contentFp).toBe(computeSourceRegionFingerprint(FILE_V1, { start: 2, end: 3 }));
  });

  it('③drift：region 内（第2行）改动 → drifted + content_fp 变 + verified_at 刷新', async () => {
    const fpV1 = computeSourceRegionFingerprint(FILE_V1, { start: 2, end: 3 });
    repo.upsert({
      recipeId: 'r1',
      sourcePath: SOURCE_REF,
      status: 'active',
      verifiedAt: 1000,
      contentFp: fpV1,
    });
    writeSource(tmpDir, FILE_REGION_CHANGED);

    await reconcileOnce();

    const row = repo.findOne('r1', SOURCE_REF);
    expect(row?.status).toBe('drifted');
    expect(row?.contentFp).toBe(
      computeSourceRegionFingerprint(FILE_REGION_CHANGED, { start: 2, end: 3 })
    );
    expect(row?.contentFp).not.toBe(fpV1);
    expect(row?.verifiedAt).toBeGreaterThan(1000); // verified_at 刷新
    expect(repo.findDrifted().map((r) => r.sourcePath)).toContain(SOURCE_REF);
  });

  it('③无误报：仅 region 外（第5行）改动 → 保持 active，content_fp 不变', async () => {
    const fpV1 = computeSourceRegionFingerprint(FILE_V1, { start: 2, end: 3 });
    repo.upsert({
      recipeId: 'r1',
      sourcePath: SOURCE_REF,
      status: 'active',
      verifiedAt: 1000,
      contentFp: fpV1,
    });
    writeSource(tmpDir, FILE_OUTSIDE_CHANGED);

    await reconcileOnce();

    const row = repo.findOne('r1', SOURCE_REF);
    expect(row?.status).toBe('active'); // region 外改动不漂移
    expect(row?.contentFp).toBe(fpV1); // 指纹不变
  });

  // ── P3 observe-only:drifted 精判(注入 gitReader + baselineCommit)──
  const reconcileWithGit = (gitReader: (commit: string, relPath: string) => string | null) =>
    new SourceRefReconciler(
      tmpDir,
      repo,
      {} as unknown as ConstructorParameters<typeof SourceRefReconciler>[2],
      { gitReader }
    ).reconcileRecipeSourceRefs(
      { id: 'r1', reasoning: { sources: [SOURCE_REF] } },
      { force: true, baselineCommit: 'basecommit' }
    );

  it('P3 精判:region 内容实变 → drifted 且 report.driftContentChange(旧块在新文件找不到)', async () => {
    const fpV1 = computeSourceRegionFingerprint(FILE_V1, { start: 2, end: 3 });
    repo.upsert({
      recipeId: 'r1',
      sourcePath: SOURCE_REF,
      status: 'active',
      verifiedAt: 1000,
      contentFp: fpV1,
    });
    // 工作树 = region 内容实变;gitReader 返回旧版本(基线 = 提交态 FILE_V1)。
    writeSource(tmpDir, FILE_REGION_CHANGED);
    const report = await reconcileWithGit(() => FILE_V1);
    expect(repo.findOne('r1', SOURCE_REF)?.status).toBe('drifted'); // status 不变(observe-only)
    expect(report.driftContentChange).toBe(1);
    expect(report.driftLineShift ?? 0).toBe(0);
  });

  it('P3 精判:纯行号漂移(区间块整体下移)→ drifted 且 report.driftLineShift', async () => {
    const fpV1 = computeSourceRegionFingerprint(FILE_V1, { start: 2, end: 3 });
    repo.upsert({
      recipeId: 'r1',
      sourcePath: SOURCE_REF,
      status: 'active',
      verifiedAt: 1000,
      contentFp: fpV1,
    });
    // 工作树 = 顶部插两行(第 2-3 行的原块下移到第 4-5 行,内容不变)——第 2-3 行指纹变→drifted。
    const shifted = ['// added 1', '// added 2', ...FILE_V1.split('\n')].join('\n');
    writeSource(tmpDir, shifted);
    const report = await reconcileWithGit(() => FILE_V1);
    expect(repo.findOne('r1', SOURCE_REF)?.status).toBe('drifted'); // 仍 drifted,不自动改 range
    expect(report.driftLineShift).toBe(1);
    expect(report.driftContentChange ?? 0).toBe(0);
  });

  it('P3 缺 gitReader/baselineCommit → 不精判,行为与既有完全一致(无 drift* 计数)', async () => {
    const fpV1 = computeSourceRegionFingerprint(FILE_V1, { start: 2, end: 3 });
    repo.upsert({
      recipeId: 'r1',
      sourcePath: SOURCE_REF,
      status: 'active',
      verifiedAt: 1000,
      contentFp: fpV1,
    });
    writeSource(tmpDir, FILE_REGION_CHANGED);
    // 共享 reconciler 无 gitReader → drifted 但不精判。
    const report = await reconcileOnce();
    expect(repo.findOne('r1', SOURCE_REF)?.status).toBe('drifted');
    expect(report.driftLineShift ?? 0).toBe(0);
    expect(report.driftContentChange ?? 0).toBe(0);
  });
});
