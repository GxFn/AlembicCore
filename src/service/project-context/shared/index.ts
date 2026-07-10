export const PROJECT_CONTEXT_ADJACENT_SHARED_BASES = [
  'sourceSlice-fileSymbols',
  'fileSymbols-fileFlow',
  'fileFlow-moduleLayers',
  'moduleLayers-module',
  'module-map',
  'map-repo',
  'repo-space',
] as const;

export type ProjectContextAdjacentSharedBase =
  (typeof PROJECT_CONTEXT_ADJACENT_SHARED_BASES)[number];

export * from './fileFlow-moduleLayers/index.js';
export * from './fileSymbols-fileFlow/index.js';
export * from './map-repo/index.js';
export * from './module-map/index.js';
export * from './moduleLayers-module/index.js';
// 解析语言单源(2026-07-11 P-D D6):Plugin 图适配层的 file-flow 目标选择需要同一
// 扩展名词表——此前它持第 6 份 JS-only 私有白名单,.swift 在选择层即被丢弃。
export * from './parserLanguage.js';
export * from './repo-space/index.js';
export * from './sourceSlice-fileSymbols/index.js';
