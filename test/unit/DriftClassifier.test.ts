/**
 * driftClassifier(G-C P3 纯函数)+ readFileAtCommit(真临时 git 仓)。
 *
 * classifyRegionDrift:给定漂移前后文件全文 + 原区间,判 line-shift(旧块整块出现在新文件
 * 别处,给出新区间)/ content-change(旧块找不到)/ unresolved(旧区间截空)。
 * readFileAtCommit:git show <commit>:<path> 安全封装,失败一律 null。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { classifyRegionDrift } from '../../src/service/knowledge/driftClassifier.js';
import { readFileAtCommit } from '../../src/shared/gitBlob.js';

const FILE_V1 = [
  'export const HEADER = 1;',
  "function target() { return 'A'; }",
  "function next() { return 'B'; }",
  'export const FOOTER = 2;',
  '',
].join('\n');

describe('classifyRegionDrift(纯函数)', () => {
  it('line-shift:旧区间的代码块在新文件整块出现在别处 → 给出新区间', () => {
    // 在文件顶部插入两行 → target/next 整体下移 2 行(内容不变)。
    const shifted = ['// added line 1', '// added line 2', ...FILE_V1.split('\n')].join('\n');
    // 原区间是第 2-3 行(target+next)。
    const result = classifyRegionDrift(FILE_V1, shifted, { start: 2, end: 3 });
    expect(result.kind).toBe('line-shift');
    expect(result.newRange).toEqual({ start: 4, end: 5 });
  });

  it('content-change:被引区间的代码本身改了、在新文件找不到原块 → content-change', () => {
    const changed = FILE_V1.replace("return 'A'", "return 'COMPLETELY_DIFFERENT'");
    const result = classifyRegionDrift(FILE_V1, changed, { start: 2, end: 3 });
    expect(result.kind).toBe('content-change');
    expect(result.newRange).toBeNull();
  });

  it('unresolved:旧区间越界截空 → 不判定(调用方维持粗粒度 drifted)', () => {
    const result = classifyRegionDrift(FILE_V1, FILE_V1, { start: 999, end: 1000 });
    expect(result.kind).toBe('unresolved');
  });

  it('CRLF/LF 归一:仅换行符不同不算内容变(line-shift 命中同块)', () => {
    const crlf = FILE_V1.replaceAll('\n', '\r\n');
    const result = classifyRegionDrift(FILE_V1, crlf, { start: 2, end: 3 });
    // 同位置同内容(仅行尾差异被归一)→ 视为 line-shift(位置未变,newRange 同区间)。
    expect(result.kind).toBe('line-shift');
    expect(result.newRange).toEqual({ start: 2, end: 3 });
  });
});

describe('readFileAtCommit(真临时 git 仓)', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { force: true, recursive: true });
    }
  });

  function initRepo(): { root: string; commit: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitblob-'));
    tmpDirs.push(root);
    const git = (args: string[]) =>
      execFileSync('git', ['-C', root, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/widget.ts'), 'export const V = 1;\n');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'v1']);
    const commit = git(['rev-parse', 'HEAD']).trim();
    return { root, commit };
  }

  it('读回指定 commit 的文件逐字内容;工作树后续改动不影响历史读取', () => {
    const { root, commit } = initRepo();
    // 改工作树 → git show 仍返回 commit 时的旧内容。
    fs.writeFileSync(path.join(root, 'src/widget.ts'), 'export const V = 999;\n');
    expect(readFileAtCommit(root, commit, 'src/widget.ts')).toBe('export const V = 1;\n');
  });

  it('commit/path 不存在或非 git 仓 → 一律 null(保守降级)', () => {
    const { root, commit } = initRepo();
    expect(readFileAtCommit(root, commit, 'src/nope.ts')).toBeNull();
    expect(readFileAtCommit(root, 'deadbeef', 'src/widget.ts')).toBeNull();
    expect(readFileAtCommit(os.tmpdir(), commit, 'src/widget.ts')).toBeNull();
  });

  it('形态防御:空 commit/path、绝对路径、路径逃逸 → null(不喂给 git)', () => {
    const { root, commit } = initRepo();
    expect(readFileAtCommit(root, '', 'src/widget.ts')).toBeNull();
    expect(readFileAtCommit(root, commit, '')).toBeNull();
    expect(readFileAtCommit(root, commit, '/etc/passwd')).toBeNull();
    expect(readFileAtCommit(root, commit, '../escape.ts')).toBeNull();
  });
});
