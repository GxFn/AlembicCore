import fs from 'node:fs/promises';
import path from 'node:path';

import { computeContentHash } from '../../../shared/contentHash.js';
import type { SourceSliceFileFacts, SourceSliceQueryFailure } from './contracts.js';

export type SourceSliceFileAccessResult =
  | { ok: true; facts: SourceSliceFileFacts }
  | { ok: false; failure: SourceSliceQueryFailure };

export async function loadSourceSliceFile(input: {
  filePath: string;
  projectRoot: string;
  repoId?: string;
  sourceFolder?: string;
}): Promise<SourceSliceFileAccessResult> {
  const identity = resolveSourceSliceFileIdentity(input);
  if (!identity.ok) {
    return identity;
  }

  const rootRealpath = await readRealpath(input.projectRoot);
  if (!rootRealpath) {
    return {
      failure: {
        code: 'invalid-scope',
        message: 'ProjectContext scope.projectRoot must exist before source-slice can read files.',
        path: input.projectRoot,
        retryable: false,
      },
      ok: false,
    };
  }

  const fileRealpath = await readRealpath(identity.identity.absolutePath);
  if (!fileRealpath) {
    return {
      failure: {
        code: 'not-found',
        message: `source-slice file was not found: ${identity.identity.filePath}`,
        path: identity.identity.filePath,
        retryable: false,
      },
      ok: false,
    };
  }
  if (!isInsidePath(rootRealpath, fileRealpath)) {
    return {
      failure: {
        code: 'outside-scope',
        message: 'source-slice file realpath must stay inside scope.projectRoot.',
        path: identity.identity.filePath,
        retryable: false,
      },
      ok: false,
    };
  }

  try {
    const stat = await fs.stat(identity.identity.absolutePath);
    if (!stat.isFile()) {
      return {
        failure: {
          code: 'not-found',
          message: `source-slice target is not a regular file: ${identity.identity.filePath}`,
          path: identity.identity.filePath,
          retryable: false,
        },
        ok: false,
      };
    }

    const text = await fs.readFile(identity.identity.absolutePath, 'utf8');
    const lines = splitSourceTextLines(text);
    return {
      facts: {
        ...identity.identity,
        hash: computeContentHash(text),
        language: inferLanguage(identity.identity.filePath),
        lineCount: Math.max(1, lines.length),
        lines,
        mtimeMs: Math.trunc(stat.mtimeMs),
        text,
      },
      ok: true,
    };
  } catch (error) {
    return {
      failure: classifyReadFailure(error, identity.identity.filePath),
      ok: false,
    };
  }
}

function resolveSourceSliceFileIdentity(input: {
  filePath: string;
  projectRoot: string;
  repoId?: string;
  sourceFolder?: string;
}):
  | {
      ok: true;
      identity: Pick<
        SourceSliceFileFacts,
        'absolutePath' | 'filePath' | 'projectRoot' | 'repoId' | 'sourceFolder'
      >;
    }
  | { ok: false; failure: SourceSliceQueryFailure } {
  const requestedPath = input.filePath.trim();
  if (!requestedPath) {
    return {
      failure: {
        code: 'invalid-scope',
        message: 'source-slice payload.filePath is required.',
        retryable: false,
      },
      ok: false,
    };
  }
  if (hasParentTraversal(requestedPath)) {
    return {
      failure: {
        code: 'outside-scope',
        message: 'source-slice payload.filePath must not contain parent-directory traversal.',
        path: requestedPath,
        retryable: false,
      },
      ok: false,
    };
  }

  const projectRoot = path.resolve(input.projectRoot);
  const normalizedRequestPath = normalizeInputPath(requestedPath);
  const absolutePath = path.isAbsolute(normalizedRequestPath)
    ? path.resolve(normalizedRequestPath)
    : path.resolve(projectRoot, normalizedRequestPath);
  const relativePath = path.relative(projectRoot, absolutePath);
  if (!relativePath || !isContainedRelativePath(relativePath)) {
    return {
      failure: {
        code: 'outside-scope',
        message: 'source-slice payload.filePath must stay inside scope.projectRoot.',
        path: requestedPath,
        retryable: false,
      },
      ok: false,
    };
  }

  return {
    identity: {
      absolutePath,
      filePath: toProjectContextPath(relativePath),
      projectRoot,
      repoId: input.repoId,
      sourceFolder: input.sourceFolder,
    },
    ok: true,
  };
}

function normalizeInputPath(value: string): string {
  return value.replaceAll('\\', '/');
}

function toProjectContextPath(value: string): string {
  return value.split(path.sep).join('/');
}

function hasParentTraversal(value: string): boolean {
  return normalizeInputPath(value).split('/').includes('..');
}

function isContainedRelativePath(value: string): boolean {
  return !value.startsWith('..') && !path.isAbsolute(value);
}

function isInsidePath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || isContainedRelativePath(relative);
}

async function readRealpath(targetPath: string): Promise<string | undefined> {
  try {
    return await fs.realpath(path.resolve(targetPath));
  } catch {
    return undefined;
  }
}

function splitSourceTextLines(content: string): string[] {
  return content.split(/\r\n|\n|\r/);
}

function classifyReadFailure(error: unknown, filePath: string): SourceSliceQueryFailure {
  const code = readErrorCode(error);
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return {
      code: 'not-found',
      message: `source-slice file was not found: ${filePath}`,
      path: filePath,
      retryable: false,
    };
  }

  return {
    code: 'query-unavailable',
    message: `source-slice file could not be read: ${filePath}`,
    path: filePath,
    retryable: true,
  };
}

function readErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function inferLanguage(filePath: string): string | undefined {
  switch (path.extname(filePath).toLowerCase()) {
    case '.ts':
    case '.tsx':
      return 'typescript';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.json':
      return 'json';
    case '.md':
    case '.mdx':
      return 'markdown';
    case '.py':
      return 'python';
    case '.swift':
      return 'swift';
    case '.yml':
    case '.yaml':
      return 'yaml';
    default:
      return undefined;
  }
}
