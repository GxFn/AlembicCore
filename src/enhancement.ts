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

export type { EnhancementPack, EnhancementRegistry };
