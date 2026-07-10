import {
  type EnhancementPack,
  type EnhancementRegistry,
  getEnhancementRegistry,
  initEnhancementRegistry,
} from './core/enhancement/index.js';

export interface FrameworkEnhancementResolverOptions {
  primaryLanguage?: string | null;
  detectedFrameworks?: readonly string[] | null;
}

export async function initFrameworkEnhancements(): Promise<EnhancementRegistry> {
  return initEnhancementRegistry();
}

export function getFrameworkEnhancements(): EnhancementRegistry {
  return getEnhancementRegistry();
}

export async function resolveFrameworkEnhancements(
  options: FrameworkEnhancementResolverOptions = {}
): Promise<EnhancementPack[]> {
  const registry = await initFrameworkEnhancements();
  return registry.resolve(options.primaryLanguage ?? '', [...(options.detectedFrameworks ?? [])]);
}

export const FrameworkEnhancements = Object.freeze({
  get: getFrameworkEnhancements,
  init: initFrameworkEnhancements,
  resolve: resolveFrameworkEnhancements,
});

// 项目框架检测(detectedFrameworks 的生产来源,2026-07-10 链路验通审计补齐)——
// guard 的项目级精确 resolve 内部消费,同时开放给未来需要框架画像的调用方。
export {
  type DetectedProjectFrameworks,
  detectProjectFrameworks,
} from './core/enhancement/detectFrameworks.js';

export type { EnhancementPack, EnhancementRegistry };
