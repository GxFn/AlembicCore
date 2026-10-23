import type { AssetRef } from '../schemas/browser.ts';
type Read = (url: string) => Promise<string>;
type Digest = (text: string) => Promise<string>;
export async function digestText(text: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const readAsset: Read = async (url) => {
  const response = await fetch(new URL(url, document.baseURI));
  if (!response.ok) throw Error(`asset-http:${response.status}`);
  return response.text();
};
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export class AtlasLoader {
  private cache = new Map<string, Promise<unknown>>();
  private read: Read;
  private digest: Digest;
  constructor(read: Read = readAsset, digest: Digest = digestText) {
    this.read = read;
    this.digest = digest;
  }
  async load<T = unknown>(ref: AssetRef): Promise<T> {
    if (
      !ref ||
      !/^atlas-data\/(topic|files|api|search|impact|book)-[a-f0-9]{64}\.json$/.test(ref.url) ||
      !ref.url.endsWith(`-${ref.sha256}.json`) ||
      !ref.url.startsWith(`atlas-data/${ref.kind}-`)
    )
      throw Error('asset-path');
    if (!Number.isSafeInteger(ref.bytes) || ref.bytes <= 0 || ref.bytes > 10 * 1024 * 1024)
      throw Error('asset-bytes-limit');
    // 同一次读取共享promise；失败从缓存移除，显式重试只会读取原资源，不回退别的快照。
    const key = JSON.stringify(ref);
    let pending = this.cache.get(key);
    if (!pending) {
      pending = this.read(ref.url).then(async (text) => {
        if (new TextEncoder().encode(text).byteLength !== ref.bytes)
          throw Error('asset-bytes-mismatch');
        if ((await this.digest(text)) !== ref.sha256) throw Error('asset-digest-mismatch');
        const item: unknown = JSON.parse(text);
        if (
          !record(item) ||
          item.schemaVersion !== 1 ||
          item.kind !== ref.kind ||
          item.identity !== ref.identity
        )
          throw Error('asset-identity-mismatch');
        if (!record(item.data)) throw Error('asset-data-shape');
        const data = item.data;
        if (
          ref.kind === 'topic' &&
          (!record(item.data.document) || item.data.document.topicId !== ref.identity)
        )
          throw Error('asset-topic-identity');
        if (
          ref.kind === 'book' &&
          [
            'modules',
            'failures',
            'journeys',
            'objects',
            'runs',
            'graphs',
            'edges',
            'search',
            'topicInputs',
          ].some((key) => !Array.isArray(data[key]))
        )
          throw Error('asset-book-shape');
        return item.data;
      });
      this.cache.set(key, pending);
      pending.catch(() => {
        if (this.cache.get(key) === pending) this.cache.delete(key);
      });
    }
    return (await pending) as T;
  }
}
/** 页面、搜索各有独立所有权；旧成功、旧异常和取消都不得发布到新选择。 */
export class LatestRequest {
  private revision = 0;
  cancel() {
    this.revision++;
  }
  async run<T>(
    read: () => Promise<T>,
    publish: (value: T) => void | Promise<void>,
    failed: (error: unknown) => void | Promise<void>,
  ) {
    const revision = ++this.revision;
    try {
      const value = await read();
      if (revision === this.revision) await publish(value);
    } catch (error) {
      if (revision === this.revision) await failed(error);
    }
  }
}
