import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { buildBrowserAssets, readBrowserInputs } from './browser-assets.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  output = resolve(root, '.build/site');
const html = readFileSync(resolve(output, 'index.html'), 'utf8');
const queue = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => resolve(output, m[1]));
const loaded = new Set();
while (queue.length) {
  const path = queue.pop();
  if (loaded.has(path)) continue;
  if (!path.startsWith(output + '/')) throw Error('build-import-outside-output');
  loaded.add(path);
  const sf = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  for (const node of sf.statements) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      queue.push(resolve(dirname(path), node.moduleSpecifier.text));
  }
}
const files = [...loaded].map((path) => ({
  path: relative(output, path),
  bytes: statSync(path).size,
}));
const bytes = files.reduce((sum, f) => sum + f.bytes, 0);
const errors = [];
if (bytes > 250_000) errors.push(`initial-js-budget:${bytes}>250000`);
if (files.some((f) => /renderer|interactive-graph|cytoscape|mermaid|elk/.test(f.path)))
  errors.push('graph-engine-loaded-on-entry');
const { assets } = buildBrowserAssets(readBrowserInputs(root));
for (const [path, text] of assets)
  if (readFileSync(resolve(output, path), 'utf8') !== text)
    errors.push(`asset-content-mismatch:${path}`);
console.log(
  JSON.stringify(
    {
      errors,
      initialJavaScript: files,
      initialBytes: bytes,
      assetCount: assets.size,
      scope: '实际构建产物的静态入口依赖及逐资源字节；图引擎为后续动态导入',
    },
    null,
    2,
  ),
);
if (errors.length) process.exitCode = 1;
