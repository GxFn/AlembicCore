/**
 * ProposalRepository 单元测试
 *
 * 使用 in-memory SQLite + Drizzle 验证 CRUD 操作、去重、状态自动分级、过滤查询等。
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getDrizzle,
  initDrizzle,
  resetDrizzle,
} from '../src/infrastructure/database/drizzle/index.js';
import migrate004 from '../src/infrastructure/database/migrations/004_evolution_proposals.js';
import {
  type CreateProposalInput,
  ProposalRepository,
  type ProposalStatus,
  type ProposalType,
} from '../src/repository/evolution/ProposalRepository.js';

function makeInput(overrides: Partial<CreateProposalInput> = {}): CreateProposalInput {
  return {
    type: 'update',
    targetRecipeId: 'r-001',
    confidence: 0.85,
    source: 'host-agent',
    description: 'Test update proposal',
    ...overrides,
  };
}

describe('ProposalRepository', () => {
  let sqlite: InstanceType<typeof Database>;
  let repo: ProposalRepository;

  beforeEach(() => {
    resetDrizzle();
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = OFF');
    migrate004(sqlite);
    initDrizzle(sqlite);
    repo = new ProposalRepository(getDrizzle());
  });

  afterEach(() => {
    resetDrizzle();
    sqlite.close();
  });

  describe('create', () => {
    it('creates a proposal and returns a ProposalRecord', () => {
      const result = repo.create(makeInput());

      expect(result).not.toBeNull();
      expect(result?.id).toMatch(/^ep-\d+-[0-9a-f]+$/);
      expect(result?.type).toBe('update');
      expect(result?.targetRecipeId).toBe('r-001');
      expect(result?.confidence).toBe(0.85);
      expect(result?.source).toBe('host-agent');
      expect(result?.description).toBe('Test update proposal');
      expect(result?.relatedRecipeIds).toEqual([]);
      expect(result?.evidence).toEqual([]);
      expect(result?.resolvedAt).toBeNull();
      expect(result?.resolvedBy).toBeNull();
      expect(result?.resolution).toBeNull();
    });

    it('returns null when duplicate exists (same target + type pending/observing)', () => {
      repo.create(makeInput());
      const result = repo.create(makeInput());
      expect(result).toBeNull();
    });

    it('auto-resolves to observing when confidence >= threshold (update: 0.7)', () => {
      const result = repo.create(makeInput({ type: 'update', confidence: 0.8 }));
      expect(result?.status).toBe('observing');
    });

    it('auto-resolves to pending when confidence < threshold (update: 0.7)', () => {
      const result = repo.create(makeInput({ type: 'update', confidence: 0.5 }));
      expect(result?.status).toBe('pending');
    });

    it('deprecate auto-observes at any confidence (threshold: 0.0)', () => {
      const result = repo.create(
        makeInput({ type: 'deprecate', confidence: 0.1, targetRecipeId: 'r-dep' })
      );
      expect(result?.status).toBe('observing');
    });

    it('allows explicit status override', () => {
      const result = repo.create(makeInput({ status: 'pending', confidence: 0.99 }));
      expect(result?.status).toBe('pending');
    });

    it('allows explicit expiresAt override', () => {
      const customExpiry = Date.now() + 1000;
      const result = repo.create(makeInput({ expiresAt: customExpiry }));
      expect(result?.expiresAt).toBe(customExpiry);
    });

    it('normalizes legacy ide-agent input to host-agent on new writes', () => {
      const result = repo.create(makeInput({ source: 'ide-agent' }));
      expect(result?.source).toBe('host-agent');
    });

    it('sets type-specific observation windows', () => {
      const before = Date.now();
      const result = repo.create(makeInput({ type: 'update', confidence: 0.8 }));
      // update: 72h
      expect(result?.expiresAt).toBeGreaterThanOrEqual(before + 72 * 60 * 60 * 1000 - 100);
      expect(result?.expiresAt).toBeLessThanOrEqual(Date.now() + 72 * 60 * 60 * 1000 + 100);
    });

    it('stores relatedRecipeIds and evidence', () => {
      const result = repo.create(
        makeInput({
          relatedRecipeIds: ['r-002', 'r-003'],
          evidence: [{ snapshotAt: 12345, reason: 'test' }],
        })
      );
      expect(result?.relatedRecipeIds).toEqual(['r-002', 'r-003']);
      expect(result?.evidence).toEqual([{ snapshotAt: 12345, reason: 'test' }]);
    });

    it('covers all 2 proposal types', () => {
      const types: ProposalType[] = ['update', 'deprecate'];
      for (const type of types) {
        const result = repo.create(
          makeInput({ type, confidence: 0.5, targetRecipeId: `r-${type}` })
        );
        expect(result).not.toBeNull();
        expect(result?.type).toBe(type);
      }
    });
  });

  describe('findById', () => {
    it('returns null when row not found', () => {
      const result = repo.findById('ep-nonexistent');
      expect(result).toBeNull();
    });

    it('maps DB row to ProposalRecord', () => {
      const created = repo.create(
        makeInput({
          relatedRecipeIds: ['r-002'],
          evidence: [{ reason: 'test' }],
        })
      );
      expect(created).not.toBeNull();

      const result = repo.findById(created?.id);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(created?.id);
      expect(result?.relatedRecipeIds).toEqual(['r-002']);
      expect(result?.evidence).toEqual([{ reason: 'test' }]);
    });
  });

  describe('find (filters)', () => {
    it('filters by status, type, and targetRecipeId', () => {
      repo.create(makeInput({ type: 'update', confidence: 0.5, targetRecipeId: 'r-001' }));
      repo.create(makeInput({ type: 'deprecate', confidence: 0.5, targetRecipeId: 'r-002' }));

      const results = repo.find({ type: 'update', targetRecipeId: 'r-001' });
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('update');
    });

    it('supports array status filter', () => {
      repo.create(makeInput({ type: 'update', confidence: 0.5, targetRecipeId: 'r-a' }));
      repo.create(makeInput({ type: 'deprecate', confidence: 0.8, targetRecipeId: 'r-b' }));

      const results = repo.find({ status: ['pending', 'observing'] });
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('supports expiredBefore filter', () => {
      repo.create(makeInput({ expiresAt: 1000, targetRecipeId: 'r-old' }));
      repo.create(makeInput({ expiresAt: 99999999999999, targetRecipeId: 'r-new' }));

      const results = repo.find({ expiredBefore: 5000 });
      expect(results).toHaveLength(1);
      expect(results[0].targetRecipeId).toBe('r-old');
    });

    it('host-agent source filter includes legacy ide-agent rows', () => {
      const now = Date.now();
      repo.create(makeInput({ targetRecipeId: 'r-host' }));
      sqlite
        .prepare(
          `INSERT INTO evolution_proposals (
            id, type, target_recipe_id, related_recipe_ids, confidence, source, description,
            evidence, status, proposed_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          'ep-legacy-source',
          'update',
          'r-legacy',
          '[]',
          0.7,
          'ide-agent',
          'legacy source row',
          '[]',
          'pending',
          now - 1,
          now + 1000
        );

      const results = repo.find({ source: 'host-agent' });
      expect(results.map((result) => result.targetRecipeId)).toEqual(
        expect.arrayContaining(['r-host', 'r-legacy'])
      );
      expect(results.find((result) => result.targetRecipeId === 'r-legacy')?.source).toBe(
        'ide-agent'
      );
    });
  });

  describe('find with limit (P1 有界化)', () => {
    it('caps results to filter.limit when provided; unbounded when omitted', () => {
      // 5 个不同 target，避免去重；默认 confidence=0.85 → observing
      for (let i = 1; i <= 5; i++) {
        expect(repo.create(makeInput({ targetRecipeId: `r-lim-${i}` }))).not.toBeNull();
      }

      // 传入 limit → SQL LIMIT，结果被截到 N 条
      expect(repo.find({ limit: 2 })).toHaveLength(2);

      // 不传 limit → 现行无界行为，返回全部 5 条
      expect(repo.find()).toHaveLength(5);
    });

    it('combines limit with other filters', () => {
      for (let i = 1; i <= 4; i++) {
        expect(
          repo.create(makeInput({ confidence: 0.8, targetRecipeId: `r-obs-${i}` }))
        ).not.toBeNull();
      }

      const limited = repo.find({ status: 'observing', limit: 3 });
      expect(limited).toHaveLength(3);
      expect(limited.every((p) => p.status === 'observing')).toBe(true);
    });
  });

  describe('find oldestFirst (P3 有界化)', () => {
    function seedAt(id: string, proposedAt: number) {
      sqlite
        .prepare(
          `INSERT INTO evolution_proposals (
            id, type, target_recipe_id, related_recipe_ids, confidence, source, description,
            evidence, status, proposed_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          'update',
          `r-${id}`,
          '[]',
          0.8,
          'host-agent',
          'p',
          '[]',
          'observing',
          proposedAt,
          proposedAt + 1_000_000
        );
    }

    it('oldestFirst=true → asc(proposedAt)；默认 desc 不变；与 limit 组合取最旧 N', () => {
      // 乱序插入，proposed_at 决定排序
      seedAt('ep-300', 300);
      seedAt('ep-100', 100);
      seedAt('ep-500', 500);
      seedAt('ep-200', 200);
      seedAt('ep-400', 400);

      // 默认 desc（最新优先）—— 其他调用方排序不变
      expect(repo.find({}).map((p) => p.id)).toEqual([
        'ep-500',
        'ep-400',
        'ep-300',
        'ep-200',
        'ep-100',
      ]);

      // oldestFirst=true → asc（最旧优先）
      expect(repo.find({ oldestFirst: true }).map((p) => p.id)).toEqual([
        'ep-100',
        'ep-200',
        'ep-300',
        'ep-400',
        'ep-500',
      ]);

      // oldestFirst + limit → 取最旧 N（capped checkAndExecute 防饿死排空）
      expect(repo.find({ oldestFirst: true, limit: 2 }).map((p) => p.id)).toEqual([
        'ep-100',
        'ep-200',
      ]);

      // 默认 desc + limit → 取最新 N（证明默认排序未变）
      expect(repo.find({ limit: 2 }).map((p) => p.id)).toEqual(['ep-500', 'ep-400']);
    });
  });

  describe('findExpiredObserving', () => {
    it('queries observing proposals expired before now', () => {
      // Create a proposal that auto-observes and has an already-expired expiresAt
      repo.create(makeInput({ confidence: 0.8, expiresAt: 1 }));
      const results = repo.findExpiredObserving();
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('observing');
    });
  });

  describe('findActive', () => {
    it('queries pending + observing proposals', () => {
      repo.create(makeInput({ confidence: 0.5, targetRecipeId: 'r-p' })); // pending
      repo.create(makeInput({ confidence: 0.8, targetRecipeId: 'r-o' })); // observing

      const results = repo.findActive();
      expect(results).toHaveLength(2);
      const statuses = results.map((r) => r.status);
      expect(statuses).toContain('pending');
      expect(statuses).toContain('observing');
    });
  });

  describe('findByTarget', () => {
    it('queries by target + active status', () => {
      repo.create(makeInput({ targetRecipeId: 'r-target' }));
      repo.create(makeInput({ targetRecipeId: 'r-other', type: 'deprecate' }));

      const results = repo.findByTarget('r-target');
      expect(results).toHaveLength(1);
      expect(results[0].targetRecipeId).toBe('r-target');
    });
  });

  describe('startObserving', () => {
    it('transitions pending → observing', () => {
      const created = repo.create(makeInput({ confidence: 0.5 })); // pending
      expect(created?.status).toBe('pending');

      const result = repo.startObserving(created?.id);
      expect(result).toBe(true);

      const updated = repo.findById(created?.id);
      expect(updated?.status).toBe('observing');
    });

    it('returns false for non-pending proposal', () => {
      const created = repo.create(makeInput({ confidence: 0.8 })); // auto observing
      expect(created?.status).toBe('observing');

      const result = repo.startObserving(created?.id);
      expect(result).toBe(false);
    });

    it('returns false for nonexistent proposal', () => {
      const result = repo.startObserving('ep-none');
      expect(result).toBe(false);
    });
  });

  describe('markExecuted', () => {
    it('updates status to executed', () => {
      const created = repo.create(makeInput({ confidence: 0.8 })); // observing
      const result = repo.markExecuted(created?.id, 'FP ok, usage ok');
      expect(result).toBe(true);

      const updated = repo.findById(created?.id);
      expect(updated?.status).toBe('executed');
      expect(updated?.resolution).toBe('FP ok, usage ok');
      expect(updated?.resolvedBy).toBe('auto');
      expect(updated?.resolvedAt).toBeGreaterThan(0);
    });

    it('returns false when no row updated (wrong status)', () => {
      const created = repo.create(makeInput({ confidence: 0.5 })); // pending
      const result = repo.markExecuted(created?.id, 'test');
      expect(result).toBe(false);
    });
  });

  describe('markRejected', () => {
    it('updates status to rejected', () => {
      const created = repo.create(makeInput({ confidence: 0.8 })); // observing
      const result = repo.markRejected(created?.id, 'FP too high');
      expect(result).toBe(true);

      const updated = repo.findById(created?.id);
      expect(updated?.status).toBe('rejected');
      expect(updated?.resolution).toBe('FP too high');
    });
  });

  describe('markExpired', () => {
    it('updates status to expired', () => {
      const created = repo.create(makeInput({ confidence: 0.5 })); // pending
      const result = repo.markExpired(created?.id);
      expect(result).toBe(true);

      const updated = repo.findById(created?.id);
      expect(updated?.status).toBe('expired');
      expect(updated?.resolvedAt).toBeGreaterThan(0);
    });
  });

  describe('updateEvidence', () => {
    it('updates evidence JSON', () => {
      const created = repo.create(makeInput());
      expect(created).not.toBeNull();
      const result = repo.updateEvidence(created?.id ?? '', [{ newSnapshot: true }]);
      expect(result).toBe(true);

      const updated = repo.findById(created?.id ?? '');
      expect(updated?.evidence).toEqual([{ newSnapshot: true }]);
    });
  });

  describe('stats', () => {
    it('returns counts per status', () => {
      // Create proposals in different statuses
      repo.create(makeInput({ confidence: 0.5, targetRecipeId: 'r-1' })); // pending
      repo.create(makeInput({ confidence: 0.5, targetRecipeId: 'r-2', type: 'update' })); // pending (dup type but diff target)
      repo.create(makeInput({ confidence: 0.8, targetRecipeId: 'r-3', type: 'deprecate' })); // observing

      const result = repo.stats();
      expect(result.pending).toBe(2);
      expect(result.observing).toBe(1);
      expect(result.executed).toBe(0);
      expect(result.rejected).toBe(0);
      expect(result.expired).toBe(0);
    });

    it('returns all zeros when empty', () => {
      const result = repo.stats();
      const allStatuses: ProposalStatus[] = [
        'pending',
        'observing',
        'executed',
        'rejected',
        'expired',
      ];
      for (const s of allStatuses) {
        expect(result[s]).toBe(0);
      }
    });
  });
});
