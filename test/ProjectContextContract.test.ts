import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  PROJECT_CONTEXT_REQUEST_KIND_VALUES,
  type ProjectContextRequest,
} from '../src/domain/project-context/index.js';
import { ProjectContext } from '../src/project-context.js';
import { PROJECT_CONTEXT_INTERFACE_ALLOWED_OPERATIONS } from '../src/service/project-context/interface/contracts.js';
import { createProjectContext } from '../src/service/project-context/interface/projectContext.js';

const EXPECTED_PROJECT_CONTEXT_REQUEST_KINDS = [
  'anchor-range',
  'space',
  'repo',
  'map',
  'module',
  'module-layers',
  'file-flow',
  'file-symbols',
  'source-slice',
] as const;

describe('ProjectContext PCQ-0 contract skeleton', () => {
  it('exposes the stable package subpath and runtime entrypoints', async () => {
    const packageJson = JSON.parse(
      fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as { exports: Record<string, { import: string; types: string }> };
    const publicModule = await import('../src/project-context.js');

    expect(packageJson.exports['./project-context']).toStrictEqual({
      import: './dist/project-context.js',
      types: './dist/project-context.d.ts',
    });
    expect(Object.keys(publicModule).sort()).toEqual([
      // P-D D6(2026-07-11):解析语言单源四符号经本门面导出,供 Plugin 图适配层
      // 消费(替代其第 6 份 JS-only 私有白名单)。
      'AST_PARSER_LANGUAGES',
      'EXTENSION_PARSER_LANGUAGE',
      'JS_FAMILY_LANGUAGES',
      'ProjectContext',
      'ProjectContextCapabilities',
      'buildProjectContextPresenterInput',
      'createProjectContextCapabilities',
      'resolveAstParserLanguage',
    ]);
    expect(ProjectContext.execute).toBeInstanceOf(Function);
    expect(publicModule.ProjectContextCapabilities.executeFileSymbolsQuery).toBeInstanceOf(
      Function
    );
    expect(publicModule.buildProjectContextPresenterInput).toBeInstanceOf(Function);
  });

  it('keeps public request kinds exact and ordered for deterministic dispatch', () => {
    expect(PROJECT_CONTEXT_REQUEST_KIND_VALUES).toEqual(EXPECTED_PROJECT_CONTEXT_REQUEST_KINDS);
  });

  it('returns a stable shared envelope with ordinary query errors for invalid project scopes', async () => {
    const envelope = await ProjectContext.execute({
      kind: 'space',
      scope: { projectRoot: '/tmp/project-context-pcq0' },
    });

    expect(Object.keys(envelope).sort()).toEqual([
      'contractVersion',
      'data',
      'errors',
      'project',
      'queryLevel',
      'refs',
    ]);
    expect(envelope.contractVersion).toBe(1);
    expect(envelope.queryLevel).toBe('space');
    expect(envelope.project.projectRoot).toBe('/tmp/project-context-pcq0');
    expect(envelope.refs).toEqual([]);
    expect(envelope.errors?.[0]).toMatchObject({
      code: 'invalid-scope',
      retryable: false,
      severity: 'error',
    });
    expect(envelope.data).toMatchObject({
      available: false,
      kind: 'space',
      nextRefs: [],
    });
  });

  it('shapes invalid request kinds and outside-scope paths as ordinary query errors', async () => {
    const invalidKindEnvelope = await ProjectContext.execute({
      kind: 'invalid-kind',
      scope: { projectRoot: '/tmp/project-context-pcq0' },
    } as unknown as ProjectContextRequest);
    const outsideScopeEnvelope = await ProjectContext.execute({
      kind: 'source-slice',
      scope: {
        activeFile: '/var/tmp/outside.ts',
        projectRoot: '/tmp/project-context-pcq0',
      },
    });

    expect(invalidKindEnvelope.errors?.[0]?.code).toBe('invalid-request-kind');
    expect(invalidKindEnvelope.queryLevel).toBe('space');
    expect(outsideScopeEnvelope.errors?.[0]?.code).toBe('outside-scope');
    expect(outsideScopeEnvelope.queryLevel).toBe('source-slice');
  });

  it('canonicalizes payload keys and preserves deterministic envelope equality', async () => {
    const projectContext = createProjectContext({
      repo: (request) => ({
        data: {
          available: false,
          details: request.payload ?? null,
          kind: request.kind,
          nextRefs: [],
          reason: 'pcq0-test-handler',
        },
      }),
    });
    const left = await projectContext.execute({
      kind: 'repo',
      payload: { z: 1, a: { z: 2, a: 1 } },
      scope: { projectRoot: '/tmp/project-context-pcq0', activeFile: 'src/index.ts' },
    });
    const right = await projectContext.execute({
      kind: 'repo',
      payload: { a: { a: 1, z: 2 }, z: 1 },
      scope: {
        activeFile: '/tmp/project-context-pcq0/src/index.ts',
        projectRoot: '/tmp/project-context-pcq0',
      },
    });

    expect(left).toStrictEqual(right);
  });

  it('keeps interface source limited to request checks, dispatch, envelope, projection, refs, and errors', () => {
    expect(PROJECT_CONTEXT_INTERFACE_ALLOWED_OPERATIONS).toEqual([
      'request-kind-validation',
      'scope-containment-check',
      'project-path-authority-check',
      'payload-canonicalization',
      'dispatch',
      'envelope-construction',
      'compact-projection',
      'size-limit-pruning',
      'redaction',
      'ref-selection',
      'query-error-shaping',
    ]);

    const interfaceDir = fileURLToPath(
      new URL('../src/service/project-context/interface', import.meta.url)
    );
    const source = fs
      .readdirSync(interfaceDir)
      .filter((fileName) => fileName.endsWith('.ts'))
      .map((fileName) => fs.readFileSync(path.join(interfaceDir, fileName), 'utf8'))
      .join('\n');

    expect(source).not.toMatch(
      /from ['"].*(?:source-graph|panorama|core\/discovery|core\/ast|ProjectGraph)/
    );
    expect(source).not.toMatch(/\b(?:MCP|adapter|manifest|parse source|assemble graphs)\b/i);
  });
});

describe('ProjectContext PCU-2 contract and path authority', () => {
  it('accepts one authoritative project identity and projects it into the envelope', async () => {
    const projectContext = createProjectContext({
      repo: (request) => ({
        data: {
          available: false,
          details: {
            displayName: request.project.displayName ?? null,
            identitySource: request.project.source ?? null,
            projectId: request.project.projectId ?? null,
            projectRoot: request.project.projectRoot,
          },
          kind: request.kind,
          nextRefs: [],
          reason: 'pcu2-authority-test',
        },
      }),
    });

    const envelope = await projectContext.execute({
      kind: 'repo',
      project: {
        displayName: 'Demo Project',
        projectId: 'project:demo',
        projectRoot: '/tmp/project-context-pcu2-demo',
        source: 'alembic',
      },
      scope: {
        activeFile: 'src/index.ts',
      },
    });

    expect(envelope.errors).toBeUndefined();
    expect(envelope.project).toMatchObject({
      displayName: 'Demo Project',
      projectId: 'project:demo',
      projectRoot: '/tmp/project-context-pcu2-demo',
    });
    expect(envelope.data).toMatchObject({
      details: {
        identitySource: 'alembic',
        projectId: 'project:demo',
        projectRoot: '/tmp/project-context-pcu2-demo',
      },
    });
  });

  it('rejects request roots that conflict with the authoritative identity', async () => {
    const envelope = await ProjectContext.execute({
      kind: 'space',
      project: {
        projectRoot: '/tmp/project-context-pcu2-authority',
        source: 'alembic',
      },
      scope: {
        projectRoot: '/tmp/project-context-pcu2-request',
      },
    });

    expect(envelope.queryLevel).toBe('space');
    expect(envelope.project.projectRoot).toBe('/tmp/project-context-pcu2-authority');
    expect(envelope.errors?.[0]).toMatchObject({
      code: 'project-root-conflict',
      path: '/tmp/project-context-pcu2-request',
      retryable: false,
      severity: 'error',
    });
  });

  it('does not retain project roots across queries on the same ProjectContext instance', async () => {
    const observedRoots: string[] = [];
    const projectContext = createProjectContext({
      repo: (request) => {
        observedRoots.push(request.scope.projectRoot);
        return {
          data: {
            available: false,
            kind: request.kind,
            nextRefs: [],
            reason: request.scope.projectRoot,
          },
        };
      },
    });

    const first = await projectContext.execute({
      kind: 'repo',
      project: { projectRoot: '/tmp/project-context-pcu2-first' },
      scope: {},
    });
    const second = await projectContext.execute({
      kind: 'repo',
      project: { projectRoot: '/tmp/project-context-pcu2-second' },
      scope: {},
    });

    expect(observedRoots).toEqual([
      '/tmp/project-context-pcu2-first',
      '/tmp/project-context-pcu2-second',
    ]);
    expect(first.project.projectRoot).toBe('/tmp/project-context-pcu2-first');
    expect(second.project.projectRoot).toBe('/tmp/project-context-pcu2-second');
  });

  it('keeps basic syntax imports inside ProjectContext providers, not interface code', () => {
    const projectContextDir = fileURLToPath(
      new URL('../src/service/project-context', import.meta.url)
    );
    const allowedBasicSyntaxConsumers = new Set([
      'fileFlow/extract.ts',
      'fileSymbols/extract.ts',
      'repo/repo.ts',
    ]);
    const offenders = readTypeScriptFiles(projectContextDir)
      .filter((file) =>
        /from ['"].*(?:core\/AstAnalyzer|core\/ast|core\/discovery)/.test(file.source)
      )
      .map((file) => path.relative(projectContextDir, file.path).replace(/\\/g, '/'))
      .filter((relativePath) => !allowedBasicSyntaxConsumers.has(relativePath));

    expect(offenders).toEqual([]);
  });
});

function readTypeScriptFiles(root: string): Array<{ path: string; source: string }> {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return readTypeScriptFiles(entryPath);
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts')) {
      return [];
    }
    return [{ path: entryPath, source: fs.readFileSync(entryPath, 'utf8') }];
  });
}
