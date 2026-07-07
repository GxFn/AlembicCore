import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  ALEMBIC_MANAGED_GUIDANCE_BEGIN,
  ALEMBIC_MANAGED_GUIDANCE_END,
  AlembicManagedBlockError,
  removeAlembicManagedBlock,
  removeAlembicManagedBlockText,
  upsertAlembicManagedBlock,
  upsertAlembicManagedBlockText,
} from '../src/io.js';
import pathGuard, { PathGuardError } from '../src/shared/PathGuard.js';

const BLOCK_A = [
  ALEMBIC_MANAGED_GUIDANCE_BEGIN,
  '- Prefer Alembic knowledge before broad search.',
  ALEMBIC_MANAGED_GUIDANCE_END,
].join('\n');

describe('Alembic managed guidance blocks', () => {
  test('upsert appends a managed block when markers are absent', () => {
    const original = 'User guidance stays first.';
    const result = upsertAlembicManagedBlockText(original, '- Prefer Alembic.');

    expect(result.blockFound).toBe(false);
    expect(result.changed).toBe(true);
    expect(result.content).toBe(
      [
        'User guidance stays first.',
        ALEMBIC_MANAGED_GUIDANCE_BEGIN,
        '- Prefer Alembic.',
        ALEMBIC_MANAGED_GUIDANCE_END,
        '',
      ].join('\n')
    );
  });

  test('upsert replaces only bytes between the managed markers', () => {
    const original = ['before', BLOCK_A, 'after'].join('\n');
    const result = upsertAlembicManagedBlockText(original, '- Use current Alembic context.');

    expect(result.blockFound).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.content).toBe(
      [
        'before',
        ALEMBIC_MANAGED_GUIDANCE_BEGIN,
        '- Use current Alembic context.',
        ALEMBIC_MANAGED_GUIDANCE_END,
        'after',
      ].join('\n')
    );
  });

  test('upsert is idempotent when the block already matches', () => {
    const first = upsertAlembicManagedBlockText('', '- Prefer Alembic.');
    const second = upsertAlembicManagedBlockText(first.content, '- Prefer Alembic.');

    expect(first.changed).toBe(true);
    expect(second.blockFound).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
  });

  test('remove is a no-op when markers are absent', () => {
    const content = 'Plain user content.';
    const result = removeAlembicManagedBlockText(content);

    expect(result.blockFound).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.content).toBe(content);
  });

  test('remove preserves surrounding content exactly', () => {
    const original = ['before\n', BLOCK_A, '\nafter'].join('');
    const result = removeAlembicManagedBlockText(original);

    expect(result.blockFound).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.content).toBe('before\n\nafter');
  });

  test('malformed markers throw instead of touching content', () => {
    expect(() =>
      upsertAlembicManagedBlockText(`${ALEMBIC_MANAGED_GUIDANCE_BEGIN}\nmissing end`, 'body')
    ).toThrow(AlembicManagedBlockError);
    expect(() =>
      removeAlembicManagedBlockText(
        [
          ALEMBIC_MANAGED_GUIDANCE_BEGIN,
          'outer',
          ALEMBIC_MANAGED_GUIDANCE_BEGIN,
          'inner',
          ALEMBIC_MANAGED_GUIDANCE_END,
        ].join('\n')
      )
    ).toThrow(AlembicManagedBlockError);
    expect(() =>
      removeAlembicManagedBlockText(`${ALEMBIC_MANAGED_GUIDANCE_END}\nwrong order`)
    ).toThrow(AlembicManagedBlockError);
  });

  test('file writes require an explicit project root file allowlist entry', () => {
    const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'alembic-managed-block-'));
    const hostFile = path.join(projectRoot, 'CLAUDE.md');
    const otherRootFile = path.join(projectRoot, 'AGENTS.md');

    try {
      pathGuard._reset();
      pathGuard.configure({ knowledgeBaseDir: 'Alembic', projectRoot });

      expect(() => upsertAlembicManagedBlock(hostFile, '- Prefer Alembic.')).toThrow(
        PathGuardError
      );
      expect(pathGuard.addProjectWritableFile('CLAUDE.md')).toBe(true);

      const first = upsertAlembicManagedBlock(hostFile, '- Prefer Alembic.');
      const second = upsertAlembicManagedBlock(hostFile, '- Prefer Alembic.');

      expect(first.created).toBe(true);
      expect(first.wrote).toBe(true);
      expect(second.wrote).toBe(false);
      expect(readFileSync(hostFile, 'utf8')).toContain('- Prefer Alembic.');
      expect(() => upsertAlembicManagedBlock(otherRootFile, '- Prefer Alembic.')).toThrow(
        PathGuardError
      );

      const removeResult = removeAlembicManagedBlock(hostFile);
      expect(removeResult.changed).toBe(true);
      expect(readFileSync(hostFile, 'utf8')).toBe('\n');
    } finally {
      pathGuard._reset();
      rmSync(projectRoot, { force: true, recursive: true });
    }
  });

  test('remove absent file is a no-op and never creates directories', () => {
    const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'alembic-managed-block-'));
    const missingFile = path.join(projectRoot, 'nested', 'CLAUDE.md');

    try {
      pathGuard._reset();
      pathGuard.configure({ knowledgeBaseDir: 'Alembic', projectRoot });

      const result = removeAlembicManagedBlock(missingFile);
      expect(result.changed).toBe(false);
      expect(result.created).toBe(false);
      expect(() => readFileSync(missingFile, 'utf8')).toThrow();
    } finally {
      pathGuard._reset();
      rmSync(projectRoot, { force: true, recursive: true });
    }
  });

  test('file upsert does not alter user bytes outside the managed block', () => {
    const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'alembic-managed-block-'));
    const hostFile = path.join(projectRoot, 'CLAUDE.md');

    try {
      pathGuard._reset();
      pathGuard.configure({ knowledgeBaseDir: 'Alembic', projectRoot });
      pathGuard.addProjectWritableFile('CLAUDE.md');
      writeFileSync(hostFile, ['# Host guidance', '', BLOCK_A, 'Keep this tail.'].join('\n'));

      const result = upsertAlembicManagedBlock(hostFile, '- New guidance.');
      expect(result.changed).toBe(true);
      expect(readFileSync(hostFile, 'utf8')).toBe(
        [
          '# Host guidance',
          '',
          ALEMBIC_MANAGED_GUIDANCE_BEGIN,
          '- New guidance.',
          ALEMBIC_MANAGED_GUIDANCE_END,
          'Keep this tail.',
        ].join('\n')
      );
    } finally {
      pathGuard._reset();
      rmSync(projectRoot, { force: true, recursive: true });
    }
  });
});
