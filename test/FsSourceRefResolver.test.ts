/**
 * P5/C8 接线 — createFsSourceRefResolver 端到端接地。
 *
 * 证明两宿主注入 KnowledgeService 的深度接地 port 真能把 recipe 的 reasoning.sources 解析成真实文件行：
 * 存在且行范围有效 → 进接地集；不存在/越界/目录穿越 → 剔除(anti-fabrication)。这是激活 C8 深度评分公式的
 * 宿主接线依赖，与门禁 resolver 逐分支对齐。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createFsSourceRefResolver, resolveGroundedSourcePaths } from '../src/knowledge.js';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-fs-sourceref-'));
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'foo.ts'), 'a\nb\nc\nd\ne\n', 'utf8'); // 5 行
  fs.writeFileSync(path.join(tmpDir, 'src', 'bar.ts'), 'x\ny\nz\n', 'utf8'); // 3 行
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('createFsSourceRefResolver + resolveGroundedSourcePaths — 端到端接地', () => {
  const resolver = createFsSourceRefResolver();
  const groundOf = (sources: string[]): string[] =>
    resolveGroundedSourcePaths(
      { title: 't', reasoning: { sources } },
      { sourceRefResolver: resolver, projectRoot: tmpDir }
    ).validSourcePaths.sort();

  it('存在且行范围有效的 ref → 进接地集', () => {
    expect(groundOf(['src/foo.ts:1-3', 'src/bar.ts:2'])).toEqual(['src/bar.ts', 'src/foo.ts']);
  });

  it('文件不存在 → 剔除(防编造)', () => {
    expect(groundOf(['src/ghost.ts:1'])).toEqual([]);
  });

  it('行范围越界 → 剔除', () => {
    // foo.ts 只有 5 行，请求 9 行越界。
    expect(groundOf(['src/foo.ts:1-9'])).toEqual([]);
  });

  it('目录穿越 → 剔除(不解析项目根外的文件)', () => {
    expect(groundOf(['../outside.ts:1'])).toEqual([]);
  });

  it('混合：只保留真解析成功的', () => {
    expect(groundOf(['src/foo.ts:2', 'src/ghost.ts:1', 'src/bar.ts:99'])).toEqual(['src/foo.ts']);
  });
});
