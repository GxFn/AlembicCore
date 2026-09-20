import { GuardCheckEngine, GuardService } from '../src/guard.js';
import { FileWriteError } from '../src/repository/knowledge/KnowledgeUnitOfWork.js';
import { DivergenceError } from '../src/shared/errors/index.js';
import { createKnowledgeRuntime } from './support/knowledge-runtime.js';

describe('GuardService public persistence', () => {
  let env: Awaited<ReturnType<typeof createKnowledgeRuntime>>;
  let repo: typeof env.repo;
  let writer: typeof env.writer;
  let engine: GuardCheckEngine;
  const audit = { log: async () => {} };
  const context = { userId: 'reviewer' };
  const ruleData = {
    name: 'Durable Guard rule',
    description: 'Do not use BAD.',
    pattern: 'BAD',
    languages: ['typescript'],
  };

  beforeEach(async () => {
    env = await createKnowledgeRuntime();
    ({ repo, writer } = env);
    engine = new GuardCheckEngine(env.runtime.connection, { knowledgeRepo: repo });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    env.close();
  });

  function service(fileStore = true) {
    return new GuardService(
      repo as unknown as ConstructorParameters<typeof GuardService>[0],
      audit,
      null,
      fileStore ? { fileStore: writer, guardCheckEngine: engine } : {}
    );
  }

  async function seed() {
    return env.seed({
      title: ruleData.name,
      lifecycle: 'active',
      kind: 'rule',
      knowledgeType: 'boundary-constraint',
      language: 'typescript',
      content: { markdown: ruleData.description },
      constraints: {
        guards: [{ pattern: 'BAD', severity: 'warning', message: ruleData.description }],
      },
    });
  }

  test('create, disable and enable persist through sync and refresh cached checks', async () => {
    const guard = service();
    // 先填充空 DB 规则缓存，创建后须立即可检查。
    await guard.checkCode('BAD', { language: 'typescript' });
    const created = await guard.createRule(ruleData, context);
    await env.sync();
    expect((await repo.findById(created.id))?.lifecycle).toBe('active');
    expect(
      (await guard.checkCode('BAD', { language: 'typescript' })).some(
        (v) => v.ruleId === created.id
      )
    ).toBe(true);
    await guard.disableRule(created.id, 'Reviewed and disabled', context);
    await env.sync();
    expect(await repo.findById(created.id)).toMatchObject({
      lifecycle: 'deprecated',
      rejectionReason: 'Reviewed and disabled',
    });
    expect(
      (await guard.checkCode('BAD', { language: 'typescript' })).some(
        (v) => v.ruleId === created.id
      )
    ).toBe(false);
    await guard.enableRule(created.id, context);
    await env.sync();
    expect((await repo.findById(created.id))?.lifecycle).toBe('active');
    expect(
      (await guard.checkCode('BAD', { language: 'typescript' })).some(
        (v) => v.ruleId === created.id
      )
    ).toBe(true);
  });

  test('existing Markdown disable remains disabled after sync', async () => {
    const entry = await seed();
    await service().disableRule(entry.id, 'No longer applicable', context);
    await env.sync();
    expect((await repo.findById(entry.id))?.lifecycle).toBe('deprecated');
  });

  test('AST-only rules store their real query and description without a regex placeholder', async () => {
    const astQuery = {
      queryType: 'mustCallThrough',
      params: { targetAPI: 'unsafeCall', wrapperClass: 'Safe' },
    };
    const created = await service().createRule(
      {
        name: 'AST-only rule',
        description: 'Unsafe calls require Safe wrapper.',
        type: 'ast',
        astQuery,
        languages: ['typescript'],
      },
      context
    );
    await env.sync();
    const saved = await repo.findById(created.id);
    expect(saved?.content.markdown).toContain('Unsafe calls require Safe wrapper.');
    expect(saved?.content.markdown).toContain('mustCallThrough');
    expect(saved?.constraints.guards[0]).toMatchObject({ type: 'ast', ast_query: astQuery });
    expect(engine.getRules('typescript').find((rule) => rule.id === created.id)).toMatchObject({
      type: 'ast',
      astQuery,
    });
    expect(await service(false).checkCode('unsafeCall()', { language: 'typescript' })).toEqual([]);
  });

  test('file failure prevents creating or changing the DB row', async () => {
    const entry = await seed();
    vi.spyOn(writer, 'persist').mockReturnValue(null);
    await expect(
      service().createRule({ ...ruleData, name: 'Unwritten rule' }, context)
    ).rejects.toBeInstanceOf(FileWriteError);
    expect(await repo.findByTitle('Unwritten rule')).toBeNull();
    await expect(service().disableRule(entry.id, 'Blocked write', context)).rejects.toBeInstanceOf(
      FileWriteError
    );
    expect((await repo.findById(entry.id))?.lifecycle).toBe('active');
  });

  test('create DB failure reports divergence while retaining recoverable file truth', async () => {
    env.runtime.sqlite.exec(
      "CREATE TRIGGER reject_guard BEFORE INSERT ON knowledge_entries BEGIN SELECT RAISE(ABORT, 'injected insert failure'); END;"
    );
    const outcome = await service()
      .createRule(ruleData, context)
      .catch((error) => error);
    expect(outcome).toBeInstanceOf(DivergenceError);
    expect(outcome.details).toMatchObject({
      fileOpsCompleted: 1,
      operation: 'guard.create',
      reconcileVia: 'KnowledgeSyncService.sync',
    });
    expect(await repo.findByTitle(ruleData.name)).toBeNull();
    env.runtime.sqlite.exec('DROP TRIGGER reject_guard');
    await env.sync();
    expect((await repo.findByTitle(ruleData.name))?.lifecycle).toBe('active');
  });

  test('disable DB failure exposes divergence and sync recovers the disabled file truth', async () => {
    const entry = await seed();
    env.runtime.sqlite.exec(
      "CREATE TRIGGER reject_guard_update BEFORE UPDATE ON knowledge_entries BEGIN SELECT RAISE(ABORT, 'injected update failure'); END;"
    );
    await expect(
      service().disableRule(entry.id, 'Durable disable', context)
    ).rejects.toBeInstanceOf(DivergenceError);
    expect((await repo.findById(entry.id))?.lifecycle).toBe('active');
    env.runtime.sqlite.exec('DROP TRIGGER reject_guard_update');
    await env.sync();
    expect((await repo.findById(entry.id))?.lifecycle).toBe('deprecated');
  });

  test('legacy DB-only constructor retains updates and reports actual LF/CRLF line positions', async () => {
    const guard = service(false);
    const created = await guard.createRule(ruleData, context);
    const matches = await guard.checkCode('first\nsecond\r\nBAD', { language: 'typescript' });
    expect(matches[0]).toMatchObject({ ruleId: created.id, matches: [{ match: 'BAD', line: 3 }] });
    await guard.disableRule(created.id, 'Legacy caller', context);
    expect((await repo.findById(created.id))?.lifecycle).toBe('deprecated');
  });
});
