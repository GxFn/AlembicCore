import type { RelationSummary } from './ProjectContextMap.js';
import { type ParsedProjectContextRef, parseProjectContextRef } from './ProjectContextRefIds.js';

/**
 * 图引用：一条关系事实写成的一行文本。
 *
 * 宿主把它展示给模型，模型把与论断有关的那几条原样抄进候选的 graphRefs；门禁据此确认
 * "调用链"一类的论断背后有查询过的关系。文本分两半：前半给人看（哪种关系、谁到谁），
 * 方括号里是协议的关系引用 id——它带着发生位置与那个文件内容的短哈希，所以这行文本可以复核：
 *
 *   graph:calls Cache.load -> Store.read [relation-site:root:src/cache.ts:calls:Store.read:L14-L14:5-20:ab12cd34ef567890]
 *
 * 生成与解析只在这里各有一份，宿主不自己拼。
 */
export interface ParsedRelationGraphRef {
  /** 关系种类：calls、extends、imports 等。 */
  kind: string;
  from: string;
  to: string;
  /** 关系的可信分级；候选档不是事实，不会成为图引用。 */
  tier: 'certain' | 'trusted';
  /** 协议的关系引用 id。 */
  refId: string;
  /** 从 refId 读出的发生位置与内容哈希。 */
  site: ParsedProjectContextRef;
}

const GRAPH_REF = /^graph:(\S+) (.+?) -> (.+?)( \(trusted\))? \[([^\]\s]+)\]$/;

/**
 * 一条关系 → 图引用。没有发生位置的关系无法复核，候选档与未解析的关系不是事实：这三种都不产生图引用。
 */
export function formatRelationGraphRef(relation: RelationSummary): string | undefined {
  const refId = relation.ref?.id;
  const tier = relation.resolution?.tier ?? 'certain';
  const from = relation.from?.label;
  const to = relation.to?.label;
  if (!refId || !from || !to || relation.unresolved === true || tier === 'candidate') {
    return undefined;
  }
  if (parseProjectContextRef(refId)?.kind !== 'relation-site') {
    return undefined;
  }
  return `graph:${relation.kind} ${from} -> ${to}${tier === 'trusted' ? ' (trusted)' : ''} [${refId}]`;
}

/** 图引用 → 它陈述的关系与发生位置；不是这种文本时返回 undefined。 */
export function parseRelationGraphRef(
  text: string | undefined
): ParsedRelationGraphRef | undefined {
  const match = typeof text === 'string' ? GRAPH_REF.exec(text.trim()) : null;
  if (!match) {
    return undefined;
  }
  const site = parseProjectContextRef(match[5]);
  if (site?.kind !== 'relation-site') {
    return undefined;
  }
  return {
    kind: match[1],
    from: match[2],
    to: match[3],
    tier: match[4] ? 'trusted' : 'certain',
    refId: match[5],
    site,
  };
}

/**
 * 这段文本是不是一条可复核的结构化引用：图引用，或者协议引用 id 本身，并且带着内容哈希。
 *
 * 结构化引用靠内容哈希表达新旧，里面的符号名与路径只是数据——
 * 一个叫 `pending` 的方法不代表这条引用"待定"。不带哈希的引用无从复核，不算。
 */
export function isStructuredGraphRef(text: string | undefined): boolean {
  if (typeof text !== 'string' || !text.trim()) {
    return false;
  }
  const site = parseRelationGraphRef(text)?.site ?? parseProjectContextRef(text.trim());
  return site?.hash !== undefined;
}
