import { describe, expect, it } from 'vitest';

import { computeContentHash } from '../src/shared/content-hash.js';
import { parseDiffHunks } from '../src/shared/diff-parser.js';
import { extractCodeBlocksFromMarkdown } from '../src/shared/markdown-utils.js';
import { tokenizeIdentifiers } from '../src/shared/recipe-tokens.js';
import { ContentSchema } from '../src/shared/schemas/common.js';
import { textSimilarity } from '../src/shared/similarity.js';
import { applyTestDimensionFilter, getTestModeConfig } from '../src/shared/test-mode.js';
import { estimateTokens, estimateTokensFast } from '../src/shared/token-utils.js';

describe('shared基础工具', () => {
  it('估算 token 时区分 CJK 和 ASCII 快速路径', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('你好')).toBe(1);
    expect(estimateTokensFast('1234567')).toBe(2);
  });

  it('计算稳定 content hash', () => {
    expect(computeContentHash('same content')).toBe(computeContentHash('same content'));
    expect(computeContentHash('same content')).not.toBe(computeContentHash('other content'));
  });

  it('提取 Markdown 代码块并参与 recipe token 化', () => {
    const markdown = '说明\n```ts\nfunction fetchUserProfile() {}\n```';
    const blocks = extractCodeBlocksFromMarkdown(markdown);
    const tokens = tokenizeIdentifiers(blocks[0]?.code ?? '');

    expect(blocks).toEqual([
      { language: 'ts', code: 'function fetchUserProfile() {}', startIndex: 3 },
    ]);
    expect(tokens).toContain('fetchUserProfile');
  });

  it('解析 git diff 文件列表', () => {
    const parsed = parseDiffHunks(`diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old
+new
`);

    expect(parsed).toEqual([{ removedLines: ['old'], addedLines: ['new'] }]);
  });

  it('校验共享 schema 和相似度工具', () => {
    const parsed = ContentSchema.parse({
      pattern: 'Use repository adapter',
      rationale: 'Keeps persistence isolated',
    });

    expect(parsed.pattern).toBe('Use repository adapter');
    expect(
      textSimilarity('repository adapter pattern', 'repository adapter', {
        substringBonus: true,
      })
    ).toBeGreaterThan(0.5);
  });

  it('按测试模式过滤维度', () => {
    const previousMode = process.env.ALEMBIC_TEST_MODE;
    const previousDims = process.env.ALEMBIC_TEST_BOOTSTRAP_DIMS;
    process.env.ALEMBIC_TEST_MODE = '1';
    process.env.ALEMBIC_TEST_BOOTSTRAP_DIMS = 'arch';

    try {
      expect(getTestModeConfig().enabled).toBe(true);
      expect(
        applyTestDimensionFilter(
          [
            { id: 'arch', title: 'Architecture' },
            { id: 'coding', title: 'Coding' },
          ],
          'bootstrap'
        )
      ).toEqual([{ id: 'arch', title: 'Architecture' }]);
    } finally {
      if (previousMode === undefined) {
        delete process.env.ALEMBIC_TEST_MODE;
      } else {
        process.env.ALEMBIC_TEST_MODE = previousMode;
      }
      if (previousDims === undefined) {
        delete process.env.ALEMBIC_TEST_BOOTSTRAP_DIMS;
      } else {
        process.env.ALEMBIC_TEST_BOOTSTRAP_DIMS = previousDims;
      }
    }
  });
});
