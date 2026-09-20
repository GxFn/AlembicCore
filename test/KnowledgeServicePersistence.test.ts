import fs from 'node:fs';
import path from 'node:path';
import { KnowledgeGraphService, KnowledgeService } from '../src/knowledge.js';
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
    service = new KnowledgeService(env.repo, { log: async () => {} }, null, null, {
      fileWriter: env.writer,
      edgeRepo: env.repositories.knowledgeEdgeRepository,
      proposalRepo: env.repositories.proposalRepository,
      qualityScorer: {
        score: () => ({
          score: 0.8,
          grade: 'A',
          dimensions: { completeness: 0.8, deliveryReady: 0.8, contentDepth: 0.8 },
        }),
      },
      eventBus: { emit: (event) => Boolean(events.push(String(event))) },
    });
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

  describe.each([false, true])('legacy DB-only readback (eventBus=%s)', (withEvents) => {
    it.each([
      'create',
      'update',
      'deprecate',
    ] as const)('preserves %s null/error and audit ordering', async (command) => {
      if (command !== 'create') {
        await env.seed({ ...data, lifecycle: 'active' });
      }
      service._fileWriter = null;
      service._eventBus = withEvents ? service._eventBus : null;
      const audit = vi.spyOn(service.auditLogger, 'log');
      const verb = command === 'create' ? 'INSERT' : 'UPDATE';
      env.runtime.sqlite.exec(`CREATE TRIGGER remove_readback AFTER ${verb} ON knowledge_entries
          BEGIN DELETE FROM knowledge_entries WHERE id = NEW.id; END;`);

      if (command === 'create' || withEvents) {
        await expect(run(command)).rejects.toMatchObject({
          name: 'TypeError',
          message: `Cannot read properties of null (reading '${command === 'create' ? 'id' : 'toJSON'}')`,
        });
      } else {
        await expect(run(command)).resolves.toBeNull();
      }
      expect(await env.repo.findById(id)).toBeNull();
      expect(audit).toHaveBeenCalledTimes(command === 'create' ? 0 : 1);
      expect(events).toEqual([]);
    });
  });

  it('keeps the legacy afterPublish hook when DB-only publish returns null', async () => {
    await env.seed({
      ...data,
      lifecycle: 'pending',
      category: 'guard',
      knowledgeType: 'boundary-constraint',
    });
    service._fileWriter = null;
    service._eventBus = null;
    const afterPublish = vi.fn();
    service._afterPublish = afterPublish;
    env.runtime.sqlite.exec(`CREATE TRIGGER remove_readback AFTER UPDATE ON knowledge_entries
      BEGIN DELETE FROM knowledge_entries WHERE id = NEW.id; END;`);
    await expect(service.publish(id, context)).resolves.toBeNull();
    await Promise.resolve();
    expect(afterPublish).toHaveBeenCalledOnce();
  });

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

  it('persists automatically discovered relationships through file synchronization', async () => {
    const target = await env.seed({
      ...data,
      id: undefined,
      lifecycle: 'active',
      title: 'Related entry',
    });
    service._knowledgeGraphService = new KnowledgeGraphService(
      env.repositories.knowledgeEdgeRepository
    );
    const created = await service.create(data, context);
    const related = () =>
      env.repo.findById(created.id).then((entry) => entry?.relations.toJSON().related);
    await expect
      .poll(related)
      .toContainEqual({ target: target.id, description: 'auto-discovered' });
    await env.sync();
    expect(await related()).toContainEqual({ target: target.id, description: 'auto-discovered' });
  });

  it('keeps reverse-reference cleanup durable after deleting its target', async () => {
    await env.seed({ ...data, lifecycle: 'active' });
    const referrer = await env.seed({
      ...data,
      id: undefined,
      title: 'Referring entry',
      relations: { related: [{ target: id, description: 'old reference' }] },
    });
    await service.delete(id, context);
    const related = () =>
      env.repo.findById(referrer.id).then((entry) => entry?.relations.toJSON().related);
    await expect.poll(related).toEqual([]);
    await env.sync();
    expect(await related()).toEqual([]);
    expect(await env.repo.findById(id)).toBeNull();
  });

  it('does not restore a deleted entry when an already-read background relation task resumes', async () => {
    const source = await env.seed({ ...data, lifecycle: 'active' });
    await env.seed({ ...data, id: undefined, title: 'Related target', lifecycle: 'active' });
    service._knowledgeGraphService = new KnowledgeGraphService(
      env.repositories.knowledgeEdgeRepository
    );
    const find = env.repo.findById.bind(env.repo);
    let release!: () => void;
    let captured!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      captured = resolve;
    });
    let block = true;
    vi.spyOn(env.repo, 'findById').mockImplementation(async (entryId) => {
      const entry = await find(entryId);
      if (entryId === id && block) {
        block = false;
        captured();
        await gate;
      }
      return entry;
    });
    const background = service._autoDiscoverRelations(id, source);
    await ready;
    try {
      await service.delete(id, context);
    } finally {
      release();
    }
    await background;
    expect(fs.existsSync(path.join(env.root, source.sourceFile!))).toBe(false);
    await env.sync();
    expect(await env.repo.findById(id)).toBeNull();
  });

  it('keeps background writes cancelled until every concurrent deletion has finished', async () => {
    const source = await env.seed({ ...data, lifecycle: 'active' });
    await env.seed({ ...data, id: undefined, title: 'Related target', lifecycle: 'active' });
    service._knowledgeGraphService = new KnowledgeGraphService(
      env.repositories.knowledgeEdgeRepository
    );
    const firstRead = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    const autoRead = Promise.withResolvers<void>();
    const releaseAuto = Promise.withResolvers<void>();
    const find = env.repo.findById.bind(env.repo);
    let first = true;
    let captureAuto = false;
    vi.spyOn(env.repo, 'findById').mockImplementation(async (entryId) => {
      const entry = await find(entryId);
      if (entryId === id && first) {
        first = false;
        firstRead.resolve();
        await releaseFirst.promise;
      } else if (entryId === id && captureAuto) {
        captureAuto = false;
        autoRead.resolve();
        await releaseAuto.promise;
      }
      return entry;
    });
    const olderDelete = service.delete(id, context);
    await firstRead.promise;
    vi.spyOn(env.writer, 'remove').mockImplementationOnce(() => {
      throw new Error('newer deletion failed');
    });
    await expect(service.delete(id, context)).rejects.toBeInstanceOf(FileWriteError);
    captureAuto = true;
    const background = service._autoDiscoverRelations(id, source);
    // 旧实现会读入快照后等待；正确实现直接取消，二者均可确定性推进，不用定时睡眠。
    await Promise.race([autoRead.promise, background]);
    releaseFirst.resolve();
    try {
      await olderDelete;
    } finally {
      releaseAuto.resolve();
    }
    await background;
    captureAuto = false;
    expect(fs.existsSync(path.join(env.root, source.sourceFile!))).toBe(false);
    await env.sync();
    expect(await env.repo.findById(id)).toBeNull();
  });

  describe('delete', () => {
    let file: string;
    beforeEach(async () => {
      const entry = await env.seed({ ...data, lifecycle: 'active' });
      file = path.join(env.root, entry.sourceFile!);
    });

    it.each([
      'unlink',
      'ambiguous-owner',
    ] as const)('preserves DB truth on %s failure', async (fault) => {
      if (fault === 'unlink') {
        const unlink = fs.unlinkSync.bind(fs);
        vi.spyOn(fs, 'unlinkSync').mockImplementation((target) => {
          if (target === file) {
            throw new Error('injected unlink failure');
          }
          unlink(target);
        });
      } else {
        fs.writeFileSync(
          file,
          fs.readFileSync(file, 'utf8').replace(/^id:.*$/m, `id: ${id}\nid: ${id}`)
        );
      }
      await expect(service.delete(id, context)).rejects.toBeInstanceOf(FileWriteError);
      expect(await env.repo.findById(id)).not.toBeNull();
      expect(fs.existsSync(file)).toBe(true);
      expect(events).toEqual([]);
    });

    it('retains deletion of an index row whose file is already absent', async () => {
      fs.unlinkSync(file);
      expect(await service.delete(id, context)).toEqual({ success: true, id });
      expect(await env.repo.findById(id)).toBeNull();
    });

    it('deletes dependent proposal, warning and lifecycle rows in the repository transaction', async () => {
      const db = env.runtime.sqlite;
      db.prepare(
        "INSERT INTO evolution_proposals (id, type, target_recipe_id, source, proposed_at, expires_at) VALUES ('p', 'update', ?, 'test', 0, 100)"
      ).run(id);
      db.prepare(
        "INSERT INTO recipe_warnings (id, type, target_recipe_id, detected_at) VALUES ('w', 'redundancy', ?, 0)"
      ).run(id);
      db.prepare(
        "INSERT INTO lifecycle_transition_events (id, recipe_id, from_state, to_state, trigger, proposal_id, created_at) VALUES ('e', ?, 'pending', 'active', 'test', 'p', 0)"
      ).run(id);
      db.exec(
        "CREATE TRIGGER reject_delete BEFORE DELETE ON knowledge_entries BEGIN SELECT RAISE(ABORT, 'blocked deletion'); END;"
      );
      await expect(env.repo.delete(id)).rejects.toThrow('blocked deletion');
      for (const table of [
        'evolution_proposals',
        'recipe_warnings',
        'lifecycle_transition_events',
      ]) {
        expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 1 });
      }
      db.exec('DROP TRIGGER reject_delete');
      await service.delete(id, context);
      for (const table of [
        'knowledge_entries',
        'evolution_proposals',
        'recipe_warnings',
        'lifecycle_transition_events',
      ]) {
        expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
      }
    });

    it.each([
      'ABORT',
      'IGNORE',
    ])('reports a DB %s after file removal and supports retry', async (fault) => {
      const action =
        fault === 'ABORT' ? "RAISE(ABORT, 'injected delete failure')" : 'RAISE(IGNORE)';
      env.runtime.sqlite.exec(
        `CREATE TRIGGER reject_delete BEFORE DELETE ON knowledge_entries BEGIN SELECT ${action}; END;`
      );
      await expect(service.delete(id, context)).rejects.toMatchObject({
        name: 'DivergenceError',
        details: { entryIds: [id], reconcileVia: 'KnowledgeService.delete' },
      });
      expect(fs.existsSync(file)).toBe(false);
      expect(await env.repo.findById(id)).not.toBeNull();
      expect(events).toEqual([]);
      env.runtime.sqlite.exec('DROP TRIGGER reject_delete');
      await service.delete(id, context);
      expect(await env.repo.findById(id)).toBeNull();
    });
  });
});
