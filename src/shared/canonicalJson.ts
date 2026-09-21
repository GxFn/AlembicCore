import { createHash } from 'node:crypto';

export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };
export type CanonicalSha256 = `sha256:${string}`;

// 通用确定性 JSON/字节身份：供输入读取器和 Foundation 共用，禁止基础 I/O 反向依赖 service。
export function toCanonicalJson(value: unknown): CanonicalJsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON does not accept non-finite numbers.');
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => (entry === undefined ? null : toCanonicalJson(entry)));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, CanonicalJsonValue> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) {
        // JSON 允许 __proto__ 作为普通键；直接赋值会触发 Object.prototype setter，
        // 导致该值从规范字节/hash消失且污染返回对象原型。以自有数据属性保留全部键，
        // 同时保留普通对象原型、原排序与普通输入的序列化字节。
        Object.defineProperty(result, key, {
          value: toCanonicalJson(entry),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }
    return result;
  }
  throw new TypeError(`Canonical JSON does not accept values of type ${typeof value}.`);
}

export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(toCanonicalJson(value));
}

export function hashCanonicalJson(value: unknown): CanonicalSha256 {
  return `sha256:${createHash('sha256').update(canonicalJsonStringify(value)).digest('hex')}`;
}

export function hashBytes(value: Uint8Array): CanonicalSha256 {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function canonicalHashDigest(hash: CanonicalSha256): string {
  const match = /^sha256:([a-f0-9]{64})$/.exec(hash);
  if (!match) {
    throw new TypeError(`Invalid canonical SHA-256 value: ${hash}`);
  }
  return match[1];
}
