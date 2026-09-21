import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { ProjectContextExecutionContext } from '../../../domain/project-context/index.js';
import { computeContentHash } from '../../../shared/contentHash.js';
import type { FileAnalysisSession } from '../analysis/FileAnalysisSession.js';
import type { ProjectContextHandlerExecutionContext } from '../interface/contracts.js';
import { throwIfProjectContextAborted } from '../interface/execution.js';
import type {
  SourceSliceFileFacts,
  SourceSliceFileIdentity,
  SourceSliceQueryFailure,
} from './contracts.js';

export type SourceSliceFileAccessResult =
  | { ok: true; facts: SourceSliceFileFacts }
  | { ok: false; failure: SourceSliceQueryFailure };

export async function loadSourceSliceFile(input: {
  filePath: string;
  projectRoot: string;
  repoId?: string;
  sourceFolder?: string;
  signal?: AbortSignal;
  onSourceFileRead?: ProjectContextExecutionContext['onSourceFileRead'];
  analysis?: FileAnalysisSession;
  onSourceFileVersion?: ProjectContextHandlerExecutionContext['onSourceFileVersion'];
}): Promise<SourceSliceFileAccessResult> {
  throwIfProjectContextAborted(input);
  const identity = resolveSourceSliceFileIdentity(input);
  if (!identity.ok) {
    return identity;
  }

  const read = () => readSourceSliceFile(input, identity.identity);
  // 路径校验必须先于缓存命中，不能让含 '..' 的非法别名复用合法文件的缓存。
  const result = await (input.analysis
    ? input.analysis.readSourceFile(identity.identity, read)
    : read());
  throwIfProjectContextAborted(input);
  if (result.ok) {
    // 缓存命中也绑定消费版本，旧会话内容不能被下一次 capture 默认为新 inventory。
    const { projectRoot, filePath, blobSha256 } = result.facts;
    input.onSourceFileVersion?.({ projectRoot, filePath, blobSha256 });
  }
  return result;
}

async function readSourceSliceFile(
  input: {
    projectRoot: string;
    signal?: AbortSignal;
    onSourceFileRead?: ProjectContextExecutionContext['onSourceFileRead'];
  },
  identity: SourceSliceFileIdentity
): Promise<SourceSliceFileAccessResult> {
  const rootRealpath = await readRealpath(input.projectRoot);
  throwIfProjectContextAborted(input);
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

  const fileRealpath = await readRealpath(identity.absolutePath);
  throwIfProjectContextAborted(input);
  if (!fileRealpath) {
    return {
      failure: {
        code: 'not-found',
        message: `source-slice file was not found: ${identity.filePath}`,
        path: identity.filePath,
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
        path: identity.filePath,
        retryable: false,
      },
      ok: false,
    };
  }

  try {
    const stat = await fs.stat(identity.absolutePath);
    throwIfProjectContextAborted(input);
    if (!stat.isFile()) {
      return {
        failure: {
          code: 'not-found',
          message: `source-slice target is not a regular file: ${identity.filePath}`,
          path: identity.filePath,
          retryable: false,
        },
        ok: false,
      };
    }

    const content = await fs.readFile(identity.absolutePath, {
      signal: input.signal,
    });
    throwIfProjectContextAborted(input);
    const text = content.toString('utf8');
    const blobSha256 = `sha256:${createHash('sha256').update(content).digest('hex')}` as const;
    // 原始 blob 与兼容短 hash 各司其职；UTF-8 解码替换字符不能改变捕获校验的依据。
    input.onSourceFileRead?.({
      projectRoot: identity.projectRoot,
      filePath: identity.filePath,
      content,
    });
    const lines = splitSourceTextLines(text);
    return {
      facts: {
        ...identity,
        blobSha256,
        hash: computeContentHash(text),
        language: inferLanguage(identity.filePath),
        lineCount: Math.max(1, lines.length),
        lines,
        mtimeMs: Math.trunc(stat.mtimeMs),
        text,
      },
      ok: true,
    };
  } catch (error) {
    if (input.signal?.aborted) {
      throwIfProjectContextAborted(input);
    }
    return {
      failure: classifyReadFailure(error, identity.filePath),
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
    case '.mts':
    case '.cts':
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
