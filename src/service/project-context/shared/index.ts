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
export * from './repo-space/index.js';
export * from './sourceSlice-fileSymbols/index.js';
