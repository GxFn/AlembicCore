import type { EmbeddingPort, LegacyEmbedProvider } from './EmbeddingPort.js';

export type VectorAvailabilityStatus = 'available' | 'degraded' | 'unavailable';

export type VectorAvailabilityReason =
  | 'embed-provider-ready'
  | 'embed-provider-configured'
  | 'embed-provider-missing'
  | 'embed-provider-unavailable'
  | 'embed-provider-probe-failed';

export type VectorAvailabilityProbeStatus =
  | 'available'
  | 'error'
  | 'not-applicable'
  | 'not-supported'
  | 'unavailable';

export interface VectorAvailability {
  available: boolean;
  status: VectorAvailabilityStatus;
  reason: VectorAvailabilityReason;
  embedProviderConfigured: boolean;
  probeStatus: VectorAvailabilityProbeStatus;
  detail?: string;
}

/**
 * 共享 provider 探测决策，保留原对象的方法接收者，不缓存、不额外调用 embedding。
 * 队列消费 boolean，服务公开完整诊断；不能用适配后的 port 替换原 provider 的探测能力。
 */
export async function probeEmbeddingAvailability(
  provider: EmbeddingPort | LegacyEmbedProvider | null
): Promise<VectorAvailability> {
  if (!provider) {
    return {
      available: false,
      embedProviderConfigured: false,
      probeStatus: 'not-applicable',
      reason: 'embed-provider-missing',
      status: 'unavailable',
    };
  }
  if (!('isAvailable' in provider) || typeof provider.isAvailable !== 'function') {
    return {
      available: true,
      embedProviderConfigured: true,
      probeStatus: 'not-supported',
      reason: 'embed-provider-configured',
      status: 'available',
    };
  }
  try {
    const available = Boolean(await provider.isAvailable());
    return {
      available,
      embedProviderConfigured: true,
      probeStatus: available ? 'available' : 'unavailable',
      reason: available ? 'embed-provider-ready' : 'embed-provider-unavailable',
      status: available ? 'available' : 'degraded',
    };
  } catch (error) {
    return {
      available: false,
      detail: error instanceof Error ? error.message : String(error),
      embedProviderConfigured: true,
      probeStatus: 'error',
      reason: 'embed-provider-probe-failed',
      status: 'degraded',
    };
  }
}
