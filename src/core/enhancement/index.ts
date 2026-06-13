/**
 * @module enhancement/index
 * @description Enhancement Pack 自动加载器与 Registry 初始化
 *
 * 使用方式:
 *   import { getEnhancementRegistry } from '../core/enhancement/index.js';
 *   const registry = getEnhancementRegistry();
 *   const packs = registry.resolve(primaryLang, detectedFrameworks);
 */

import { EnhancementRegistry } from './EnhancementRegistry.js';

// Blessed lazy singleton (AD4 'enhancement-registry'): built once on first
// use from the 16 stateless packs; restart semantics = deterministic rebuild
// on next process start, no persisted state.
let _instance: EnhancementRegistry | null = null;

/**
 * 获取全局 EnhancementRegistry 单例
 * 注意: 首次访问前必须调用 initEnhancementRegistry() 完成异步加载
 * 如果未初始化, 返回空 Registry（不会抛错, 但 resolve() 结果为空）
 */
export function getEnhancementRegistry() {
  if (_instance) {
    return _instance;
  }
  _instance = new EnhancementRegistry();
  // 同步路径无法加载 ESM 动态 import — 返回空 Registry
  // 使用方应确保先调用 initEnhancementRegistry()
  return _instance;
}

/**
 * 异步初始化 — 加载所有增强包
 * 需要在使用 resolve() 之前调用
 */
export async function initEnhancementRegistry() {
  if (_instance && _instance.all().length > 0) {
    return _instance;
  }
  _instance = new EnhancementRegistry();

  const packImports = [
    import('./ReactEnhancement.js'),
    import('./NextjsEnhancement.js'),
    import('./VueEnhancement.js'),
    import('./NodeServerEnhancement.js'),
    import('./DjangoEnhancement.js'),
    import('./FastAPIEnhancement.js'),
    import('./MLEnhancement.js'),
    import('./LangChainEnhancement.js'),
    import('./SpringEnhancement.js'),
    import('./AndroidEnhancement.js'),
    import('./GoWebEnhancement.js'),
    import('./GoGrpcEnhancement.js'),
    import('./RustWebEnhancement.js'),
    import('./RustTokioEnhancement.js'),
  ];

  const results = await Promise.allSettled(packImports);
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.pack) {
      _instance.register(result.value.pack);
    }
  }

  return _instance;
}

// Re-exports
export { EnhancementPack } from './EnhancementPack.js';
export { EnhancementRegistry } from './EnhancementRegistry.js';
