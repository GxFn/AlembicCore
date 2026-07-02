/**
 * CoverageLedgerAdvisor — U2d 三类停止 + D2 K/maxRounds（纯函数）。
 *
 * 验收⑤：收敛 / 收益递减(<K) / 轮次上限(≥maxRounds) 各命中；highValueBlankCount + 价值排序；
 * K/maxRounds 来自 D2（plan ?? D2[tier]，tier 由 moduleCount）。
 */
import { describe, expect, it } from 'vitest';
import type { CoverageLedgerRecord } from '../../src/repository/coverage/CoverageLedgerRepository.js';
import {
  adviseCoverageLedger,
  resolveDeepMiningK,
  resolveDeepMiningMaxRounds,
} from '../../src/workflows/surfaces/coverage/CoverageLedgerAdvisor.js';

function cell(over: Partial<CoverageLedgerRecord>): CoverageLedgerRecord {
  return {
    projectRoot: '/p',
    moduleId: 'm',
    dimensionId: 'd',
    coveredCount: 0,
    totalCandidateCount: 0,
    grade: 'empty',
    exhausted: false,
    exhaustedReason: null,
    exhaustedSource: null,
    coveredSourceRefs: [],
    uncoveredHints: [],
    valueScore: 0,
    lastRound: null,
    deferred: false,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe('CoverageLedgerAdvisor — D2 resolvers', () => {
  it('K = S1/M2/L3，maxRounds = S2/M3/L5；env 覆盖 + guard', () => {
    expect(resolveDeepMiningK('S')).toBe(1);
    expect(resolveDeepMiningK('M')).toBe(2);
    expect(resolveDeepMiningK('L')).toBe(3);
    expect(resolveDeepMiningMaxRounds('S')).toBe(2);
    expect(resolveDeepMiningMaxRounds('M')).toBe(3);
    expect(resolveDeepMiningMaxRounds('L')).toBe(5);

    const prev = process.env.ALEMBIC_DEEP_MINING_K_M;
    try {
      process.env.ALEMBIC_DEEP_MINING_K_M = '7';
      expect(resolveDeepMiningK('M')).toBe(7); // env 覆盖
      process.env.ALEMBIC_DEEP_MINING_K_M = '0';
      expect(resolveDeepMiningK('M')).toBe(2); // guard <1 → 回退
    } finally {
      if (prev === undefined) {
        delete process.env.ALEMBIC_DEEP_MINING_K_M;
      } else {
        process.env.ALEMBIC_DEEP_MINING_K_M = prev;
      }
    }
  });
});

describe('CoverageLedgerAdvisor — 三类停止', () => {
  // moduleCount=8 → M tier → K=2, maxRounds=3
  const M = { moduleCount: 8 };

  it('① 收敛：无 blank/thin 格（全 covered + exhausted-with-reason）→ stop converged', () => {
    const res = adviseCoverageLedger({
      ...M,
      cells: [
        cell({ grade: 'covered' }),
        cell({
          dimensionId: 'd2',
          grade: 'thin',
          exhausted: true,
          exhaustedReason: 'agent 已尽',
        }),
      ],
      latestRound: {
        projectRoot: '/p',
        roundIndex: 1,
        startedAt: 0,
        completedAt: 0,
        newRecipesThisRound: 9,
        triggerActor: null,
        createdAt: 0,
        updatedAt: 0,
      },
    });
    expect(res.stopReason).toBe('converged');
    expect(res.shouldStop).toBe(true);
    expect(res.valueSortedGaps).toHaveLength(0);
    expect(res.suggestion).toBeNull();
  });

  it('② 收益递减：有空白 + 上一轮 new_recipes(1) < K(2) → stop diminishing-returns', () => {
    const res = adviseCoverageLedger({
      ...M,
      cells: [cell({ grade: 'empty', valueScore: 0.9 })],
      latestRound: {
        projectRoot: '/p',
        roundIndex: 1,
        startedAt: 0,
        completedAt: 0,
        newRecipesThisRound: 1,
        triggerActor: null,
        createdAt: 0,
        updatedAt: 0,
      },
    });
    expect(res.stopReason).toBe('diminishing-returns');
    expect(res.shouldStop).toBe(true);
    expect(res.k).toBe(2);
  });

  it('③ 轮次上限：有空白 + new_recipes(9) ≥ K 但 last_round(3) ≥ maxRounds(3) → stop round-cap', () => {
    const res = adviseCoverageLedger({
      ...M,
      cells: [cell({ grade: 'thin', valueScore: 0.8 })],
      latestRound: {
        projectRoot: '/p',
        roundIndex: 3,
        startedAt: 0,
        completedAt: 0,
        newRecipesThisRound: 9,
        triggerActor: null,
        createdAt: 0,
        updatedAt: 0,
      },
    });
    expect(res.stopReason).toBe('round-cap');
    expect(res.shouldStop).toBe(true);
    expect(res.maxRounds).toBe(3);
  });

  it('continue：有空白 + 产出充足 + 未达上限 → 不停，给价值排序 + 建议', () => {
    const res = adviseCoverageLedger({
      ...M,
      cells: [
        cell({ moduleId: 'm1', grade: 'empty', valueScore: 0.9 }),
        cell({ moduleId: 'm2', grade: 'thin', valueScore: 0.3 }), // < 0.5，非高价值
        cell({ moduleId: 'm3', grade: 'empty', valueScore: 0.7 }),
      ],
      latestRound: {
        projectRoot: '/p',
        roundIndex: 1,
        startedAt: 0,
        completedAt: 0,
        newRecipesThisRound: 8,
        triggerActor: null,
        createdAt: 0,
        updatedAt: 0,
      },
    });
    expect(res.stopReason).toBe('continue');
    expect(res.shouldStop).toBe(false);
    // 价值排序高→低
    expect(res.valueSortedGaps.map((g) => g.valueScore)).toEqual([0.9, 0.7, 0.3]);
    expect(res.highValueBlankCount).toBe(2); // 0.9 + 0.7 ≥ 0.5
    expect(res.suggestion).toBe('还有 2 个高价值空白，建议再扫一轮');
  });

  it('plan 显式 K/maxRounds 优先于 D2[tier]', () => {
    const res = adviseCoverageLedger({
      moduleCount: 1, // S → D2 K=1, maxRounds=2
      planK: 5,
      planMaxRounds: 9,
      cells: [cell({ grade: 'empty', valueScore: 0.9 })],
      latestRound: {
        projectRoot: '/p',
        roundIndex: 1,
        startedAt: 0,
        completedAt: 0,
        newRecipesThisRound: 4,
        triggerActor: null,
        createdAt: 0,
        updatedAt: 0,
      },
    });
    // new_recipes(4) < planK(5) → diminishing（证 planK 生效，否则 4≥1 不会停）
    expect(res.k).toBe(5);
    expect(res.maxRounds).toBe(9);
    expect(res.stopReason).toBe('diminishing-returns');
  });
});
