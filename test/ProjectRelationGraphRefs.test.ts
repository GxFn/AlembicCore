import { describe, expect, it } from 'vitest';
import { validateAgainst } from '../src/domain/knowledge/recipe-authoring-spec/index.js';
import {
  formatRelationGraphRef,
  isStructuredGraphRef,
  parseProjectContextRef,
  parseRelationGraphRef,
  type RelationSummary,
} from '../src/domain/project-context/index.js';

const SITE_ID = 'relation-site:root:src/cache.ts:calls:Store.read:L14-L14:5-20:ab12cd34ef567890';

function relation(overrides: Partial<RelationSummary> = {}): RelationSummary {
  return {
    kind: 'calls',
    label: 'Cache.load calls Store.read',
    from: { filePath: 'src/cache.ts', label: 'Cache.load', symbol: 'load' },
    to: { filePath: 'src/store.ts', label: 'Store.read', symbol: 'read' },
    filePath: 'src/cache.ts',
    range: { startLine: 14, endLine: 14, startColumn: 5, endColumn: 20 },
    ref: {
      id: SITE_ID,
      kind: 'relation-site',
      label: 'Cache.load calls Store.read',
      level: 'file-flow',
      scope: { projectRoot: '/repo', filePath: 'src/cache.ts' },
    },
    unresolved: false,
    resolution: { linker: 'own', strategy: 'import-binding', tier: 'certain', confidence: 1 },
    ...overrides,
  } as RelationSummary;
}

describe('图引用：一条关系事实的一行文本', () => {
  it('生成的文本读得懂，方括号里是可复核的关系引用 id', () => {
    const text = formatRelationGraphRef(relation());
    expect(text).toBe(`graph:calls Cache.load -> Store.read [${SITE_ID}]`);

    expect(parseRelationGraphRef(text)).toEqual({
      kind: 'calls',
      from: 'Cache.load',
      to: 'Store.read',
      tier: 'certain',
      refId: SITE_ID,
      site: {
        kind: 'relation-site',
        filePath: 'src/cache.ts',
        range: { startLine: 14, endLine: 14, startColumn: 5, endColumn: 20 },
        hash: 'ab12cd34ef567890',
        relationKind: 'calls',
        target: 'Store.read',
      },
    });
  });

  it('可信档如实标出，解析时读得回来', () => {
    const text = formatRelationGraphRef(
      relation({
        resolution: {
          linker: 'codegraph',
          strategy: 'native-index',
          tier: 'trusted',
          confidence: 0.9,
        },
      })
    );
    expect(text).toBe(`graph:calls Cache.load -> Store.read (trusted) [${SITE_ID}]`);
    expect(parseRelationGraphRef(text)?.tier).toBe('trusted');
  });

  it('不是事实或无从复核的关系不产生图引用', () => {
    // 候选档只是线索。
    expect(
      formatRelationGraphRef(
        relation({
          resolution: { linker: 'codegraph', strategy: 'name', tier: 'candidate', confidence: 0.4 },
        })
      )
    ).toBeUndefined();
    // 没解析到目标。
    expect(formatRelationGraphRef(relation({ unresolved: true }))).toBeUndefined();
    // 没有发生位置，无从复核。
    expect(formatRelationGraphRef(relation({ ref: undefined }))).toBeUndefined();
    // 两端缺一。
    expect(formatRelationGraphRef(relation({ to: undefined }))).toBeUndefined();
  });

  it('文件级关系的两端是路径；带空格的名字不影响取回引用 id', () => {
    const id = 'relation-site:root:src/a.ts:imports:src/my%20lib/b.ts:L1-L1:0123456789abcdef';
    const text = formatRelationGraphRef(
      relation({
        kind: 'imports',
        from: { filePath: 'src/a.ts', label: 'src/a.ts' },
        to: { filePath: 'src/my lib/b.ts', label: 'src/my lib/b.ts' },
        ref: {
          id,
          kind: 'relation-site',
          label: 'imports',
          level: 'file-flow',
          scope: { projectRoot: '/repo', filePath: 'src/a.ts' },
        },
      })
    );
    expect(text).toBe(`graph:imports src/a.ts -> src/my lib/b.ts [${id}]`);
    const parsed = parseRelationGraphRef(text);
    expect(parsed?.to).toBe('src/my lib/b.ts');
    expect(parsed?.site).toMatchObject({
      filePath: 'src/a.ts',
      relationKind: 'imports',
      target: 'src/my lib/b.ts',
      hash: '0123456789abcdef',
    });
  });

  it('别的文本不被当成图引用', () => {
    expect(parseRelationGraphRef('graph:class Alpha (src/alpha.ts) — Methods(2): a, b')).toBe(
      undefined
    );
    expect(parseRelationGraphRef('graph:calls A -> B [not-a-ref]')).toBeUndefined();
    expect(parseRelationGraphRef('graph:calls A -> B [file:root:src/a.ts:abc]')).toBeUndefined();
    expect(parseRelationGraphRef(undefined)).toBeUndefined();
  });

  it('关系引用对象与它的 id 读出同样的种类与目标', () => {
    expect(
      parseProjectContextRef({
        id: SITE_ID,
        kind: 'relation-site',
        label: 'x',
        level: 'file-flow',
        metadata: { kind: 'calls', hash: 'ab12cd34ef567890', qualifiedName: 'Store.read' },
        scope: {
          projectRoot: '/repo',
          filePath: 'src/cache.ts',
          range: { startLine: 14, endLine: 14, startColumn: 5, endColumn: 20 },
        },
      })
    ).toEqual(parseProjectContextRef(SITE_ID));
  });
});

describe('结构化引用用哈希表达新旧，名字与路径只是数据', () => {
  it('带内容哈希的图引用与协议引用 id 是结构化引用', () => {
    expect(isStructuredGraphRef(`graph:calls A -> B [${SITE_ID}]`)).toBe(true);
    expect(isStructuredGraphRef(SITE_ID)).toBe(true);
    expect(
      isStructuredGraphRef('file-symbol:root:src/q.ts:method:Queue.pending:L3-L9:0123abcd')
    ).toBe(true);
  });

  it('自由文本、带状态标记的旧式引用、不带哈希的引用都不是', () => {
    expect(isStructuredGraphRef('source-graph:stale:abc')).toBe(false);
    expect(isStructuredGraphRef('graph:class Queue (src/q.ts) — Methods(1): pending')).toBe(false);
    expect(isStructuredGraphRef('file:root:src/a.ts')).toBe(false);
    expect(isStructuredGraphRef('relation-site:root:src/a.ts:calls:b:L1-L1')).toBe(false);
    expect(isStructuredGraphRef('')).toBe(false);
    expect(isStructuredGraphRef(undefined)).toBe(false);
  });

  function graphCodes(graphRefs: string[]): string[] {
    return validateAgainst(
      [
        {
          title: 'Queue drains through the store',
          kind: 'fact',
          relationshipClaim: true,
          reasoning: { graphRefs },
        },
      ],
      { stage: 2, path: 'in-process', profile: 'opportunistic' }
    )
      .map((violation) => violation.code)
      .filter((code) => code === 'GRAPH_REF_INVALID' || code === 'STALE_GRAPH');
  }

  it('门禁：名字或路径里出现 pending / partial / stale 的结构化引用不被误判为过期', () => {
    const pendingMethod =
      'relation-site:root:src/pending/queue.ts:calls:Store.partial:L7-L7:2-18:00ff00ff00ff00ff';
    expect(graphCodes([`graph:calls Queue.pending -> Store.partial [${pendingMethod}]`])).toEqual(
      []
    );
    expect(graphCodes([pendingMethod])).toEqual([]);
  });

  it('门禁：自由文本引用仍按字面判断，没有引用仍被拦', () => {
    expect(graphCodes(['source-graph:stale:abc'])).toEqual(['STALE_GRAPH']);
    expect(graphCodes(['graph:class Queue (src/q.ts) — Methods(1): pending'])).toEqual([
      'STALE_GRAPH',
    ]);
    expect(graphCodes([])).toEqual(['GRAPH_REF_INVALID']);
  });
});
