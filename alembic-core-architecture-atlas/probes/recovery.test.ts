import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { KnowledgeService } from '../../src/knowledge.js';
import { SourceGraphIndexer } from '../../src/service/source-graph/SourceGraphIndexer.js';
import { createKnowledgeRuntime } from '../../test/support/knowledge-runtime.js';
const hash = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');
const observe = (scenario: string, data: Record<string, unknown>) => {
  const dir = process.env.ATLAS_OBSERVATION_DIR;
  if (!dir) return;
  const allowed = path.resolve(import.meta.dirname, '../.build/runs') + path.sep;
  const target = path.resolve(dir);
  if (!target.startsWith(allowed) || !/^V[0-9]{2}$/.test(scenario))
    throw Error('Atlas observation output outside fixed build root');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(
    path.join(target, scenario + '.json'),
    JSON.stringify({ scenario, ...data }, null, 2) + '\n',
    { flag: 'wx' },
  );
};
// fixture隔离和真实Markdown/SQLite沿用Core helper；只替换故障触发点，不替换持久化边界。
describe('Atlas Core recovery probe', () => {
  it('knowledge divergence preserves file hash and explicit sync is idempotent', async () => {
    const env = await createKnowledgeRuntime();
    const id = '77777777-7777-4777-8777-777777777771';
    try {
      const service = new KnowledgeService(env.repo, { log: async () => {} }, null, null, {
        fileWriter: env.writer,
      });
      env.runtime.sqlite.exec(
        "CREATE TRIGGER atlas_reject BEFORE INSERT ON knowledge_entries BEGIN SELECT RAISE(ABORT, 'atlas controlled DB fault'); END;",
      );
      await expect(
        service.create(
          {
            id,
            title: 'Atlas recovery specimen',
            content: { markdown: 'Exact durable body' },
            language: 'typescript',
            category: 'architecture',
          },
          { userId: 'atlas-fixture' },
        ),
      ).rejects.toMatchObject({ name: 'DivergenceError' });
      const files = fs.globSync('Alembic/**/*.md', { cwd: env.root });
      expect(files).toHaveLength(1);
      const file = path.join(env.root, files[0]);
      const before = hash(fs.readFileSync(file));
      const count = () =>
        (
          env.runtime.sqlite
            .prepare('SELECT COUNT(*) AS n FROM knowledge_entries WHERE id = ?')
            .get(id) as { n: number }
        ).n;
      expect(count()).toBe(0);
      env.runtime.sqlite.exec('DROP TRIGGER atlas_reject');
      await env.sync();
      const saved = await env.repo.findById(id);
      expect(saved?.id).toBe(id);
      expect(saved?.content).toMatchObject({ markdown: 'Exact durable body' });
      expect(count()).toBe(1);
      expect(hash(fs.readFileSync(file))).toBe(before);
      await env.sync();
      expect(count()).toBe(1);
      expect(hash(fs.readFileSync(file))).toBe(before);
      observe('V01', {
        fileCount: files.length,
        beforeDbRows: 0,
        recoveredDbRows: count(),
        fileHash: before,
        recoveredFileHash: hash(fs.readFileSync(file)),
        secondSyncSameHash: hash(fs.readFileSync(file)) === before,
      });
    } finally {
      env.close();
    }
  });
  it('knowledge file rejection leaves no database row', async () => {
    const env = await createKnowledgeRuntime();
    try {
      const service = new KnowledgeService(env.repo, { log: async () => {} }, null, null, {
        fileWriter: env.writer,
      });
      vi.spyOn(env.writer, 'persist').mockReturnValueOnce(null);
      const id = '77777777-7777-4777-8777-777777777772';
      await expect(
        service.create(
          {
            id,
            title: 'Rejected file',
            content: { markdown: 'Never committed' },
            language: 'typescript',
            category: 'architecture',
          },
          { userId: 'atlas-fixture' },
        ),
      ).rejects.toMatchObject({ name: 'FileWriteError' });
      expect(await env.repo.findById(id)).toBeNull();
      expect(fs.globSync('Alembic/**/*.md', { cwd: env.root })).toHaveLength(0);
    } finally {
      vi.restoreAllMocks();
      env.close();
    }
  });
  it('cancelled source generation can recover with a new signal and exact content hash', async () => {
    const env = await createKnowledgeRuntime();
    try {
      fs.mkdirSync(path.join(env.root, 'src'));
      const file = path.join(env.root, 'src/index.ts');
      fs.writeFileSync(file, 'export const value = 1;');
      const repo = env.repositories.sourceGraphRepository;
      const indexer = new SourceGraphIndexer(repo);
      const input = { projectRoot: env.root, projectScope: 'src' };
      await indexer.buildFull({ ...input, generationId: 'atlas-prior' });
      const controller = new AbortController();
      const read = fsp.readFile.bind(fsp);
      vi.spyOn(fsp, 'readFile').mockImplementation(async (...args) => {
        const bytes = await read(...args);
        if (args[0] === file)
          controller.abort(new DOMException('atlas publication cancellation', 'AbortError'));
        return bytes;
      });
      await expect(
        indexer.buildFull({ ...input, generationId: 'atlas-cancelled', signal: controller.signal }),
      ).rejects.toThrow('atlas publication cancellation');
      expect(await repo.getSnapshot('atlas-cancelled')).toBeNull();
      expect(await repo.getSnapshot('atlas-prior')).not.toBeNull();
      vi.restoreAllMocks();
      const changed = 'export const value = 2;';
      fs.writeFileSync(file, changed);
      const rebuilt = await indexer.buildIncremental({
        ...input,
        baseGenerationId: 'atlas-prior',
        generationId: 'atlas-recovered',
        signal: new AbortController().signal,
      });
      expect(rebuilt.files.find((f) => f.repoRelativePath === 'src/index.ts')?.contentHash).toBe(
        hash(changed),
      );
      expect(await repo.getSnapshot('atlas-recovered')).not.toBeNull();
      expect(await repo.getSnapshot('atlas-prior')).not.toBeNull();
      observe('V02', {
        cancelledPublished: (await repo.getSnapshot('atlas-cancelled')) !== null,
        priorPreserved: (await repo.getSnapshot('atlas-prior')) !== null,
        recoveredGeneration: 'atlas-recovered',
        sourceHash: hash(changed),
        indexedHash: rebuilt.files.find((f) => f.repoRelativePath === 'src/index.ts')?.contentHash,
      });
    } finally {
      vi.restoreAllMocks();
      env.close();
    }
  });
});
