import { KnowledgeService } from '../src/knowledge.js';
import { FileWriteError } from '../src/repository/knowledge/KnowledgeUnitOfWork.js';
import type { DivergenceError } from '../src/shared/errors/index.js';
import { createKnowledgeRuntime } from './support/knowledge-runtime.js';

describe('KnowledgeService file-first commands', () => {
  let env: Awaited<ReturnType<typeof createKnowledgeRuntime>>;
  let service: KnowledgeService;
  let events: string[];
  const context = { userId: 'reviewer' };
  const id = '77777777-7777-4777-8777-777777777777';
  const data = {
    id,
    title: 'Durable knowledge',
    content: { markdown: 'Original content' },
    language: 'typescript',
    category: 'architecture',
  };
  const commands = ['create', 'update', 'quality', 'deprecate'] as const;
  type Command = (typeof commands)[number];

  beforeEach(async () => {
    env = await createKnowledgeRuntime();
    events = [];
    service = new KnowledgeService(
      env.repo as unknown as ConstructorParameters<typeof KnowledgeService>[0],
      { log: async () => {} },
      null,
      null,
      {
        fileWriter: env.writer,
        qualityScorer: {
          score: () => ({
            score: 0.8,
            grade: 'A',
            dimensions: { completeness: 0.8, deliveryReady: 0.8, contentDepth: 0.8 },
          }),
        },
        eventBus: { emit: (event) => Boolean(events.push(String(event))) },
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    env.close();
  });

  function run(command: Command) {
    switch (command) {
      case 'create':
        return service.create(data, context);
      case 'update':
        return service.update(id, { content: { markdown: 'Updated content' } }, context);
      case 'quality':
        return service.updateQuality(id, context);
      case 'deprecate':
        return service.deprecate(id, 'No longer applicable', context);
    }
  }

  const expected = {
    create: { lifecycle: 'pending' },
    update: { content: { markdown: 'Updated content' } },
    quality: { quality: { overall: 0.8 }, stats: { authority: 4 } },
    deprecate: { lifecycle: 'deprecated', rejectionReason: 'No longer applicable' },
  };

  // 每条公开命令验证真实 DB 故障、真实读回丢失及文件 port 拒绝，统一验证恢复而非重复 mock 协议。
  describe.each(commands)('%s', (command) => {
    beforeEach(async () => {
      if (command !== 'create') {
        await env.seed({ ...data, lifecycle: 'active' });
      }
    });

    it('commits durable truth that survives synchronization', async () => {
      await run(command);
      const saved = await env.repo.findById(id);
      expect(saved).toMatchObject(expected[command]);
      await env.sync();
      expect(await env.repo.findById(id)).toMatchObject(expected[command]);
    });

    it('aborts before DB mutation when the file store rejects the write', async () => {
      const before = (await env.repo.findById(id))?.toJSON() ?? null;
      vi.spyOn(
        env.writer,
        command === 'deprecate' ? 'moveOnLifecycleChange' : 'persist'
      ).mockReturnValue(null);
      await expect(run(command)).rejects.toBeInstanceOf(FileWriteError);
      expect((await env.repo.findById(id))?.toJSON() ?? null).toEqual(before);
      expect(events).toEqual([]);
    });

    it.each([
      'abort',
      'missing-readback',
      'ignored-write',
    ] as const)('reports %s as divergence and sync can restore the durable file', async (fault) => {
      const verb = command === 'create' ? 'INSERT' : 'UPDATE';
      const trigger =
        fault === 'ignored-write'
          ? `BEFORE ${verb} ON knowledge_entries BEGIN SELECT RAISE(IGNORE); END`
          : fault === 'abort'
            ? `BEFORE ${verb} ON knowledge_entries BEGIN SELECT RAISE(ABORT, 'injected DB failure'); END`
            : `AFTER ${verb} ON knowledge_entries BEGIN DELETE FROM knowledge_entries WHERE id = NEW.id; END`;
      env.runtime.sqlite.exec(`CREATE TRIGGER reject_command ${trigger};`);

      await expect(run(command)).rejects.toMatchObject({
        name: 'DivergenceError',
        details: { entryIds: [id], fileOpsCompleted: 1, reconcileVia: 'KnowledgeSyncService.sync' },
      } satisfies Partial<DivergenceError>);
      expect(events).toEqual([]);
      env.runtime.sqlite.exec('DROP TRIGGER reject_command');
      await env.sync();
      expect(await env.repo.findById(id)).toMatchObject(expected[command]);
    });
  });
});
