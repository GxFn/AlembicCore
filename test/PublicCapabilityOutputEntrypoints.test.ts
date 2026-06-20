import { describe, expect, it } from 'vitest';
import { KnowledgeEntry } from '../src/domain/knowledge/KnowledgeEntry.js';
import type {
  ProjectContextEnvelope,
  ProjectContextRequest,
  ProjectContextResult,
} from '../src/domain/project-context/index.js';
import {
  FrameworkEnhancements,
  getFrameworkEnhancements,
  initFrameworkEnhancements,
  resolveFrameworkEnhancements,
} from '../src/enhancement.js';
import {
  createProjectContextCapabilities,
  type ProjectContextCapabilities as ProjectContextCapabilitiesContract,
} from '../src/project-context-capabilities.js';
import {
  createRecipeContextCapabilitiesFromCore,
  type RecipeContextCoreServices,
} from '../src/recipe-context-capabilities.js';
import {
  CapabilityProbe,
  CORE_GRAMMAR_RESOURCE_FILES,
  listCoreGrammarResources,
} from '../src/test-fixtures.js';

describe('public capability output entrypoints', () => {
  it('exposes framework enhancement resolution through a stable facade', async () => {
    const registry = await initFrameworkEnhancements();
    const direct = await resolveFrameworkEnhancements({
      detectedFrameworks: ['react'],
      primaryLanguage: 'typescript',
    });
    const viaObject = await FrameworkEnhancements.resolve({
      detectedFrameworks: ['react'],
      primaryLanguage: 'typescript',
    });

    expect(registry.all().length).toBeGreaterThan(0);
    expect(direct.map((pack) => pack.id)).toContain('react');
    expect(viaObject.map((pack) => pack.id)).toContain('react');
    expect(getFrameworkEnhancements()).toBe(registry);
  });

  it('wraps ProjectContext request kinds without bypassing execute()', async () => {
    const seen: ProjectContextRequest[] = [];
    const projectContext = {
      execute: async (
        input: ProjectContextRequest
      ): Promise<ProjectContextEnvelope<ProjectContextResult>> => {
        seen.push(input);
        return {
          contractVersion: 1,
          data: { kind: input.kind, items: [] } as unknown as ProjectContextResult,
          project: {
            displayName: input.project?.displayName,
            projectId: input.project?.projectId,
            projectRoot: input.project?.projectRoot ?? input.scope.projectRoot ?? '/tmp/project',
          },
          queryLevel: input.kind,
          refs: [],
        };
      },
    };
    const capabilities: ProjectContextCapabilitiesContract =
      createProjectContextCapabilities(projectContext);

    const envelope = await capabilities.executeFileSymbolsQuery({
      project: { displayName: 'Fixture', projectRoot: '/tmp/project' },
      scope: { activeFile: 'src/app.ts', projectRoot: '/tmp/project' },
    });

    expect(seen[0]?.kind).toBe('file-symbols');
    expect(envelope.queryLevel).toBe('file-symbols');
  });

  it('routes RecipeContext capabilities through high-level Core services', async () => {
    const recipe = new KnowledgeEntry({
      category: 'Utility',
      content: { pattern: 'service.sync()', rationale: 'deterministic' },
      description: 'Use when Core owns reusable persistence.',
      id: 'r1',
      kind: 'pattern',
      knowledgeType: 'code-pattern',
      language: 'typescript',
      lifecycle: 'active',
      moduleName: 'service/vector',
      reasoning: {
        confidence: 0.9,
        sources: ['src/service/vector/VectorService.ts'],
        whyStandard: 'std',
      },
      sourceFile: 'src/service/vector/VectorService.ts',
      tags: ['architecture'],
      title: 'Recipe r1',
    });
    const services: RecipeContextCoreServices = {
      knowledge: {
        get: async (id) => (id === 'r1' ? recipe : null),
        list: async () => [recipe],
      },
      sourceRefRepository: {
        findByRecipeId: () => [],
        findBySourcePath: () => [],
        findByStatus: () => [],
        findRenamed: () => [],
        findStale: () => [],
      },
    };
    const capabilities = createRecipeContextCapabilitiesFromCore(services);

    const envelope = await capabilities.readDetail({ ref: 'r1' });

    expect(envelope.queryKind).toBe('detail');
    expect((envelope.data as { recipe?: { id?: string } }).recipe?.id).toBe('r1');
  });

  it('exposes test fixture imports without keeping consumers on old core routes', () => {
    const resources = listCoreGrammarResources();

    expect(CapabilityProbe).toBeInstanceOf(Function);
    expect(resources).toHaveLength(CORE_GRAMMAR_RESOURCE_FILES.length);
  });
});
