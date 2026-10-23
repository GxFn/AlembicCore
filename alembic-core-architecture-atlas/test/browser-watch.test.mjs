import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldReloadBrowserData } from '../scripts/browser-plugin.mjs';
test('保存渲染/阅读回执不重载验证页，正典数据改变才重载', () => {
  const root = '/atlas';
  assert.equal(shouldReloadBrowserData(root, '/atlas/data/documents.json'), true);
  assert.equal(shouldReloadBrowserData(root, '/atlas/data/source-symbols.json'), true);
  for (const path of [
    '/atlas/data/render-receipt.json',
    '/atlas/data/reader-receipt.json',
    '/outside/documents.json',
  ])
    assert.equal(shouldReloadBrowserData(root, path), false);
});
