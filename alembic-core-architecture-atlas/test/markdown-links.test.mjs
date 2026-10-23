import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownLinks, slugHeadings } from '../scripts/contracts.mjs';
test('真实Markdown链接与代码中的索引调用分开，围栏内假标题/HTML不是锚点', () => {
  const md =
    '# 正文\n[真实](page.md#actual)\n\n`fileStore[fileOperation](entry)`\n\n```ts\nfileStore[fileOperation](entry);\n# 假标题\n<a id="fake"></a>\n```\n\n<a id="actual"></a>\n';
  assert.deepEqual(markdownLinks(md), ['page.md#actual']);
  const ids = slugHeadings(md);
  assert.ok(ids.includes('actual'));
  assert.ok(ids.includes('正文'));
  assert.ok(!ids.includes('假标题'));
  assert.ok(!ids.includes('fake'));
});
