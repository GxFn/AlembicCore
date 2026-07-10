/**
 * Track2(2026-07-10):SourceGraphLifecycleService.catchUpOnStartup 激活回归。
 * 该服务此前全仓零调用方(四表恒 0 行);本测锁"无快照→全量/fresh→noop/
 * 文件变更→增量"的幂等编排,即主体挖掘准备段的生产语义。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AlembicDatabaseRuntime, openAlembicDatabase } from '../../src/database.js';
import { SourceGraphLifecycleService } from '../../src/index.js';
import { pathGuard } from '../../src/io.js';
import { createAlembicRepositories } from '../../src/repositories.js';

describe('SourceGraphLifecycleService.catchUpOnStartup(Track2 激活)', () => {
  let tmpDir: string;
  let runtime: AlembicDatabaseRuntime;
  let oldQuiet: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-source-graph-catchup-'));
    oldQuiet = process.env.ALEMBIC_QUIET;
    process.env.ALEMBIC_QUIET = '1';
    pathGuard.configure({ projectRoot: tmpDir, knowledgeBaseDir: 'Alembic' });
    runtime = await openAlembicDatabase({ path: '.asd/alembic.db' });
  });

  afterEach(() => {
    runtime.close();
    if (oldQuiet === undefined) {
      delete process.env.ALEMBIC_QUIET;
    } else {
      process.env.ALEMBIC_QUIET = oldQuiet;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('无快照→全量建库;再跑→fresh noop;改文件→增量', async () => {
    write('src/index.ts', "import { helper } from './util';\nexport const app = helper();\n");
    write('src/util.ts', 'export function helper() { return 1; }\n');
    const repositories = createAlembicRepositories(runtime.connection);
    const lifecycle = new SourceGraphLifecycleService(
      repositories.sourceGraphRepository as ConstructorParameters<
        typeof SourceGraphLifecycleService
      >[0]
    );

    // 契约语序:reason=触发场景(startup-catch-up),action=实际动作(built-full/...)。
    const first = await lifecycle.catchUpOnStartup({ projectRoot: tmpDir });
    expect(first.action).toBe('built-full');
    expect(first.durableTables.source_graph_files).toBeGreaterThanOrEqual(2);
    expect(first.durableTables.source_graph_symbols).toBeGreaterThan(0);
    expect(first.durableTables.source_graph_edges).toBeGreaterThan(0);

    const second = await lifecycle.catchUpOnStartup({ projectRoot: tmpDir });
    expect(second.action).toBe('fresh-noop');

    write('src/util.ts', 'export function helper() { return 2; }\nexport const extra = 3;\n');
    const third = await lifecycle.catchUpOnStartup({ projectRoot: tmpDir });
    expect(third.action).toBe('built-incremental');
  });

  function write(relPath: string, content: string) {
    const absolute = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, 'utf8');
  }
});
