/**
 * 证据台账领域契约测试（Wave A E1）。
 * 覆盖：ID 生成、引用语法解析（整条/子区间/非法形态）、工具白名单守卫、条目结构守卫。
 * 引用语法用 `@` 分隔子区间，测试同时确认 file:line 形态（捏造引用的典型形态）不被误认。
 */
import { describe, expect, test } from 'vitest';
import {
  EVIDENCE_ENTRY_MAX_CHARS,
  EVIDENCE_TOOL_IDS,
  isEvidenceToolId,
  isValidEvidenceEntry,
  makeEvidenceId,
  parseEvidenceRef,
} from '../src/domain/knowledge/evidence-ledger/index.js';

describe('EvidenceLedgerContract', () => {
  test('makeEvidenceId：正整数序号→E-<n>，非法序号抛错', () => {
    expect(makeEvidenceId(1)).toBe('E-1');
    expect(makeEvidenceId(42)).toBe('E-42');
    expect(() => makeEvidenceId(0)).toThrow(/positive integer/);
    expect(() => makeEvidenceId(1.5)).toThrow(/positive integer/);
    expect(() => makeEvidenceId(-3)).toThrow(/positive integer/);
  });

  test('parseEvidenceRef：整条与子区间两种合法形态（含首尾空白容忍）', () => {
    expect(parseEvidenceRef('E-12')).toEqual({ id: 'E-12' });
    expect(parseEvidenceRef('  E-12  ')).toEqual({ id: 'E-12' });
    expect(parseEvidenceRef('E-12@5-20')).toEqual({ id: 'E-12', range: { start: 5, end: 20 } });
    expect(parseEvidenceRef('E-3@7-7')).toEqual({ id: 'E-3', range: { start: 7, end: 7 } });
  });

  test('parseEvidenceRef：非法形态一律 null（含 file:line——捏造引用的典型形态）', () => {
    expect(parseEvidenceRef('Alembic/lib/types/agent.ts:1-7')).toBeNull();
    expect(parseEvidenceRef('e-1')).toBeNull();
    expect(parseEvidenceRef('E1')).toBeNull();
    expect(parseEvidenceRef('E-1@5-2')).toBeNull(); // end < start
    expect(parseEvidenceRef('E-1@0-3')).toBeNull(); // 1-indexed
    expect(parseEvidenceRef('E-1@a-b')).toBeNull();
    expect(parseEvidenceRef('E-1:5-20')).toBeNull(); // 分隔符必须是 @
    expect(parseEvidenceRef('')).toBeNull();
  });

  test('isEvidenceToolId：证据类工具白名单，memory/meta/knowledge 不属证据源', () => {
    for (const tool of EVIDENCE_TOOL_IDS) {
      expect(isEvidenceToolId(tool)).toBe(true);
    }
    expect(isEvidenceToolId('memory.note_finding')).toBe(false);
    expect(isEvidenceToolId('knowledge.submit')).toBe(false);
    expect(isEvidenceToolId('meta.plan')).toBe(false);
    expect(isEvidenceToolId('code.write')).toBe(false);
  });

  test('isValidEvidenceEntry：合法条目通过，缺字段/坏区间/未知工具拒绝', () => {
    const base = {
      id: 'E-1',
      sessionId: 'bs_1',
      dimensionId: 'ts-js-module',
      tool: 'code.read',
      callId: 'call_1',
      file: 'lib/a.ts',
      range: { start: 1, end: 10 },
      content: 'export const a = 1;',
      contentHash: 'abc123',
      capturedAt: 1_783_000_000_000,
    };
    expect(isValidEvidenceEntry(base)).toBe(true);
    expect(isValidEvidenceEntry({ ...base, file: undefined, range: undefined })).toBe(true);
    expect(isValidEvidenceEntry({ ...base, id: 'X-1' })).toBe(false);
    expect(isValidEvidenceEntry({ ...base, tool: 'memory.recall' })).toBe(false);
    expect(isValidEvidenceEntry({ ...base, range: { start: 0, end: 3 } })).toBe(false);
    expect(isValidEvidenceEntry({ ...base, range: { start: 9, end: 3 } })).toBe(false);
    expect(isValidEvidenceEntry({ ...base, contentHash: '' })).toBe(false);
    expect(isValidEvidenceEntry({ ...base, capturedAt: Number.NaN })).toBe(false);
    expect(isValidEvidenceEntry(null)).toBe(false);
    expect(isValidEvidenceEntry('E-1')).toBe(false);
  });

  test('单条内容上限常量为正且量级合理（CG-1 初值 8000）', () => {
    expect(EVIDENCE_ENTRY_MAX_CHARS).toBe(8000);
  });
});
