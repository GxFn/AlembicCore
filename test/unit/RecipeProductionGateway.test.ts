/**
 * RecipeProductionGateway — 统一生产入口单元测试
 */

import { describe, expect, it, vi } from 'vitest';
import { BootstrapDedup } from '../../src/service/bootstrap/BootstrapDedup.js';
import {
  type CreateRecipeItem,
  type GatewayDeps,
  RecipeProductionGateway,
} from '../../src/service/knowledge/RecipeProductionGateway.js';

/* ═══════════════════ Mock Helpers ═══════════════════ */

function makeItem(overrides: Partial<CreateRecipeItem> = {}): CreateRecipeItem {
  return {
    title: 'WebSocket 客户端异步消息流模式',
    description: '使用 AsyncSequence 处理 WebSocket 实时消息流',
    trigger: '@websocket-client-async',
    kind: 'pattern',
    topicHint: 'networking',
    whenClause: 'When implementing real-time communication features',
    doClause: 'Use WebSocketClient AsyncSequence-based message stream for handling real-time data',
    dontClause: 'Do not use callback-based WebSocket handlers for message processing',
    coreCode:
      'let stream = try await WebSocketClient.connect(url)\nfor try await message in stream {\n  handle(message)\n}',
    content: {
      markdown:
        '# WebSocket 客户端异步消息流\n\n使用 Swift Concurrency 的 AsyncSequence 来处理 WebSocket 消息流，提供类型安全的实时通信抽象。这是本项目处理所有实时通信的标准化模式。\n\n' +
        '```swift\nlet stream = try await WebSocketClient.connect(url)\nfor try await message in stream {\n  handle(message)\n}\n```' +
        '\n\n来源: Sources/Networking/WebSocketClient.swift:L45\n\n该模式在生产环境中已得到验证，所有实时功能模块均采用此方式。',
      rationale: '基于 AsyncSequence 提供类型安全的流式处理，避免回调地狱',
    },
    reasoning: {
      whyStandard: '项目标准做法',
      sources: ['Sources/Networking/WebSocketClient.swift'],
      confidence: 0.9,
    },
    tags: ['networking', 'websocket'],
    headers: ['import Foundation'],
    language: 'swift',
    category: 'Network',
    knowledgeType: 'code-pattern',
    usageGuide: '### 使用指南\n在需要实时通信时使用本模式。',
    ...overrides,
  };
}

function makeMockKnowledgeService() {
  let idCounter = 0;
  return {
    create: vi.fn(async (data: Record<string, unknown>) => ({
      id: `recipe-${++idCounter}`,
      title: data.title as string,
      lifecycle: 'staging',
      kind: data.kind || 'pattern',
      ...data,
      toJSON() {
        return { id: this.id, title: this.title, lifecycle: this.lifecycle };
      },
    })),
    update: vi.fn(async (id: string, data: Record<string, unknown>) => ({
      id,
      title: `updated-${id}`,
      lifecycle: 'staging',
      kind: 'pattern',
      ...data,
    })),
    updateQuality: vi.fn(async () => ({ score: 0.85 })),
  };
}

function makeDeps(overrides: Partial<GatewayDeps> = {}): GatewayDeps {
  return {
    knowledgeService: makeMockKnowledgeService(),
    projectRoot: '/tmp/test-project',
    ...overrides,
  };
}

/* ═══════════════════ Tests ═══════════════════ */

describe('RecipeProductionGateway', () => {
  describe('create — validation', () => {
    it('应通过验证并创建有效 Recipe', async () => {
      const deps = makeDeps();
      const gateway = new RecipeProductionGateway(deps);

      const result = await gateway.create({
        source: 'agent-tool',
        items: [makeItem()],
        options: { skipSimilarityCheck: true, skipConsolidation: true },
      });

      expect(result.created).toHaveLength(1);
      expect(result.created[0].id).toBe('recipe-1');
      expect(result.created[0].title).toBe('WebSocket 客户端异步消息流模式');
      expect(result.rejected).toHaveLength(0);
      expect(deps.knowledgeService.create).toHaveBeenCalledOnce();
      expect(deps.knowledgeService.updateQuality).toHaveBeenCalledOnce();
    });

    it('应拒绝缺少必填字段的候选', async () => {
      const gateway = new RecipeProductionGateway(makeDeps());

      const result = await gateway.create({
        source: 'agent-tool',
        items: [{ title: 'incomplete' }],
        options: { skipSimilarityCheck: true, skipConsolidation: true },
      });

      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].reason).toBe('validation_failed');
      expect(result.rejected[0].errors.length).toBeGreaterThan(0);
      expect(result.created).toHaveLength(0);
    });

    it('应在统一校验层拒绝会话内重复 trigger', async () => {
      const gateway = new RecipeProductionGateway(makeDeps());

      const result = await gateway.create({
        source: 'agent-tool',
        items: [makeItem({ trigger: '@existing-trigger' })],
        options: {
          existingTriggers: new Set(['@existing-trigger']),
          skipConsolidation: true,
        },
      });

      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].errors.join('\n')).toContain('trigger 重复');
    });

    it('空 items 返回空结果', async () => {
      const gateway = new RecipeProductionGateway(makeDeps());

      const result = await gateway.create({
        source: 'agent-tool',
        items: [],
      });

      expect(result.created).toHaveLength(0);
      expect(result.rejected).toHaveLength(0);
    });

    it('批量提交应分别验证每个条目', async () => {
      const gateway = new RecipeProductionGateway(makeDeps());

      const result = await gateway.create({
        source: 'mcp-external',
        items: [
          makeItem(),
          { title: 'bad' },
          makeItem({
            title: '另一个完整的知识条目标题',
            trigger: '@another-trigger-unique',
            content: {
              markdown:
                '# 另一个完整条目\n\n这是一个完整的知识条目，用于测试批量提交时的独立验证逻辑。每个条目应该独立通过或失败。\n\n' +
                '```swift\nlet result = try await service.fetch()\nawait process(result)\n```' +
                '\n\n来源: Sources/Service/DataService.swift:L20\n\n此模式已在多个模块中使用。',
              rationale: '独立验证每个条目的完整性',
            },
          }),
        ],
        options: { skipSimilarityCheck: true, skipConsolidation: true },
      });

      // 第 1 条通过，第 2 条(index=1)验证失败，第 3 条可能因同批唯一性拒绝
      expect(result.rejected.length).toBeGreaterThanOrEqual(1);
      expect(result.rejected.some((r) => r.index === 1)).toBe(true);
      expect(result.created.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('create — similarity check', () => {
    it('应阻止与已有 Recipe 高度相似的候选', async () => {
      const findSimilar = vi.fn(() => [
        { file: 'existing.md', title: '已有 Recipe', similarity: 0.85 },
      ]);

      const gateway = new RecipeProductionGateway(makeDeps({ findSimilarRecipes: findSimilar }));

      const result = await gateway.create({
        source: 'agent-tool',
        items: [makeItem()],
        options: {
          skipSimilarityCheck: false,
          skipConsolidation: true,
          similarityThreshold: 0.7,
        },
      });

      expect(result.duplicates).toHaveLength(1);
      expect(result.duplicates[0].similarTo[0].similarity).toBe(0.85);
      expect(result.created).toHaveLength(0);
    });

    it('低相似度不应阻止创建', async () => {
      const findSimilar = vi.fn(() => [
        { file: 'existing.md', title: '远程相关', similarity: 0.4 },
      ]);

      const gateway = new RecipeProductionGateway(makeDeps({ findSimilarRecipes: findSimilar }));

      const result = await gateway.create({
        source: 'agent-tool',
        items: [makeItem()],
        options: {
          skipSimilarityCheck: false,
          skipConsolidation: true,
          similarityThreshold: 0.7,
        },
      });

      expect(result.duplicates).toHaveLength(0);
      expect(result.created).toHaveLength(1);
    });

    it('agent-tool 即使传入 skipSimilarityCheck=true 也必须执行相似度检查', async () => {
      const findSimilar = vi.fn(() => [{ file: 'existing.md', title: '高相似', similarity: 0.95 }]);

      const gateway = new RecipeProductionGateway(makeDeps({ findSimilarRecipes: findSimilar }));

      const result = await gateway.create({
        source: 'agent-tool',
        items: [makeItem()],
        options: { skipSimilarityCheck: true, skipConsolidation: true },
      });

      expect(findSimilar).toHaveBeenCalledOnce();
      expect(result.duplicates).toHaveLength(1);
      expect(result.created).toHaveLength(0);
    });

    it('仅 batch-import 可显式跳过相似度检查', async () => {
      const findSimilar = vi.fn(() => [{ file: 'existing.md', title: '高相似', similarity: 0.95 }]);

      const gateway = new RecipeProductionGateway(makeDeps({ findSimilarRecipes: findSimilar }));

      const result = await gateway.create({
        source: 'batch-import',
        items: [makeItem()],
        options: { skipSimilarityCheck: true, skipConsolidation: true },
      });

      expect(findSimilar).not.toHaveBeenCalled();
      expect(result.created).toHaveLength(1);
    });

    it('bootstrap 会话去重命中后不应被后续相似度阶段重新放回创建队列', async () => {
      const bootstrapDedup = new BootstrapDedup();
      const item = makeItem();
      bootstrapDedup.register({
        id: 'existing-session-recipe',
        title: item.title || '',
        category: item.category || '',
        coreCode: item.coreCode || '',
        doClause: item.doClause || '',
        dontClause: item.dontClause || '',
        guardPattern: item.content?.pattern,
      });
      const findSimilar = vi.fn(() => []);
      const gateway = new RecipeProductionGateway(makeDeps({ findSimilarRecipes: findSimilar }));

      const result = await gateway.create({
        source: 'agent-tool',
        items: [item],
        options: { bootstrapDedup, skipConsolidation: true },
      });

      expect(result.duplicates).toHaveLength(1);
      expect(result.created).toHaveLength(0);
      expect(findSimilar).not.toHaveBeenCalled();
    });
  });

  describe('create — consolidation', () => {
    it('应将 merge 建议转为 Proposal', async () => {
      const proposalRepo = {
        create: vi.fn(() => ({
          id: 'prop-1',
          status: 'observing',
          expiresAt: Date.now() + 72 * 3600_000,
        })),
      };

      const consolidationAdvisor = {
        analyzeBatch: vi.fn(() => ({
          items: [
            {
              index: 0,
              advice: {
                action: 'merge',
                confidence: 0.85,
                reason: '与已有 Recipe 高度重叠',
                targetRecipe: {
                  id: 'existing-1',
                  title: '已有 Recipe',
                  similarity: 0.8,
                },
              },
            },
          ],
        })),
      };

      const gateway = new RecipeProductionGateway(
        makeDeps({
          consolidationAdvisor,
          proposalRepository: proposalRepo,
        })
      );

      const result = await gateway.create({
        source: 'mcp-external',
        items: [makeItem()],
        options: { skipSimilarityCheck: true, skipConsolidation: false },
      });

      expect(result.merged).toHaveLength(1);
      expect(result.merged[0].type).toBe('update');
      expect(result.merged[0].targetRecipeId).toBe('existing-1');
      expect(result.merged[0].status).toBe('observing');
      expect(result.created).toHaveLength(0);
    });

    it('create 建议应正常创建', async () => {
      const consolidationAdvisor = {
        analyzeBatch: vi.fn(() => ({
          items: [
            {
              index: 0,
              advice: { action: 'create', confidence: 0.95, reason: '无重叠' },
            },
          ],
        })),
      };

      const gateway = new RecipeProductionGateway(makeDeps({ consolidationAdvisor }));

      const result = await gateway.create({
        source: 'mcp-external',
        items: [makeItem()],
        options: { skipSimilarityCheck: true, skipConsolidation: false },
      });

      expect(result.created).toHaveLength(1);
      expect(result.merged).toHaveLength(0);
    });

    it('pendingSemanticReview 应关联真实新 Recipe ID', async () => {
      const consolidationAdvisor = {
        analyzeBatch: vi.fn(() => ({
          items: [
            {
              index: 0,
              advice: {
                action: 'create',
                confidence: 0.64,
                reason: '语义相近但字段分析不明确',
                pendingSemanticReview: true,
                targetRecipe: { id: 'existing-1', title: 'Existing', similarity: 0.58 },
              },
            },
          ],
          internalOverlaps: [],
        })),
      };

      const gateway = new RecipeProductionGateway(makeDeps({ consolidationAdvisor }));

      const result = await gateway.create({
        source: 'mcp-external',
        items: [makeItem()],
        options: { skipSimilarityCheck: true, skipConsolidation: false },
      });

      expect(result.created).toMatchObject([{ index: 0, id: 'recipe-1' }]);
      expect(result.pendingSemanticReview).toMatchObject([
        {
          index: 0,
          title: 'WebSocket 客户端异步消息流模式',
          newRecipeId: 'recipe-1',
          createdRecipe: {
            id: 'recipe-1',
            title: 'WebSocket 客户端异步消息流模式',
            lifecycle: 'staging',
          },
          relatedRecipe: { id: 'existing-1' },
        },
      ]);
    });

    it('skipConsolidation=true 应跳过融合分析', async () => {
      const consolidationAdvisor = {
        analyzeBatch: vi.fn(),
      };

      const gateway = new RecipeProductionGateway(makeDeps({ consolidationAdvisor }));

      const result = await gateway.create({
        source: 'mcp-external',
        items: [makeItem()],
        options: { skipSimilarityCheck: true, skipConsolidation: true },
      });

      expect(consolidationAdvisor.analyzeBatch).not.toHaveBeenCalled();
      expect(result.created).toHaveLength(1);
    });

    it('无 ProposalRepository 时 merge 建议应变为 blocked', async () => {
      const consolidationAdvisor = {
        analyzeBatch: vi.fn(() => ({
          items: [
            {
              index: 0,
              advice: {
                action: 'merge',
                confidence: 0.85,
                reason: '重叠',
                targetRecipe: { id: 'x', title: 'X', similarity: 0.8 },
              },
            },
          ],
        })),
      };

      const gateway = new RecipeProductionGateway(
        makeDeps({ consolidationAdvisor, proposalRepository: null })
      );

      const result = await gateway.create({
        source: 'mcp-external',
        items: [makeItem()],
        options: { skipSimilarityCheck: true, skipConsolidation: false },
      });

      expect(result.blocked).toHaveLength(1);
      expect(result.merged).toHaveLength(0);
      expect(result.created).toHaveLength(0);
    });
  });

  describe('create — supersede', () => {
    it('应通过 EvolutionGateway 创建 deprecate 提案', async () => {
      const evolutionGateway = {
        submit: vi.fn(async () => ({
          recipeId: 'old-recipe-id',
          action: 'deprecate',
          outcome: 'proposal-created',
          proposalId: 'supersede-1',
        })),
      };

      const gateway = new RecipeProductionGateway(makeDeps({ evolutionGateway }));

      const result = await gateway.create({
        source: 'agent-tool',
        items: [makeItem()],
        options: {
          skipSimilarityCheck: true,
          skipConsolidation: true,
          supersedes: 'old-recipe-id',
        },
      });

      expect(result.created).toHaveLength(1);
      expect(result.supersedeProposal).not.toBeNull();
      expect(result.supersedeProposal?.proposalId).toBe('supersede-1');
      expect(evolutionGateway.submit).toHaveBeenCalledWith(
        expect.objectContaining({
          recipeId: 'old-recipe-id',
          action: 'deprecate',
          confidence: 0.9,
        })
      );
    });

    it('降级到 ProposalRepo 当无 EvolutionGateway 时', async () => {
      const proposalRepo = {
        create: vi.fn(() => ({
          id: 'supersede-fallback',
          status: 'observing',
          expiresAt: Date.now() + 72 * 3600_000,
        })),
      };

      const gateway = new RecipeProductionGateway(makeDeps({ proposalRepository: proposalRepo }));

      const result = await gateway.create({
        source: 'agent-tool',
        items: [makeItem()],
        options: {
          skipSimilarityCheck: true,
          skipConsolidation: true,
          supersedes: 'old-recipe-id',
        },
      });

      expect(result.created).toHaveLength(1);
      expect(result.supersedeProposal).not.toBeNull();
      expect(result.supersedeProposal?.proposalId).toBe('supersede-fallback');
      expect(proposalRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'deprecate',
          targetRecipeId: 'old-recipe-id',
        })
      );
    });

    it('无 supersedes 参数时不创建替代提案', async () => {
      const proposalRepo = { create: vi.fn() };
      const gateway = new RecipeProductionGateway(makeDeps({ proposalRepository: proposalRepo }));

      const result = await gateway.create({
        source: 'agent-tool',
        items: [makeItem()],
        options: { skipSimilarityCheck: true, skipConsolidation: true },
      });

      expect(result.supersedeProposal).toBeNull();
    });
  });

  describe('create — data preparation', () => {
    it('应正确组装 KnowledgeService 数据', async () => {
      const deps = makeDeps();
      const gateway = new RecipeProductionGateway(deps);

      await gateway.create({
        source: 'agent-tool',
        items: [makeItem()],
        options: { skipSimilarityCheck: true, skipConsolidation: true },
      });

      const createCall = (deps.knowledgeService.create as ReturnType<typeof vi.fn>).mock.calls[0];
      const data = createCall[0] as Record<string, unknown>;

      expect(data.title).toBe('WebSocket 客户端异步消息流模式');
      expect(data.source).toBe('agent');
      expect(data.language).toBe('swift');
      expect(data.category).toBe('Network');
      expect(data.trigger).toBe('@websocket-client-async');
      expect(data.sourceFile).toBe('');
    });

    it('应透传关系、模块和宿主分析元数据到 KnowledgeService', async () => {
      const deps = makeDeps();
      const gateway = new RecipeProductionGateway(deps);

      await gateway.create({
        source: 'host-agent',
        items: [
          makeItem({
            moduleName: 'Networking',
            headerPaths: ['Sources/Networking/WebSocketClient.swift'],
            includeHeaders: true,
            sourceFile: 'Sources/Networking/WebSocketClient.swift',
            sourceCandidateId: 'candidate-1',
            relations: {
              depends_on: [
                {
                  target: '00000000-0000-4000-a000-000000000001',
                  description: 'uses transport abstraction',
                },
              ],
            },
            metadata: {
              sourceGraphRef: 'source-graph:g1',
              sourceSliceRef: 'source-slice:s1',
            },
          }),
        ],
        options: { skipSimilarityCheck: true, skipConsolidation: true },
      });

      const createCall = (deps.knowledgeService.create as ReturnType<typeof vi.fn>).mock.calls[0];
      const data = createCall[0] as Record<string, unknown>;

      expect(data.moduleName).toBe('Networking');
      expect(data.headerPaths).toEqual(['Sources/Networking/WebSocketClient.swift']);
      expect(data.includeHeaders).toBe(true);
      expect(data.sourceFile).toBe('Sources/Networking/WebSocketClient.swift');
      expect(data.sourceCandidateId).toBe('candidate-1');
      expect(data.relations).toEqual({
        depends_on: [
          {
            target: '00000000-0000-4000-a000-000000000001',
            description: 'uses transport abstraction',
          },
        ],
      });
      expect(data.agentNotes).toBe(
        JSON.stringify({
          metadata: { sourceGraphRef: 'source-graph:g1', sourceSliceRef: 'source-slice:s1' },
        })
      );
    });

    it('应将同批稳定关系键解析为真实 Recipe UUID 后回写 relations', async () => {
      const deps = makeDeps();
      const gateway = new RecipeProductionGateway(deps);

      const result = await gateway.create({
        source: 'host-agent',
        items: [
          makeItem({
            title: 'Base network transport pattern',
            trigger: '@base-network-transport',
            localRelationKey: 'transport-base',
          }),
          makeItem({
            title: 'WebSocket stream adapter pattern',
            trigger: '@websocket-stream-adapter',
            relations: {
              depends_on: [{ target: 'local:transport-base', description: 'uses base transport' }],
            },
          }),
        ],
        options: { skipSimilarityCheck: true, skipConsolidation: true },
      });

      expect(result.created).toHaveLength(2);
      expect(deps.knowledgeService.update).toHaveBeenCalledWith(
        'recipe-2',
        expect.objectContaining({
          relations: expect.objectContaining({
            depends_on: [{ target: 'recipe-1', description: 'uses base transport' }],
          }),
        }),
        { userId: 'host-agent' }
      );
    });

    it('应使用正确的 userId', async () => {
      const deps = makeDeps();
      const gateway = new RecipeProductionGateway(deps);

      await gateway.create({
        source: 'mcp-external',
        items: [makeItem()],
        options: { skipSimilarityCheck: true, skipConsolidation: true },
      });

      const createCall = (deps.knowledgeService.create as ReturnType<typeof vi.fn>).mock.calls[0];
      const ctx = createCall[1] as { userId: string };
      expect(ctx.userId).toBe('mcp');
    });

    it('应把旧 ide-agent 来源归一为 host-agent 写入', async () => {
      const deps = makeDeps();
      const gateway = new RecipeProductionGateway(deps);

      await gateway.create({
        source: 'ide-agent',
        items: [makeItem()],
        options: { skipSimilarityCheck: true, skipConsolidation: true },
      });

      const createCall = (deps.knowledgeService.create as ReturnType<typeof vi.fn>).mock.calls[0];
      const data = createCall[0] as Record<string, unknown>;
      const ctx = createCall[1] as { userId: string };
      expect(data.source).toBe('host-agent');
      expect(ctx.userId).toBe('host-agent');
    });

    it('created.raw 应包含完整 saved 对象', async () => {
      const gateway = new RecipeProductionGateway(makeDeps());

      const result = await gateway.create({
        source: 'agent-tool',
        items: [makeItem()],
        options: { skipSimilarityCheck: true, skipConsolidation: true },
      });

      expect(result.created[0].raw).toBeDefined();
      expect(result.created[0].raw.title).toBe('WebSocket 客户端异步消息流模式');
      expect(result.created[0].raw.kind).toBe('pattern');
    });
  });

  describe('create — error handling', () => {
    it('KnowledgeService.create 失败应记入 rejected', async () => {
      const knowledgeService = {
        create: vi.fn(async () => {
          throw new Error('DB connection failed');
        }),
        updateQuality: vi.fn(),
      };

      const gateway = new RecipeProductionGateway(makeDeps({ knowledgeService }));

      const result = await gateway.create({
        source: 'agent-tool',
        items: [makeItem()],
        options: { skipSimilarityCheck: true, skipConsolidation: true },
      });

      expect(result.created).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].reason).toBe('create_failed');
      expect(result.rejected[0].errors[0]).toContain('DB connection failed');
    });

    it('ConsolidationAdvisor 异常应降级为直接提交', async () => {
      const consolidationAdvisor = {
        analyzeBatch: vi.fn(() => {
          throw new Error('advisor crash');
        }),
      };

      const gateway = new RecipeProductionGateway(makeDeps({ consolidationAdvisor }));

      const result = await gateway.create({
        source: 'mcp-external',
        items: [makeItem()],
        options: { skipSimilarityCheck: true, skipConsolidation: false },
      });

      // 应降级为正常创建
      expect(result.created).toHaveLength(1);
    });

    it('Quality scoring 失败不应阻塞创建', async () => {
      const knowledgeService = makeMockKnowledgeService();
      knowledgeService.updateQuality = vi.fn(async () => {
        throw new Error('scorer unavailable');
      });

      const gateway = new RecipeProductionGateway(makeDeps({ knowledgeService }));

      const result = await gateway.create({
        source: 'agent-tool',
        items: [makeItem()],
        options: { skipSimilarityCheck: true, skipConsolidation: true },
      });

      expect(result.created).toHaveLength(1);
    });
  });

  describe('U1 #5 — moduleName canonical 派生', () => {
    const opts = { skipSimilarityCheck: true, skipConsolidation: true };

    it('从 sourceRefs 落点派生 canonical 模块 name（未显式给 moduleName）', async () => {
      const deps = makeDeps({
        knownModuleNames: ['auth', 'payment'],
        resolveModuleFromSourceRefs: (refs) =>
          refs.some((r) => r.includes('auth/')) ? 'auth' : undefined,
      });
      await new RecipeProductionGateway(deps).create({
        source: 'agent-tool',
        items: [makeItem({ sourceRefs: ['src/auth/login.ts'] })],
        options: opts,
      });
      expect(vi.mocked(deps.knowledgeService.create).mock.calls[0][0].moduleName).toBe('auth');
    });

    it('Agent 显式 moduleName 属已知轴 → 保留；越界 → 留空（拒越界，不再恒空兜底）', async () => {
      const inAxis = makeDeps({ knownModuleNames: ['auth', 'payment'] });
      await new RecipeProductionGateway(inAxis).create({
        source: 'agent-tool',
        items: [makeItem({ moduleName: 'payment' })],
        options: opts,
      });
      expect(vi.mocked(inAxis.knowledgeService.create).mock.calls[0][0].moduleName).toBe('payment');

      const outAxis = makeDeps({ knownModuleNames: ['auth', 'payment'] });
      await new RecipeProductionGateway(outAxis).create({
        source: 'agent-tool',
        items: [makeItem({ moduleName: 'nonexistent-module' })],
        options: opts,
      });
      expect(vi.mocked(outAxis.knowledgeService.create).mock.calls[0][0].moduleName).toBe('');
    });

    it('派生不出（resolver 返回 undefined、无显式）→ 留空+诊断', async () => {
      const deps = makeDeps({
        knownModuleNames: ['auth'],
        resolveModuleFromSourceRefs: () => undefined,
      });
      await new RecipeProductionGateway(deps).create({
        source: 'agent-tool',
        items: [makeItem({ sourceRefs: ['src/unknown/x.ts'] })],
        options: opts,
      });
      expect(vi.mocked(deps.knowledgeService.create).mock.calls[0][0].moduleName).toBe('');
    });

    it('未注入模块轴 deps → 退回原行为（显式透传）', async () => {
      const deps = makeDeps();
      await new RecipeProductionGateway(deps).create({
        source: 'agent-tool',
        items: [makeItem({ moduleName: 'whatever-passthrough' })],
        options: opts,
      });
      expect(vi.mocked(deps.knowledgeService.create).mock.calls[0][0].moduleName).toBe(
        'whatever-passthrough'
      );
    });
  });
});
