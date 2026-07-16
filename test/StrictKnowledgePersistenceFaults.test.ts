import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeEntry, Lifecycle } from '../src/domain/knowledge/index.js';
import { KnowledgeFileWriter, KnowledgeService } from '../src/service/knowledge/index.js';

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('strict knowledge persistence fault boundaries', () => {
  it('keeps the old file when durable lifecycle replacement fails', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-writer-fault-'));
    roots.push(root);
    const writer = new KnowledgeFileWriter(root);
    const entry = new KnowledgeEntry({
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Durable transition',
      lifecycle: Lifecycle.PENDING,
      language: 'typescript',
      dimensionId: 'architecture',
      category: 'architecture',
      content: { markdown: 'old bytes' },
    });
    const oldPath = writer.persist(entry);
    expect(oldPath).toBeTruthy();
    const oldSourceFile = entry.sourceFile;

    entry.lifecycle = Lifecycle.ACTIVE;
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('injected-rename-fault');
    });
    expect(writer.moveOnLifecycleChange(entry)).toBeNull();
    expect(fs.existsSync(oldPath!)).toBe(true);
    expect(fs.readFileSync(oldPath!, 'utf8')).toContain('old bytes');
    expect(entry.sourceFile).toBe(oldSourceFile);
  });

  it('rejects a traversal-shaped storage bucket before creating a file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-writer-bucket-'));
    roots.push(root);
    const writer = new KnowledgeFileWriter(root);
    const entry = new KnowledgeEntry({
      id: '44444444-4444-4444-8444-444444444444',
      title: 'Confined bucket',
      lifecycle: Lifecycle.PENDING,
      category: '../escape',
      content: { markdown: 'must remain confined' },
    });

    expect(writer.persist(entry)).toBeNull();
    expect(fs.existsSync(path.join(root, 'escape'))).toBe(false);
    expect(entry.sourceFile).toBeFalsy();
  });

  it('does not advance lifecycle DB state when file movement fails', async () => {
    const entry = new KnowledgeEntry({
      id: '22222222-2222-4222-8222-222222222222',
      title: 'Lifecycle fail closed',
      lifecycle: Lifecycle.ACTIVE,
      content: { markdown: 'content' },
    });
    const repository = fakeRepository(entry);
    const service = new KnowledgeService(
      repository as never,
      { log: vi.fn(async () => {}) },
      null,
      null,
      {
        fileWriter: {
          moveOnLifecycleChange: vi.fn(() => null),
        } as never,
      }
    );

    await expect(
      service._lifecycleTransition(entry.id, 'deprecate', { userId: 'strict-runner' })
    ).rejects.toThrow('aborting DB transition');
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('does not advance quality DB state when file persistence fails', async () => {
    const entry = new KnowledgeEntry({
      id: '33333333-3333-4333-8333-333333333333',
      title: 'Quality fail closed',
      lifecycle: Lifecycle.PENDING,
      content: { markdown: 'content' },
    });
    const repository = fakeRepository(entry);
    const service = new KnowledgeService(
      repository as never,
      { log: vi.fn(async () => {}) },
      null,
      null,
      {
        fileWriter: { persist: vi.fn(() => null) } as never,
        qualityScorer: {
          score: vi.fn(() => ({
            score: 0.8,
            grade: 'A',
            dimensions: { completeness: 0.8, deliveryReady: 0.8, contentDepth: 0.8 },
          })),
        },
      }
    );

    await expect(service.updateQuality(entry.id, { userId: 'strict-runner' })).rejects.toThrow(
      'aborting quality update'
    );
    expect(repository.update).not.toHaveBeenCalled();
  });
});

function fakeRepository(entry: KnowledgeEntry) {
  return {
    findById: vi.fn(async () => entry),
    findByTitle: vi.fn(async () => null),
    update: vi.fn(async () => entry),
    create: vi.fn(async () => entry),
  };
}
