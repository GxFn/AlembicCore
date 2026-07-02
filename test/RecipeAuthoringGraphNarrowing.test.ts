/**
 * graph-evidence 关系词收窄钉子（2026-07-02 用户决策）。
 *
 * 收窄语义：GRAPH_REF 门禁只拦「具体调用链断言」（caller/callee/call chain/invokes/called by
 * 及中文 调用链/调用方/被调用）——这类论断没有图谱背书即凭印象。一般「依赖/分层/边界/上下游」
 * 属架构描述语言：其接地由 snippet-match + source-ref 覆盖，Recipe 关联由
 * KnowledgeService._autoDiscoverRelations / ConsolidationAdvisor 系统链路负责，不依赖候选措辞。
 * 背景：十轮真机验证表明宽词表在两宿主实践中均退化为「措辞税」（host 靠改述规避、in-process
 * 直接被拒），没有宿主真正走过 graphRefs 正向通道。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type RecipeSourceRefResolver,
  validateAgainst,
} from '../src/domain/knowledge/recipe-authoring-spec/index.js';
import { createFsSourceRefResolver } from '../src/service/knowledge/FsSourceRefResolver.js';

let projectRoot: string;
let resolver: RecipeSourceRefResolver;

/** 行 n 的源码文本可由公式重建，保证 snippet/fs 接地判定确定性通过。 */
function fileLines(name: string, startLine: number, endLine: number): string {
  return Array.from(
    { length: endLine - startLine + 1 },
    (_, i) => `export const ${name}${startLine - 1 + i} = ${startLine - 1 + i};`
  ).join('\n');
}

beforeAll(() => {
  projectRoot = mkdtempSync(path.join(tmpdir(), 'core-graph-narrowing-'));
  mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  for (const name of ['alpha', 'beta', 'gamma']) {
    writeFileSync(path.join(projectRoot, 'src', `${name}.ts`), fileLines(name, 1, 20));
  }
  resolver = createFsSourceRefResolver();
});

afterAll(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

/** gate-clean 基底候选（不含任何 graphRefs），markdown 按用例注入不同措辞。 */
function candidate(markdownBody: string): Record<string, unknown> {
  return {
    title: 'Alpha module keeps layered structure explicit',
    description: '中文简述：Alpha 模块保持显式分层结构，新增代码沿用相同层次。',
    content: {
      markdown: [
        '## Alpha 分层结构约定',
        markdownBody,
        '保持结构清晰、便于替换与测试 (来源: src/alpha.ts:1)。新代码沿用同一结构即可。',
        '✅ Keep the alpha module structure explicit and layered.',
        '❌ Do not collapse layers into a single module.',
      ].join('\n'),
      rationale: '显式分层让结构约束可校验、可脚本化重建，避免结构随时间漂移。',
    },
    kind: 'rule',
    trigger: '@alpha-layered-structure',
    whenClause: 'When adding code to the alpha module structure.',
    doClause: 'Keep the alpha module structure explicit and layered.',
    dontClause: 'Do not collapse layers into a single module.',
    sourceRefs: ['src/alpha.ts:1-3', 'src/beta.ts:1-3', 'src/gamma.ts:1-3'],
    reasoning: {
      sources: ['src/alpha.ts:1-3', 'src/beta.ts:1-3', 'src/gamma.ts:1-3'],
      confidence: 0.8,
    },
  };
}

function graphCodes(markdownBody: string): string[] {
  return validateAgainst([candidate(markdownBody)], {
    stage: 'all',
    path: 'in-process',
    profile: 'cold-start',
    sourceRefResolver: resolver,
    projectRoot,
  })
    .map((v) => v.code)
    .filter((c) => c === 'GRAPH_REF_INVALID' || c === 'STALE_GRAPH');
}

describe('特写模板豁免（markdown 代码块退出逐字校验，coreCode 证据位仍逐字）', () => {
  /** 提炼后的范式模板：与项目任何连续行范围都不逐字匹配，但非占位代码。 */
  const DISTILLED_TEMPLATE = [
    '```ts',
    'export const layerRule = defineLayerBoundary({',
    "  from: 'alpha',",
    "  allow: ['beta'],",
    '});',
    '```',
  ].join('\n');

  function withMarkdownTemplate(extra: Record<string, unknown> = {}): Record<string, unknown> {
    const base = candidate('模块分层由显式配置声明，新增层沿用同一声明结构。');
    const content = base.content as Record<string, unknown>;
    return {
      ...base,
      content: { ...content, markdown: `${String(content.markdown)}\n${DISTILLED_TEMPLATE}` },
      ...extra,
    };
  }

  it('markdown 范式模板（非项目原文）不触发 SNIPPET_MISMATCH', () => {
    const codes = validateAgainst([withMarkdownTemplate()], {
      stage: 'all',
      path: 'in-process',
      profile: 'cold-start',
      sourceRefResolver: resolver,
      projectRoot,
    }).map((v) => v.code);
    expect(codes).not.toContain('SNIPPET_MISMATCH');
  });

  it('coreCode 证据位仍逐字校验：凭空 coreCode 被拒，真实片段放行', () => {
    const fabricated = validateAgainst(
      [withMarkdownTemplate({ coreCode: 'const fabricated = rewriteFromMemory();' })],
      {
        stage: 'all',
        path: 'in-process',
        profile: 'cold-start',
        sourceRefResolver: resolver,
        projectRoot,
      }
    ).map((v) => v.code);
    expect(fabricated).toContain('SNIPPET_MISMATCH');

    const genuine = validateAgainst(
      [withMarkdownTemplate({ coreCode: fileLines('alpha', 1, 3) })],
      {
        stage: 'all',
        path: 'in-process',
        profile: 'cold-start',
        sourceRefResolver: resolver,
        projectRoot,
      }
    ).map((v) => v.code);
    expect(genuine).not.toContain('SNIPPET_MISMATCH');
  });

  it('markdown 模板的防伪底线仍在：占位代码触发 PLACEHOLDER_EVIDENCE', () => {
    const base = candidate('模块分层由显式配置声明。');
    const content = base.content as Record<string, unknown>;
    const codes = validateAgainst(
      [
        {
          ...base,
          content: {
            ...content,
            markdown: `${String(content.markdown)}\n\`\`\`ts\nawait operation(foo, bar); // TODO\n\`\`\``,
          },
        },
      ],
      {
        stage: 'all',
        path: 'in-process',
        profile: 'cold-start',
        sourceRefResolver: resolver,
        projectRoot,
      }
    ).map((v) => v.code);
    expect(codes).toContain('PLACEHOLDER_EVIDENCE');
  });
});

describe('graph-evidence 关系词收窄（架构描述放行，调用链断言仍拦）', () => {
  it('「依赖/分层/边界/上下游」架构描述不再触发 GRAPH_REF_INVALID', () => {
    expect(graphCodes('模块间依赖保持单向，上游层不得引用下游层，边界关系由配置声明。')).toEqual(
      []
    );
    expect(
      graphCodes('The layering depends on explicit boundaries; impact path stays local.')
    ).toEqual([]);
  });

  it('具体调用链断言（中/英）无 graphRefs 仍被拦', () => {
    expect(graphCodes('AlphaService 的调用链经由 beta 到 gamma，调用方必须先初始化。')).toContain(
      'GRAPH_REF_INVALID'
    );
    expect(graphCodes('The caller invokes beta before gamma in the call chain.')).toContain(
      'GRAPH_REF_INVALID'
    );
  });

  it('调用链断言附 graphRefs 即放行（正向通道语义不变）', () => {
    const item = {
      ...candidate('AlphaService 的调用链经由 beta 到 gamma，调用方必须先初始化。'),
      reasoning: {
        sources: ['src/alpha.ts:1-3', 'src/beta.ts:1-3', 'src/gamma.ts:1-3'],
        confidence: 0.8,
        graphRefs: ['graph:class AlphaService (src/alpha.ts) — Methods(2): start, stop'],
      },
    };
    const codes = validateAgainst([item], {
      stage: 'all',
      path: 'in-process',
      profile: 'cold-start',
      sourceRefResolver: resolver,
      projectRoot,
    }).map((v) => v.code);
    expect(codes).not.toContain('GRAPH_REF_INVALID');
  });
});
