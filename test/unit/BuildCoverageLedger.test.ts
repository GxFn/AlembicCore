/**
 * buildCoverageLedger — U2a 聚合层（跨维候选 + coveredPaths → per-(module×dimension) cell）。
 *
 * 验收③：per-cell grade（empty/thin/partial/covered）；module 归属 canonical ownedPaths + pathsOverlap；
 * exhausted=agent-declared；价值排序信号；不读宿主 fs（纯输入/输出，project_root 由 upsert 方提供）。
 * grade 是 advisory 覆盖信号、非阻断门（buildCompletenessCritic 单候选逻辑不变，由既有单测覆盖）。
 */
import { describe, expect, it } from 'vitest';
import {
  buildCoverageLedger,
  type CoverageLedgerCandidate,
  type CoverageLedgerModuleAxis,
} from '../../src/host-agent-workflows.js';

const MODULES: CoverageLedgerModuleAxis[] = [
  { moduleId: 'auth', moduleName: 'Auth', ownedPaths: ['src/auth/login.ts', 'src/auth/token.ts'] },
  { moduleId: 'pay', moduleName: 'Pay', ownedPaths: ['src/pay/charge.ts'] },
];

const CANDIDATES: CoverageLedgerCandidate[] = [
  { dimensionIds: ['arch'], sourceRefPaths: ['src/auth/login.ts'], importance: 90 },
  { dimensionIds: ['arch'], sourceRefPaths: ['src/auth/token.ts'], importance: 40 },
  { dimensionIds: ['coding'], sourceRefPaths: ['src/pay/charge.ts'], importance: 80 },
];

function cellOf(
  cells: ReturnType<typeof buildCoverageLedger>,
  moduleId: string,
  dimensionId: string
) {
  return cells.find((c) => c.moduleId === moduleId && c.dimensionId === dimensionId);
}

describe('buildCoverageLedger (U2a)', () => {
  const cells = buildCoverageLedger({
    candidates: CANDIDATES,
    coveredPaths: ['src/auth/login.ts'], // 仅 login 被覆盖
    modules: MODULES,
    dimensionIds: ['arch', 'coding'],
    perCellTarget: 2,
    exhaustedDeclarations: [{ moduleId: 'pay', dimensionId: 'coding', reason: 'agent 已尽' }],
  });

  it('③ per-cell grade + module 归属（路径前缀）+ 覆盖/价值信号', () => {
    // auth×arch：2 候选（login,token），covered=1（login），target=2 → partial
    const authArch = cellOf(cells, 'auth', 'arch');
    expect(authArch).toMatchObject({ coveredCount: 1, totalCandidateCount: 2, grade: 'partial' });
    expect(authArch?.coveredSourceRefs).toEqual(['src/auth/login.ts']);
    expect(authArch?.uncoveredHints).toEqual(['src/auth/token.ts']);
    expect(authArch?.valueScore).toBeCloseTo(0.4); // 未覆盖 token importance 40 → 0.4

    // auth×coding：无候选 → empty
    expect(cellOf(cells, 'auth', 'coding')?.grade).toBe('empty');
    // pay×arch：无候选 → empty
    expect(cellOf(cells, 'pay', 'arch')?.grade).toBe('empty');
  });

  it('③ thin（候选存在但 0 覆盖）+ exhausted=agent-declared', () => {
    // pay×coding：1 候选（charge），covered=0 → thin；并被 Agent 声明已尽
    const payCoding = cellOf(cells, 'pay', 'coding');
    expect(payCoding).toMatchObject({
      coveredCount: 0,
      totalCandidateCount: 1,
      grade: 'thin',
      exhausted: true,
      exhaustedSource: 'agent-declared',
    });
    expect(payCoding?.exhaustedReason).toBe('agent 已尽');
    expect(payCoding?.valueScore).toBeCloseTo(0.8); // charge importance 80
  });

  it('③ covered：coveredCount ≥ perCellTarget → covered（target 是 advisory 阈值，非阻断门）', () => {
    const covered = buildCoverageLedger({
      candidates: [
        { dimensionIds: ['arch'], sourceRefPaths: ['src/auth/login.ts'], importance: 50 },
        { dimensionIds: ['arch'], sourceRefPaths: ['src/auth/token.ts'], importance: 50 },
      ],
      coveredPaths: ['src/auth/login.ts', 'src/auth/token.ts'], // 两条都覆盖
      modules: MODULES,
      dimensionIds: ['arch'],
      perCellTarget: 2,
    });
    const authArch = cellOf(covered, 'auth', 'arch');
    expect(authArch?.grade).toBe('covered');
    expect(authArch?.coveredCount).toBe(2);
    expect(authArch?.valueScore).toBe(0); // 无未覆盖
    // 输出无 shouldBlock/gate 字段——grade 不是阻断门
    expect(authArch && 'shouldBlockCompletion' in authArch).toBe(false);
  });

  it('③ 路径后缀归属：候选裸文件名经 pathsOverlap 命中 ownedPath', () => {
    const cells2 = buildCoverageLedger({
      candidates: [{ dimensionIds: ['arch'], sourceRefPaths: ['login.ts'], importance: 10 }],
      coveredPaths: [],
      modules: MODULES,
      dimensionIds: ['arch'],
      perCellTarget: 2,
    });
    // 'login.ts' 后缀匹配 owned 'src/auth/login.ts' → 归属 auth
    expect(cellOf(cells2, 'auth', 'arch')?.totalCandidateCount).toBe(1);
  });

  it('RF-9：目录 ownedPath 精确拥有子文件，同时拒绝非 segment 伪前缀', () => {
    const cells2 = buildCoverageLedger({
      candidates: [
        { dimensionIds: ['arch'], sourceRefPaths: ['src/auth/login.ts'], importance: 10 },
        {
          dimensionIds: ['arch'],
          sourceRefPaths: ['src/authentication/session.ts'],
          importance: 10,
        },
      ],
      coveredPaths: ['src/auth/login.ts'],
      modules: [{ moduleId: 'auth-dir', moduleName: 'AuthDir', ownedPaths: ['src/auth'] }],
      dimensionIds: ['arch'],
      perCellTarget: 1,
    });

    const authArch = cellOf(cells2, 'auth-dir', 'arch');
    expect(authArch).toMatchObject({
      coveredCount: 1,
      totalCandidateCount: 1,
      grade: 'covered',
    });
    expect(authArch?.coveredSourceRefs).toEqual(['src/auth/login.ts']);
  });

  it('P4 characterization：固定输入经 public facade 输出保持精确形状', () => {
    expect(
      buildCoverageLedger({
        candidates: CANDIDATES,
        coveredPaths: ['src/auth/login.ts'],
        modules: MODULES,
        dimensionIds: ['arch'],
        perCellTarget: 2,
      })
    ).toEqual([
      {
        moduleId: 'auth',
        moduleName: 'Auth',
        dimensionId: 'arch',
        coveredCount: 1,
        totalCandidateCount: 2,
        grade: 'partial',
        coveredSourceRefs: ['src/auth/login.ts'],
        uncoveredHints: ['src/auth/token.ts'],
        valueScore: 0.4,
        exhausted: false,
        exhaustedReason: null,
        exhaustedSource: null,
      },
      {
        moduleId: 'pay',
        moduleName: 'Pay',
        dimensionId: 'arch',
        coveredCount: 0,
        totalCandidateCount: 0,
        grade: 'empty',
        coveredSourceRefs: [],
        uncoveredHints: [],
        valueScore: 0,
        exhausted: false,
        exhaustedReason: null,
        exhaustedSource: null,
      },
    ]);
  });
});
