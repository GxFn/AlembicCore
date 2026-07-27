import { hashCanonicalJson } from '../project-context/foundation/canonical.js';

export interface ProductionActorIdentityInputV1 {
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly promptHash: string;
  readonly runId: string;
  readonly invocationId: string;
  readonly loadReceiptHash: string;
  readonly outputHash: string;
}

/**
 * 生产参与者身份必须能够回放到一次真实加载和调用；provider/model 字符串本身不构成身份。
 * prompt、run、invocation、load 和 output 一起进入 hash，供 Agent/Main 在进程边界两侧对账。
 */
export interface ProductionActorIdentityV1 extends ProductionActorIdentityInputV1 {
  readonly schemaVersion: 1;
  readonly actorHash: string;
}

export function createProductionActorIdentityV1(
  input: ProductionActorIdentityInputV1
): ProductionActorIdentityV1 {
  for (const [field, value] of Object.entries({
    providerId: input.providerId,
    modelId: input.modelId,
    modelVersion: input.modelVersion,
    runId: input.runId,
    invocationId: input.invocationId,
  })) {
    requireText(value, `PRODUCTION_ACTOR_${field.toUpperCase()}_REQUIRED`);
  }
  for (const [field, value] of Object.entries({
    promptHash: input.promptHash,
    loadReceiptHash: input.loadReceiptHash,
    outputHash: input.outputHash,
  })) {
    requireSha256(value, `PRODUCTION_ACTOR_${field.toUpperCase()}_INVALID`);
  }
  const semantic = {
    schemaVersion: 1 as const,
    providerId: input.providerId.trim(),
    modelId: input.modelId.trim(),
    modelVersion: input.modelVersion.trim(),
    promptHash: input.promptHash,
    runId: input.runId.trim(),
    invocationId: input.invocationId.trim(),
    loadReceiptHash: input.loadReceiptHash,
    outputHash: input.outputHash,
  };
  return freezeDeep({ ...semantic, actorHash: hashCanonicalJson(semantic) });
}

export function assertProductionActorIdentityV1(identity: ProductionActorIdentityV1): void {
  const rebuilt = createProductionActorIdentityV1(identity);
  if (
    identity.schemaVersion !== 1 ||
    identity.actorHash !== rebuilt.actorHash ||
    Object.keys(identity).length !== Object.keys(rebuilt).length ||
    Object.entries(rebuilt).some(
      ([field, value]) => identity[field as keyof ProductionActorIdentityV1] !== value
    )
  ) {
    throw new Error('PRODUCTION_ACTOR_IDENTITY_INVALID');
  }
}

function requireText(value: string, code: string): void {
  if (!value?.trim()) {
    throw new Error(code);
  }
}

function requireSha256(value: string, code: string): void {
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new Error(code);
  }
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      freezeDeep(child);
    }
  }
  return value;
}
