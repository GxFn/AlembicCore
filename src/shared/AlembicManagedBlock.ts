import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import pathGuard from './PathGuard.js';

export const ALEMBIC_MANAGED_GUIDANCE_BEGIN = '<!-- alembic:managed-guidance:begin -->';
export const ALEMBIC_MANAGED_GUIDANCE_END = '<!-- alembic:managed-guidance:end -->';

export type AlembicManagedBlockIssue =
  | 'missing-begin-marker'
  | 'missing-end-marker'
  | 'marker-order'
  | 'duplicate-begin-marker'
  | 'duplicate-end-marker';

export class AlembicManagedBlockError extends Error {
  issue: AlembicManagedBlockIssue;

  constructor(issue: AlembicManagedBlockIssue) {
    super(`[AlembicManagedBlock] malformed managed block markers: ${issue}`);
    this.name = 'AlembicManagedBlockError';
    this.issue = issue;
  }
}

export interface AlembicManagedBlockTextResult {
  blockFound: boolean;
  changed: boolean;
  content: string;
}

export interface AlembicManagedBlockFileResult extends AlembicManagedBlockTextResult {
  created: boolean;
  filePath: string;
  wrote: boolean;
}

interface ManagedBlockLocation {
  end: number;
  start: number;
}

export function upsertAlembicManagedBlockText(
  content: string,
  body: string
): AlembicManagedBlockTextResult {
  const block = formatManagedGuidanceBlock(body);
  const location = locateManagedGuidanceBlock(content);
  const nextContent = location
    ? `${content.slice(0, location.start)}${block}${content.slice(location.end)}`
    : appendManagedGuidanceBlock(content, block);

  return {
    blockFound: location !== null,
    changed: nextContent !== content,
    content: nextContent,
  };
}

export function removeAlembicManagedBlockText(content: string): AlembicManagedBlockTextResult {
  const location = locateManagedGuidanceBlock(content);
  if (!location) {
    return {
      blockFound: false,
      changed: false,
      content,
    };
  }

  const nextContent = `${content.slice(0, location.start)}${content.slice(location.end)}`;
  return {
    blockFound: true,
    changed: nextContent !== content,
    content: nextContent,
  };
}

export function upsertAlembicManagedBlock(
  filePath: string,
  body: string
): AlembicManagedBlockFileResult {
  const exists = existsSync(filePath);
  const original = exists ? readFileSync(filePath, 'utf8') : '';
  const result = upsertAlembicManagedBlockText(original, body);

  if (result.changed) {
    pathGuard.assertProjectWriteSafe(filePath);
    writeFileSync(filePath, result.content, 'utf8');
  }

  return {
    ...result,
    created: !exists && result.changed,
    filePath,
    wrote: result.changed,
  };
}

export function removeAlembicManagedBlock(filePath: string): AlembicManagedBlockFileResult {
  if (!existsSync(filePath)) {
    return {
      blockFound: false,
      changed: false,
      content: '',
      created: false,
      filePath,
      wrote: false,
    };
  }

  const original = readFileSync(filePath, 'utf8');
  const result = removeAlembicManagedBlockText(original);

  if (result.changed) {
    pathGuard.assertProjectWriteSafe(filePath);
    writeFileSync(filePath, result.content, 'utf8');
  }

  return {
    ...result,
    created: false,
    filePath,
    wrote: result.changed,
  };
}

function formatManagedGuidanceBlock(body: string): string {
  const normalizedBody = body.replace(/\r\n/g, '\n').trimEnd();
  if (!normalizedBody) {
    return `${ALEMBIC_MANAGED_GUIDANCE_BEGIN}\n${ALEMBIC_MANAGED_GUIDANCE_END}`;
  }
  return `${ALEMBIC_MANAGED_GUIDANCE_BEGIN}\n${normalizedBody}\n${ALEMBIC_MANAGED_GUIDANCE_END}`;
}

function appendManagedGuidanceBlock(content: string, block: string): string {
  const separator = content.length === 0 || content.endsWith('\n') ? '' : '\n';
  return `${content}${separator}${block}\n`;
}

function locateManagedGuidanceBlock(content: string): ManagedBlockLocation | null {
  const beginIndexes = findMarkerIndexes(content, ALEMBIC_MANAGED_GUIDANCE_BEGIN);
  const endIndexes = findMarkerIndexes(content, ALEMBIC_MANAGED_GUIDANCE_END);

  if (beginIndexes.length === 0 && endIndexes.length === 0) {
    return null;
  }
  if (beginIndexes.length === 0) {
    throw new AlembicManagedBlockError('missing-begin-marker');
  }
  if (endIndexes.length === 0) {
    throw new AlembicManagedBlockError('missing-end-marker');
  }
  if (beginIndexes.length > 1) {
    throw new AlembicManagedBlockError('duplicate-begin-marker');
  }
  if (endIndexes.length > 1) {
    throw new AlembicManagedBlockError('duplicate-end-marker');
  }

  const start = beginIndexes[0];
  const endMarkerStart = endIndexes[0];
  if (endMarkerStart < start) {
    throw new AlembicManagedBlockError('marker-order');
  }

  return {
    end: endMarkerStart + ALEMBIC_MANAGED_GUIDANCE_END.length,
    start,
  };
}

function findMarkerIndexes(content: string, marker: string): number[] {
  const indexes: number[] = [];
  let cursor = content.indexOf(marker);
  while (cursor !== -1) {
    indexes.push(cursor);
    cursor = content.indexOf(marker, cursor + marker.length);
  }
  return indexes;
}
