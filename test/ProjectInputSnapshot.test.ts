import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ProjectInputSnapshot,
  RecordingProjectSourceReader,
  ReplayProjectSourceReader,
} from '../src/infrastructure/io/ProjectInputSnapshot.js';
import {
  bindProjectSourceReader,
  nodeProjectSourceReader,
  projectSourceReaderIdentity,
  sourceExists,
} from '../src/infrastructure/io/ProjectSourceReader.js';
import { withProjectContextSession } from '../src/service/project-context/ProjectContextService.js';
import { hashBytes, hashCanonicalJson } from '../src/shared/canonicalJson.js';
import type { ProjectSourceReader } from '../src/types/projectSourceReader.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe('Project input snapshot primitives', () => {
  it('replays bytes, directories, empty directories, negative reads, configuration and realpath after the source moves', async () => {
    const fixture = await createFixture();
    const reader = new RecordingProjectSourceReader(fixture.roots);
    const raw = Buffer.from([0xff, 0x0d, 0x0a, 0x61]);
    await fs.writeFile(fixture.file, raw);
    await fs.symlink('source.ts', fixture.link);
    const config = JSON.parse(
      '{"__proto__":{"own":true},"constructor":"literal","prototype":"data"}'
    ) as Record<string, unknown>;
    const nestedConfig = { source: fixture.file, flag: true, names: ['a', 'b'] };
    config.sourceRoot = fixture.root;
    config.nested = nestedConfig;
    const load = vi.fn(() => config);

    expect(await reader.readFile(fixture.file)).toEqual(Uint8Array.from(raw));
    const entries = await reader.readDirectory(fixture.root);
    expect(entries.find((entry) => entry.name === 'link.ts')?.isSymbolicLink()).toBe(true);
    expect(await reader.readDirectory(fixture.empty)).toEqual([]);
    const stat = await reader.stat(fixture.file);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBe(raw.length);
    await expect(reader.readFile(fixture.missing)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(reader.stat(path.join(fixture.file, 'child'))).rejects.toMatchObject({
      code: 'ENOTDIR',
    });
    await expect(reader.realpath(fixture.link)).resolves.toBe(fixture.file);
    const recordedConfig = await reader.readConfiguration('scope-for-folder', fixture.root, load);
    expect(Object.hasOwn(recordedConfig, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(recordedConfig)).toBe(Object.prototype);
    await reader.verify();
    const snapshot = JSON.parse(JSON.stringify(await reader.snapshot())) as ProjectInputSnapshot;
    expect(JSON.stringify(snapshot)).not.toContain(fixture.root);
    expect(snapshot.blobs).toContainEqual({
      hash: hashBytes(raw),
      byteLength: raw.length,
      dataBase64: raw.toString('base64'),
    });
    await fs.rename(fixture.root, path.join(fixture.base, 'moved-source'));

    const rebound = path.join(fixture.base, 'offline', 'rebound-root');
    const replay = new ReplayProjectSourceReader(snapshot, [{ id: 'repo', path: rebound }]);
    const reboundFile = path.join(rebound, 'source.ts');
    const forbiddenLiveLoad = vi.fn(() => {
      throw new Error('offline configuration read must not load live state');
    });
    expect(await replay.readFile(reboundFile)).toEqual(Uint8Array.from(raw));
    expect(
      (await replay.readDirectory(rebound)).map((entry) => [
        entry.name,
        entry.isFile(),
        entry.isDirectory(),
        entry.isSymbolicLink(),
      ])
    ).toEqual(
      entries.map((entry) => [
        entry.name,
        entry.isFile(),
        entry.isDirectory(),
        entry.isSymbolicLink(),
      ])
    );
    expect(await replay.readDirectory(path.join(rebound, 'empty'))).toEqual([]);
    expect((await replay.stat(reboundFile)).size).toBe(raw.length);
    expect(await replay.realpath(path.join(rebound, 'link.ts'))).toBe(reboundFile);
    await expect(replay.readFile(path.join(rebound, 'missing.ts'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(replay.stat(path.join(reboundFile, 'child'))).rejects.toMatchObject({
      code: 'ENOTDIR',
    });
    const replayedConfig = await replay.readConfiguration<typeof config>(
      'scope-for-folder',
      rebound,
      forbiddenLiveLoad
    );
    expect(replayedConfig).toEqual({
      ...config,
      sourceRoot: rebound,
      nested: { ...nestedConfig, source: reboundFile },
    });
    expect(Object.hasOwn(replayedConfig, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(replayedConfig)).toBe(Object.prototype);
    expect(forbiddenLiveLoad).not.toHaveBeenCalled();
    expect(() => replay.assertComplete()).not.toThrow();
  });

  it('keeps same-path files in different roots separate after rebinding', async () => {
    const fixture = await createFixture();
    const second = path.join(fixture.base, 'other');
    await fs.mkdir(second);
    await fs.writeFile(path.join(second, 'source.ts'), 'second');
    const roots = [...fixture.roots, { id: 'other', path: second }];
    const reader = new RecordingProjectSourceReader(roots);
    await reader.readFile(fixture.file);
    await reader.readFile(path.join(second, 'source.ts'));
    const snapshot = await reader.snapshot();
    const rebound = [
      { id: 'repo', path: path.join(fixture.base, 'offline-a') },
      { id: 'other', path: path.join(fixture.base, 'offline-b') },
    ];
    const replay = new ReplayProjectSourceReader(snapshot, rebound);
    expect(
      Buffer.from(await replay.readFile(path.join(rebound[0].path, 'source.ts'))).toString()
    ).toBe('initial');
    expect(
      Buffer.from(await replay.readFile(path.join(rebound[1].path, 'source.ts'))).toString()
    ).toBe('second');
  });

  it('coalesces a physical read and returns isolated byte/configuration copies', async () => {
    const fixture = await createFixture();
    const delegate = {
      ...nodeProjectSourceReader,
      readFile: vi.fn(nodeProjectSourceReader.readFile),
    };
    const reader = new RecordingProjectSourceReader(fixture.roots, delegate);
    const [first, second] = await Promise.all([
      reader.readFile(fixture.file),
      reader.readFile(fixture.file),
    ]);
    expect(delegate.readFile).toHaveBeenCalledTimes(1);
    first[0] = 0;
    expect(Buffer.from(second).toString()).toBe('initial');
    expect(Buffer.from(await reader.readFile(fixture.file)).toString()).toBe('initial');
    const config = await reader.readConfiguration('discoverer-preference', fixture.root, () => ({
      nested: { selected: 'node' },
    }));
    config.nested.selected = 'changed';
    expect(
      await reader.readConfiguration('discoverer-preference', fixture.root, () => ({
        nested: { selected: 'other' },
      }))
    ).toEqual({ nested: { selected: 'node' } });
    const replay = new ReplayProjectSourceReader(await reader.snapshot(), fixture.roots);
    const replayed = await replay.readFile(fixture.file);
    replayed[0] = 0;
    expect(Buffer.from(await replay.readFile(fixture.file)).toString()).toBe('initial');
  });

  it('does not let an exported snapshot mutate the recording reader cache', async () => {
    const fixture = await createFixture();
    const otherFile = path.join(fixture.root, 'other.ts');
    await fs.writeFile(otherFile, 'substituted');
    const reader = new RecordingProjectSourceReader(fixture.roots);
    await reader.readFile(fixture.file);
    await reader.readFile(otherFile);
    const snapshot = await reader.snapshot();
    const observation = snapshot.observations.find(
      (row) => row.operation === 'file' && row.path.relativePath === 'source.ts'
    )!;
    if (!observation.outcome.ok) {
      throw new Error('fixture must contain a successful file observation');
    }
    try {
      observation.outcome.value = hashBytes(Buffer.from('substituted'));
    } catch (error) {
      // 冻结导出对象或返回独立副本都满足所有权边界。
      expect(error).toBeInstanceOf(TypeError);
    }
    expect(Buffer.from(await reader.readFile(fixture.file)).toString()).toBe('initial');
    await expect(reader.verify()).resolves.toBeUndefined();
  });

  it.each([
    'file',
    'directory',
    'stat',
    'realpath',
    'configuration',
  ] as const)('latches an uncaptured %s operation even when the caller catches it', async (operation) => {
    const fixture = await createFixture();
    const recording = new RecordingProjectSourceReader(fixture.roots);
    const replay = new ReplayProjectSourceReader(await recording.snapshot(), fixture.roots);
    await expect(readOperation(replay, operation, fixture.file)).rejects.toMatchObject({
      code: 'PROJECT_SOURCE_INPUT_UNCAPTURED',
    });
    expect(() => replay.assertComplete()).toThrow();
    await expect(sourceExists(replay, fixture.file)).rejects.toMatchObject({
      code: 'PROJECT_SOURCE_INPUT_UNCAPTURED',
    });
    expect(() => replay.assertComplete()).toThrow();
  });

  it('preserves recorded operational errors and latches them in both recording and replay', async () => {
    const fixture = await createFixture();
    const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const delegate: ProjectSourceReader = {
      ...nodeProjectSourceReader,
      async readFile() {
        throw denied;
      },
    };
    const reader = new RecordingProjectSourceReader(fixture.roots, delegate);
    await expect(reader.readFile(fixture.file)).rejects.toMatchObject({ code: 'EACCES' });
    expect(() => reader.assertComplete()).toThrow();
    const snapshot = await reader.snapshot();
    const replay = new ReplayProjectSourceReader(snapshot, fixture.roots);
    await expect(replay.readFile(fixture.file)).rejects.toMatchObject({ code: 'EACCES' });
    expect(() => replay.assertComplete()).toThrow();
  });

  it.each([
    'file',
    'directory',
    'empty-directory',
    'negative-stat',
    'realpath',
    'configuration',
    'stat',
  ] as const)('verifies terminal %s inputs against the delegate instead of the recording cache', async (operation) => {
    const fixture = await createFixture();
    const reader = new RecordingProjectSourceReader(fixture.roots);
    let configuration = { selected: 'first' };
    switch (operation) {
      case 'file':
        await reader.readFile(fixture.file);
        await fs.writeFile(fixture.file, 'changed');
        expect(Buffer.from(await reader.readFile(fixture.file)).toString()).toBe('initial');
        break;
      case 'directory':
        await reader.readDirectory(fixture.root);
        await fs.writeFile(path.join(fixture.root, 'added.ts'), 'added');
        break;
      case 'empty-directory':
        await reader.readDirectory(fixture.empty);
        await fs.rmdir(fixture.empty);
        break;
      case 'negative-stat':
        await expect(reader.stat(fixture.missing)).rejects.toMatchObject({ code: 'ENOENT' });
        await fs.writeFile(fixture.missing, 'created');
        break;
      case 'realpath':
        await fs.symlink('source.ts', fixture.link);
        await reader.realpath(fixture.link);
        await fs.writeFile(path.join(fixture.root, 'target.ts'), 'target');
        await fs.unlink(fixture.link);
        await fs.symlink('target.ts', fixture.link);
        break;
      case 'configuration':
        await reader.readConfiguration('discoverer-preference', fixture.root, () => configuration);
        configuration = { selected: 'second' };
        break;
      case 'stat':
        await reader.stat(fixture.file);
        await fs.chmod(fixture.file, 0o755);
        break;
    }
    await expect(reader.verify()).rejects.toMatchObject({ code: 'PROJECT_SOURCE_INPUT_DRIFT' });
  });

  it('keeps mtime-only changes outside content identity', async () => {
    const fixture = await createFixture();
    const reader = new RecordingProjectSourceReader(fixture.roots);
    await reader.readFile(fixture.file);
    await reader.stat(fixture.file);
    const snapshot = await reader.snapshot();
    await fs.utimes(fixture.file, new Date('2001-01-01'), new Date('2030-01-01'));
    await expect(reader.verify()).resolves.toBeUndefined();
    expect(await reader.snapshot()).toEqual(snapshot);
  });

  it('does not append terminal verification bytes to the captured snapshot', async () => {
    const fixture = await createFixture();
    const reader = new RecordingProjectSourceReader(fixture.roots);
    await reader.readFile(fixture.file);
    const before = await reader.snapshot();
    await fs.writeFile(fixture.file, 'terminal version');
    await expect(reader.verify()).rejects.toMatchObject({ code: 'PROJECT_SOURCE_INPUT_DRIFT' });
    expect(await reader.snapshot()).toEqual(before);
  });

  it('uses the verification cancellation scope instead of retaining a completed read signal', async () => {
    const fixture = await createFixture();
    const reader = new RecordingProjectSourceReader(fixture.roots);
    const original = new AbortController();
    await reader.readFile(fixture.file, { signal: original.signal });
    original.abort('original operation has completed');
    await expect(reader.verify()).resolves.toBeUndefined();
  });

  it('retries a cancelled in-flight read without poisoning the snapshot', async () => {
    const fixture = await createFixture();
    const entered = Promise.withResolvers<void>();
    let calls = 0;
    const delegate: ProjectSourceReader = {
      ...nodeProjectSourceReader,
      async readFile(file, options) {
        if (++calls === 1) {
          entered.resolve();
          await new Promise<void>((_resolve, reject) =>
            options?.signal?.addEventListener(
              'abort',
              () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })),
              { once: true }
            )
          );
        }
        return nodeProjectSourceReader.readFile(file, options);
      },
    };
    const reader = new RecordingProjectSourceReader(fixture.roots, delegate);
    const controller = new AbortController();
    const pending = reader.readFile(fixture.file, { signal: controller.signal });
    await entered.promise;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(Buffer.from(await reader.readFile(fixture.file)).toString()).toBe('initial');
    expect(() => reader.assertComplete()).not.toThrow();
    expect((await reader.snapshot()).observations).toHaveLength(1);
  });

  it.each([
    'readFile',
    'readDirectory',
    'stat',
    'realpath',
  ] as const)('keeps the bound cancellation constraint when %s receives an undefined signal', async (operation) => {
    const fixture = await createFixture();
    const controller = new AbortController();
    const reader = bindProjectSourceReader(nodeProjectSourceReader, controller.signal);
    controller.abort();
    const target = operation === 'readDirectory' ? fixture.root : fixture.file;
    await expect(reader[operation](target, { signal: undefined })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it.each([
    'parent',
    'operation',
  ] as const)('combines explicit read signals and respects %s cancellation', async (cancelled) => {
    const fixture = await createFixture();
    const parent = new AbortController();
    const operation = new AbortController();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const recorder = new RecordingProjectSourceReader(fixture.roots, {
      ...nodeProjectSourceReader,
      async readFile(file, options) {
        entered.resolve();
        await release.promise;
        return nodeProjectSourceReader.readFile(file, options);
      },
    });
    const reader = bindProjectSourceReader(recorder, parent.signal);
    const pending = reader.readFile(fixture.file, { signal: operation.signal });
    await entered.promise;
    (cancelled === 'parent' ? parent : operation).abort();
    release.resolve();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(() => recorder.assertComplete()).not.toThrow();
    expect(Buffer.from(await recorder.readFile(fixture.file)).toString()).toBe('initial');
    expect(projectSourceReaderIdentity(reader)).toBe(recorder);
    expect(
      projectSourceReaderIdentity(bindProjectSourceReader(reader, new AbortController().signal))
    ).toBe(recorder);
  });

  it('does not load configuration after its bound scope has been cancelled', async () => {
    const fixture = await createFixture();
    const controller = new AbortController();
    const recorder = new RecordingProjectSourceReader(fixture.roots);
    const reader = bindProjectSourceReader(recorder, controller.signal);
    const load = vi.fn(() => ({ selected: 'unused' }));
    controller.abort();
    await expect(
      reader.readConfiguration('discoverer-preference', fixture.root, load)
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(load).not.toHaveBeenCalled();
    expect((await recorder.snapshot()).observations).toEqual([]);
    expect(() => recorder.assertComplete()).not.toThrow();
    expect(() => reader.assertComplete()).toThrow(expect.objectContaining({ name: 'AbortError' }));
  });

  it('cancels an in-flight configuration load without retaining its value in the recording cache', async () => {
    const fixture = await createFixture();
    const controller = new AbortController();
    const recorder = new RecordingProjectSourceReader(fixture.roots);
    const reader = bindProjectSourceReader(recorder, controller.signal);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const pending = reader.readConfiguration('discoverer-preference', fixture.root, async () => {
      entered.resolve();
      await release.promise;
      return { selected: 'cancelled' };
    });
    await entered.promise;
    controller.abort();
    release.resolve();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(() => recorder.assertComplete()).not.toThrow();
    expect(
      await recorder.readConfiguration('discoverer-preference', fixture.root, () => ({
        selected: 'retry',
      }))
    ).toEqual({ selected: 'retry' });
  });

  it('does not retain a completed bound configuration signal during terminal verification', async () => {
    const fixture = await createFixture();
    const controller = new AbortController();
    const recorder = new RecordingProjectSourceReader(fixture.roots);
    const reader = bindProjectSourceReader(recorder, controller.signal);
    await reader.readConfiguration('discoverer-preference', fixture.root, () => ({
      selected: 'node',
    }));
    controller.abort();
    await expect(recorder.verify()).resolves.toBeUndefined();
  });

  it('rejects a source-slice session when a leaf catches the bound realpath cancellation', async () => {
    const fixture = await createFixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      withProjectContextSession(
        (session) =>
          session.execute({
            kind: 'source-slice',
            scope: { projectRoot: fixture.root },
            payload: { filePath: 'source.ts' },
          }),
        { sourceReader: bindProjectSourceReader(nodeProjectSourceReader, controller.signal) }
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('seeds captured bytes by value without a live content read and verifies against live bytes', async () => {
    const fixture = await createFixture();
    const delegate = {
      ...nodeProjectSourceReader,
      readFile: vi.fn(nodeProjectSourceReader.readFile),
    };
    const reader = new RecordingProjectSourceReader(fixture.roots, delegate);
    const bytes = Buffer.from('initial');
    await reader.seedFile(fixture.file, bytes);
    bytes[0] = 0;
    await reader.seedFile(fixture.file, Buffer.from('initial'));
    expect(Buffer.from(await reader.readFile(fixture.file)).toString()).toBe('initial');
    expect(delegate.readFile).not.toHaveBeenCalled();
    await fs.writeFile(fixture.file, 'changed');
    await expect(reader.verify()).rejects.toMatchObject({ code: 'PROJECT_SOURCE_INPUT_DRIFT' });
    expect(delegate.readFile).toHaveBeenCalledTimes(1);
  });

  it('rejects a seed that overwrites an already consumed version', async () => {
    const fixture = await createFixture();
    const reader = new RecordingProjectSourceReader(fixture.roots);
    await reader.readFile(fixture.file);
    await expect(reader.seedFile(fixture.file, Buffer.from('replacement'))).rejects.toMatchObject({
      code: 'PROJECT_SOURCE_INPUT_DRIFT',
    });
    expect(Buffer.from(await reader.readFile(fixture.file)).toString()).toBe('initial');
  });

  it('rejects conflicting seed/read races instead of losing an observed version', async () => {
    const fixture = await createFixture();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const delegate: ProjectSourceReader = {
      ...nodeProjectSourceReader,
      async readFile(file, options) {
        const content = await nodeProjectSourceReader.readFile(file, options);
        entered.resolve();
        await release.promise;
        return content;
      },
    };
    const reader = new RecordingProjectSourceReader(fixture.roots, delegate);
    const read = reader.readFile(fixture.file);
    await entered.promise;
    // seed 与终态文件一致，仍不能抹掉在途读取已经拿到的旧版本。
    await fs.writeFile(fixture.file, 'seeded');
    const seed = reader.seedFile(fixture.file, Buffer.from('seeded'));
    release.resolve();
    const results = await Promise.allSettled([read, seed]);
    expect(
      results.some(
        (result) =>
          result.status === 'rejected' && result.reason?.code === 'PROJECT_SOURCE_INPUT_DRIFT'
      )
    ).toBe(true);
    expect(() => reader.assertComplete()).toThrow();
  });

  it('rejects altered serialized configuration and byte blobs', async () => {
    const fixture = await createFixture();
    const reader = new RecordingProjectSourceReader(fixture.roots);
    await reader.readFile(fixture.file);
    await reader.readConfiguration('discoverer-preference', fixture.root, () =>
      JSON.parse('{"__proto__":{"selected":"first"}}')
    );
    const original = await reader.snapshot();
    const modifiedConfig = JSON.parse(JSON.stringify(original)) as ProjectInputSnapshot;
    const row = modifiedConfig.observations.find(
      (observation) => observation.operation === 'discoverer-preference'
    )!;
    if (row.outcome.ok) {
      row.outcome.value = { object: [['__proto__', 'changed']] };
    }
    expect(() => new ReplayProjectSourceReader(modifiedConfig, fixture.roots)).toThrow(
      /hash mismatch/i
    );
    const modifiedBlob = structuredClone(original);
    modifiedBlob.blobs[0].dataBase64 = Buffer.from('changed').toString('base64');
    expect(() => new ReplayProjectSourceReader(modifiedBlob, fixture.roots)).toThrow(
      /blob hash mismatch/i
    );
    const missingBlob = structuredClone(original);
    missingBlob.blobs = [];
    resignSnapshot(missingBlob);
    expect(() => new ReplayProjectSourceReader(missingBlob, fixture.roots)).toThrow(
      /missing.*blob/i
    );
    const duplicate = structuredClone(original);
    duplicate.observations.push(structuredClone(duplicate.observations[0]));
    resignSnapshot(duplicate);
    expect(() => new ReplayProjectSourceReader(duplicate, fixture.roots)).toThrow(/duplicate/i);
    const unknownOperation = structuredClone(original);
    Object.assign(unknownOperation.observations[0], {
      operation: 'unknown-operation',
      outcome: { ok: false, code: 'ENOENT' },
    });
    resignSnapshot(unknownOperation);
    expect(() => new ReplayProjectSourceReader(unknownOperation, fixture.roots)).toThrow(
      /unsupported.*operation/i
    );
  });

  it.each([
    1,
    0,
    'false',
    null,
    {},
    [],
  ])('rejects a rehashed snapshot with non-boolean outcome.ok: %j', async (ok) => {
    const fixture = await createFixture();
    const reader = new RecordingProjectSourceReader(fixture.roots);
    await reader.readFile(fixture.file);
    const snapshot = await reader.snapshot();
    // 同时保留有效 blob 与错误码，避免由别的结构守卫偶然拒绝畸形判别字段。
    Object.assign(snapshot.observations[0].outcome, { ok, code: 'ENOENT' });
    resignSnapshot(snapshot);
    expect(() => new ReplayProjectSourceReader(snapshot, fixture.roots)).toThrow(TypeError);
  });

  it.each([
    { field: 'id', value: 1, bindingId: '1' },
    { field: 'id', value: true, bindingId: 'true' },
    { field: 'id', value: '', bindingId: 'repo' },
    { field: 'id', value: null, bindingId: 'repo' },
    { field: 'label', value: 1, bindingId: 'repo' },
    { field: 'label', value: '', bindingId: 'repo' },
    { field: 'label', value: null, bindingId: 'repo' },
  ])('rejects malformed serialized root $field=$value', async ({ field, value, bindingId }) => {
    const fixture = await createFixture();
    const roots = [{ id: bindingId, path: fixture.root }];
    const reader = new RecordingProjectSourceReader(roots);
    const snapshot = await reader.snapshot();
    // 空读取集也必须验证 root 本身，不能借助某条 file observation 间接检查。
    Object.assign(snapshot.roots[0], { [field]: value });
    resignSnapshot(snapshot);
    expect(() => new ReplayProjectSourceReader(snapshot, roots)).toThrow(TypeError);
  });

  it('rejects duplicate blob references even when bytes and the recomputed hash agree', async () => {
    const fixture = await createFixture();
    const reader = new RecordingProjectSourceReader(fixture.roots);
    await reader.readFile(fixture.file);
    const snapshot = await reader.snapshot();
    snapshot.blobs.push(structuredClone(snapshot.blobs[0]));
    resignSnapshot(snapshot);
    expect(() => new ReplayProjectSourceReader(snapshot, fixture.roots)).toThrow(
      /duplicate.*blob/i
    );
  });

  it('keeps a filesystem-root binding replayable with a non-empty portable label', async () => {
    const roots = [{ id: 'filesystem', path: path.parse(path.resolve('.')).root }];
    const reader = new RecordingProjectSourceReader(roots);
    const snapshot = await reader.snapshot();
    expect(snapshot.roots[0].label).not.toBe('');
    expect(() => new ReplayProjectSourceReader(snapshot, roots)).not.toThrow();
  });

  it('keeps opaque absolute-looking scope strings while rebinding declared and captured-root paths', async () => {
    const fixture = await createFixture();
    const externalDataRoot = path.join(fixture.base, 'data');
    const externalRealpath = path.join(fixture.base, 'linked-source');
    const configuration = {
      displayName: '/api',
      controlRoot: { path: fixture.root },
      dataRoot: externalDataRoot,
      storage: { dataRoot: externalDataRoot },
      folders: [
        {
          path: fixture.file,
          realpath: externalRealpath,
          metadata: { path: '/api', route: '/api/v1' },
        },
      ],
      sourceRoot: fixture.root,
      metadata: { endpoint: '/api', expression: '^/api$', nested: { path: '/api' } },
    };
    const reader = new RecordingProjectSourceReader(fixture.roots);
    expect(
      await reader.readConfiguration('scope-for-folder', fixture.root, () => configuration)
    ).toEqual(configuration);
    const snapshot = JSON.parse(JSON.stringify(await reader.snapshot())) as ProjectInputSnapshot;
    const rebound = path.join(fixture.base, 'offline', 'workspace', 'source');
    const replay = new ReplayProjectSourceReader(snapshot, [{ id: 'repo', path: rebound }]);
    const result = await replay.readConfiguration<typeof configuration>(
      'scope-for-folder',
      rebound,
      () => {
        throw new Error('replay must not reload scope configuration');
      }
    );
    expect(result).toEqual({
      ...configuration,
      controlRoot: { path: rebound },
      dataRoot: path.resolve(rebound, '../data'),
      storage: { dataRoot: path.resolve(rebound, '../data') },
      folders: [
        {
          ...configuration.folders[0],
          path: path.join(rebound, 'source.ts'),
          realpath: path.resolve(rebound, '../linked-source'),
        },
      ],
      sourceRoot: rebound,
    });
  });

  it('keeps preference identifiers opaque even when they look like absolute paths', async () => {
    const fixture = await createFixture();
    const preference = {
      selectedDiscoverer: '/api',
      alternatives: [fixture.root, '/api/v1'],
      userConfirmed: true,
    };
    const reader = new RecordingProjectSourceReader(fixture.roots);
    await reader.readConfiguration('discoverer-preference', fixture.root, () => preference);
    const rebound = path.join(fixture.base, 'offline', 'workspace', 'source');
    const replay = new ReplayProjectSourceReader(await reader.snapshot(), [
      { id: 'repo', path: rebound },
    ]);
    expect(await replay.readConfiguration('discoverer-preference', rebound, () => null)).toEqual(
      preference
    );
  });

  it('preserves configuration enumeration order and detects a terminal order change', async () => {
    const fixture = await createFixture();
    let configuration = JSON.parse('{"zeta":1,"__proto__":{"z":1,"a":2},"alpha":2}') as Record<
      string,
      unknown
    >;
    const reader = new RecordingProjectSourceReader(fixture.roots);
    const recorded = await reader.readConfiguration(
      'discoverer-preference',
      fixture.root,
      () => configuration
    );
    expect(Object.keys(recorded)).toEqual(Object.keys(configuration));
    expect(Object.keys(recorded.__proto__ as object)).toEqual(['z', 'a']);
    expect(Object.getPrototypeOf(recorded)).toBe(Object.prototype);
    const replay = new ReplayProjectSourceReader(await reader.snapshot(), fixture.roots);
    const replayed = await replay.readConfiguration<typeof configuration>(
      'discoverer-preference',
      fixture.root,
      () => ({})
    );
    expect(Object.keys(replayed)).toEqual(Object.keys(configuration));
    configuration = JSON.parse('{"alpha":2,"__proto__":{"z":1,"a":2},"zeta":1}');
    await expect(reader.verify()).rejects.toMatchObject({ code: 'PROJECT_SOURCE_INPUT_DRIFT' });
  });
});

async function createFixture() {
  const base = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'project-input-snapshot-'))
  );
  temporaryRoots.push(base);
  const root = path.join(base, 'source');
  const empty = path.join(root, 'empty');
  await fs.mkdir(empty, { recursive: true });
  const file = path.join(root, 'source.ts');
  await fs.writeFile(file, 'initial');
  return {
    base,
    root,
    empty,
    file,
    missing: path.join(root, 'missing.ts'),
    link: path.join(root, 'link.ts'),
    roots: [{ id: 'repo', path: root }],
  };
}

async function readOperation(
  reader: ProjectSourceReader,
  operation: 'file' | 'directory' | 'stat' | 'realpath' | 'configuration',
  file: string
) {
  switch (operation) {
    case 'file':
      return reader.readFile(file);
    case 'directory':
      return reader.readDirectory(file);
    case 'stat':
      return reader.stat(file);
    case 'realpath':
      return reader.realpath(file);
    case 'configuration':
      return reader.readConfiguration('scope-for-folder', file, () => ({}));
  }
}

/** 绕过摘要失配以单独验证结构守卫，不伪造字节hash或改变产品校验代码。 */
function resignSnapshot(snapshot: ProjectInputSnapshot): void {
  snapshot.snapshotHash = hashCanonicalJson({
    version: snapshot.version,
    roots: snapshot.roots,
    observations: snapshot.observations,
    blobs: snapshot.blobs.map(({ hash, byteLength }) => ({ hash, byteLength })),
  });
}
