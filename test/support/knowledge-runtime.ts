import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openAlembicDatabase } from '../../src/database.js';
import {
  KnowledgeEntry,
  type KnowledgeEntryProps,
} from '../../src/domain/knowledge/KnowledgeEntry.js';
import { pathGuard } from '../../src/io.js';
import { KnowledgeFileWriter, KnowledgeSyncService } from '../../src/knowledge.js';
import { createAlembicRepositories } from '../../src/repositories.js';

/** 真实 Markdown + SQLite 环境；只共享资源管理，不封装业务断言或模拟持久化。 */
export async function createKnowledgeRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-knowledge-'));
  pathGuard.configure({ projectRoot: root, knowledgeBaseDir: 'Alembic' });
  const runtime = await openAlembicDatabase({ path: path.join(root, '.asd', 'alembic.db') });
  const repositories = createAlembicRepositories(runtime.connection);
  const repo = repositories.knowledgeRepository;
  const writer = new KnowledgeFileWriter(root);
  return {
    root,
    runtime,
    repo,
    repositories,
    writer,
    sync: () => new KnowledgeSyncService(root).syncAll(runtime.sqlite),
    async seed(props: KnowledgeEntryProps) {
      const entry = new KnowledgeEntry(props);
      if (writer.persist(entry) === null) {
        throw new Error('Knowledge fixture could not persist its seed');
      }
      await repo.create(entry);
      return entry;
    },
    close() {
      runtime.close();
      pathGuard._reset();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
