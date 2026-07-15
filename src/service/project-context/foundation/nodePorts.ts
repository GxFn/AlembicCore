import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  ProjectContext as ProjectContextContract,
  ProjectContextEnvelope,
  ProjectContextQueryError,
  ProjectContextResult,
} from '../../../domain/project-context/index.js';
import { LanguageService } from '../../../shared/LanguageService.js';
import { ProjectContext } from '../ProjectContextService.js';
import { resolveAstParserLanguage } from '../shared/parserLanguage.js';
import { normalizePortableRelativePath, toProjectFactsJson } from './canonical.js';
import type {
  ProjectContextFoundationFileDescriptor,
  ProjectContextFoundationHostPorts,
  ProjectContextFoundationRepositoryInput,
  ProjectContextInventoryPolicyV1,
  ProjectContextRequestAuditPlan,
  ProjectContextRequestDiagnosticV1,
  ProjectContextRequestExecutionResult,
  ProjectContextSourceRangeV1,
  ProjectFactsJson,
} from './contracts.js';

const execFileAsync = promisify(execFile);
const VOLATILE_SEMANTIC_KEYS = new Set([
  'mtimeMs',
  'timestamp',
  'createdAt',
  'updatedAt',
  'pid',
  'processId',
]);
const PARSER_REQUEST_KINDS = new Set(['anchor-range', 'file-flow', 'file-symbols']);

export interface NodeProjectContextFoundationPortableRoot {
  portableId: string;
  sourceRoot: string;
  moduleAliases?: string[];
}

export interface NodeProjectContextFoundationHostPortsOptions {
  portableRoots?: NodeProjectContextFoundationPortableRoot[];
}

interface ResolvedPortableRoot {
  portableId: string;
  root: string;
  current: boolean;
  moduleAliases: string[];
}

export class NodeProjectContextFoundationHostPorts implements ProjectContextFoundationHostPorts {
  readonly #projectContext: ProjectContextContract;
  readonly #portableRoots: NodeProjectContextFoundationPortableRoot[];

  constructor(
    projectContext: ProjectContextContract = ProjectContext,
    options: NodeProjectContextFoundationHostPortsOptions = {}
  ) {
    this.#projectContext = projectContext;
    this.#portableRoots = options.portableRoots ?? [];
  }

  async observeRevision(input: {
    repository: ProjectContextFoundationRepositoryInput;
    signal?: AbortSignal;
  }) {
    throwIfAborted(input.signal);
    const sourceRoot = await fs.realpath(input.repository.sourceRoot);
    try {
      const { stdout: gitRootOutput } = await execFileAsync(
        'git',
        ['-C', sourceRoot, 'rev-parse', '--show-toplevel'],
        { encoding: 'utf8', maxBuffer: 1024 * 1024, signal: input.signal }
      );
      const gitRoot = await fs.realpath(gitRootOutput.trim());
      // Package scopes nested inside one Git worktree get content revisions of their own;
      // assigning the parent repository commit would hide package-local identity.
      if (gitRoot !== sourceRoot) {
        return { kind: 'content' as const };
      }
      const [commitResult, treeResult, statusResult] = await Promise.all([
        execFileAsync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], {
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
          signal: input.signal,
        }),
        execFileAsync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD^{tree}'], {
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
          signal: input.signal,
        }),
        execFileAsync(
          'git',
          ['-C', sourceRoot, 'status', '--porcelain=v1', '-z', '--untracked-files=all'],
          {
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
            signal: input.signal,
          }
        ),
      ]);
      return {
        kind: 'git' as const,
        dirty: statusResult.stdout.length > 0,
        commitId: commitResult.stdout.trim() || null,
        treeId: treeResult.stdout.trim() || null,
      };
    } catch (error) {
      if (input.signal?.aborted) {
        throw error;
      }
      return { kind: 'content' as const };
    }
  }

  async enumerateEligibleFiles(input: {
    repository: ProjectContextFoundationRepositoryInput;
    policy: ProjectContextInventoryPolicyV1;
    signal?: AbortSignal;
  }): Promise<ProjectContextFoundationFileDescriptor[]> {
    const root = await fs.realpath(input.repository.sourceRoot);
    const excludeDirectories = new Set(input.policy.excludeDirectories);
    const excludeRelativePaths = input.policy.excludeRelativePaths ?? [];
    const includeExtensions = new Set(
      input.policy.includeExtensions.map((value) => value.toLowerCase())
    );
    const pending = [root];
    const descriptors: ProjectContextFoundationFileDescriptor[] = [];
    while (pending.length > 0) {
      throwIfAborted(input.signal);
      const current = pending.pop();
      if (!current) {
        continue;
      }
      const entries = (await fs.readdir(current, { withFileTypes: true })).sort((left, right) =>
        left.name.localeCompare(right.name)
      );
      for (const entry of entries) {
        throwIfAborted(input.signal);
        const absolutePath = path.join(current, entry.name);
        const relativePath = normalizePortableRelativePath(
          path.relative(root, absolutePath).split(path.sep).join('/'),
          'eligibleFile.relativePath'
        );
        if (isExcluded(relativePath, excludeRelativePaths)) {
          continue;
        }
        if (entry.isDirectory()) {
          if (!excludeDirectories.has(entry.name)) {
            pending.push(absolutePath);
          }
          continue;
        }
        if (!entry.isFile() || !includeExtensions.has(path.extname(entry.name).toLowerCase())) {
          continue;
        }
        const stat = await fs.stat(absolutePath);
        descriptors.push({
          relativePath,
          language: LanguageService.inferLang(relativePath),
          mode: stat.mode & 0o111 ? '100755' : '100644',
          ownerModuleIds: inferOwnerModuleIds(relativePath),
        });
      }
    }
    descriptors.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    return descriptors.map((entry) => ({
      ...entry,
      ownerModuleIds: [...(entry.ownerModuleIds ?? [])],
    }));
  }

  async readFile(input: {
    repository: ProjectContextFoundationRepositoryInput;
    relativePath: string;
    signal?: AbortSignal;
  }): Promise<Uint8Array> {
    throwIfAborted(input.signal);
    const root = await fs.realpath(input.repository.sourceRoot);
    const relativePath = normalizePortableRelativePath(input.relativePath, 'relativePath');
    const candidate = path.resolve(root, relativePath);
    const realCandidate = await fs.realpath(candidate);
    if (!isContained(root, realCandidate)) {
      throw new TypeError(`Eligible file escaped its approved source root: ${relativePath}.`);
    }
    return fs.readFile(realCandidate);
  }

  async executeRequest(input: {
    repository: ProjectContextFoundationRepositoryInput;
    plan: ProjectContextRequestAuditPlan;
    signal?: AbortSignal;
  }): Promise<ProjectContextRequestExecutionResult> {
    throwIfAborted(input.signal);
    try {
      const envelope = await this.#projectContext.execute(
        {
          kind: input.plan.kind,
          project: {
            projectId: input.repository.scopeId,
            displayName: input.repository.repoId,
            projectRoot: input.repository.sourceRoot,
            source: 'certified-project-facts-capture',
          },
          scope: {
            ...input.plan.scope,
            projectRoot: input.repository.sourceRoot,
            repoId: input.plan.scope.repoId ?? input.repository.repoId,
          },
          payload: input.plan.selector,
        },
        { signal: input.signal }
      );
      return projectContextEnvelopeToAuditResult(
        envelope,
        input.repository,
        input.plan,
        await this.#resolvePortableRoots(input.repository)
      );
    } catch (error) {
      if (isAbortError(error) || input.signal?.aborted) {
        return {
          terminalStatus: 'cancelled',
          output: { code: 'cancelled', message: 'ProjectContext request was cancelled.' },
          parserRuntime: 'not-required',
          queryInitialization: 'not-required',
          sourceRanges: [],
          errors: [
            {
              classification: 'confirmed-defect',
              code: 'cancelled',
              message: 'ProjectContext request was cancelled.',
              retryable: true,
              severity: 'error',
              typedReason: 'request-did-not-reach-a-terminal-success-state',
            },
          ],
        };
      }
      throw error;
    }
  }

  async #resolvePortableRoots(
    repository: ProjectContextFoundationRepositoryInput
  ): Promise<ResolvedPortableRoot[]> {
    const inputs = [
      {
        portableId: repository.repoId,
        sourceRoot: repository.sourceRoot,
        current: true,
        moduleAliases: [] as string[],
      },
      ...this.#portableRoots.map((entry) => ({ ...entry, current: false })),
    ];
    const byRoot = new Map<string, ResolvedPortableRoot>();
    for (const input of inputs) {
      const portableId = requirePortableId(input.portableId);
      const roots = [
        (await fs.realpath(input.sourceRoot)).replace(/\\/g, '/'),
        path.resolve(input.sourceRoot).replace(/\\/g, '/'),
      ];
      for (const root of roots) {
        if (!byRoot.has(root)) {
          byRoot.set(root, {
            portableId,
            root,
            current: input.current,
            moduleAliases: uniquePortableAliases(input.moduleAliases ?? []),
          });
        }
      }
    }
    return [...byRoot.values()].sort(
      (left, right) =>
        Number(right.current) - Number(left.current) ||
        right.root.length - left.root.length ||
        left.portableId.localeCompare(right.portableId)
    );
  }
}

export function createProjectContextRequestAuditPlans(input: {
  repository: ProjectContextFoundationRepositoryInput;
  eligibleFiles: readonly ProjectContextFoundationFileDescriptor[];
}): ProjectContextRequestAuditPlan[] {
  const files = [...input.eligibleFiles].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
  const parserFile = files.find((file) =>
    Boolean(resolveAstParserLanguage(file.relativePath, file.language))
  );
  const anyFile = parserFile ?? files[0];
  const moduleSeeds = createCompleteModuleSeeds(input.repository.repoId, files);
  const scope = { repoId: input.repository.repoId };
  const plans: ProjectContextRequestAuditPlan[] = [
    applicableOrNa({
      repoId: input.repository.repoId,
      kind: 'anchor-range',
      scope,
      selector: anyFile
        ? { filePath: anyFile.relativePath, line: 1, radius: { beforeLines: 0, afterLines: 0 } }
        : undefined,
      reason: 'no-eligible-source-file',
    }),
    {
      repoId: input.repository.repoId,
      kind: 'space',
      applicability: 'applicable',
      scope,
      selector: {
        sourceFolders: [
          {
            displayName: input.repository.repoId,
            folderId: input.repository.repoId,
            path: '.',
            repositoryId: input.repository.repoId,
            role: 'primary-source',
          },
        ],
        ...(anyFile ? { sourceRefs: [anyFile.relativePath] } : {}),
      },
    },
    {
      repoId: input.repository.repoId,
      kind: 'repo',
      applicability: 'applicable',
      scope,
      selector: {
        repoName: input.repository.repoId,
        ...(moduleSeeds.length > 0 ? { moduleSeeds } : {}),
      },
    },
    applicableOrNa({
      repoId: input.repository.repoId,
      kind: 'map',
      scope,
      selector:
        moduleSeeds.length > 0 ? { moduleSeeds, repoName: input.repository.repoId } : undefined,
      reason: 'no-module-seed-from-eligible-inventory',
    }),
    ...(moduleSeeds.length > 0
      ? moduleSeeds.map((selector) => ({
          repoId: input.repository.repoId,
          kind: 'module' as const,
          applicability: 'applicable' as const,
          scope,
          selector,
        }))
      : [
          applicableOrNa({
            repoId: input.repository.repoId,
            kind: 'module',
            scope,
            selector: undefined,
            reason: 'no-module-seed-from-eligible-inventory',
          }),
        ]),
    ...(moduleSeeds.length > 0
      ? moduleSeeds.map((selector) => ({
          repoId: input.repository.repoId,
          kind: 'module-layers' as const,
          applicability: 'applicable' as const,
          scope,
          selector,
        }))
      : [
          applicableOrNa({
            repoId: input.repository.repoId,
            kind: 'module-layers',
            scope,
            selector: undefined,
            reason: 'no-module-seed-from-eligible-inventory',
          }),
        ]),
    applicableOrNa({
      repoId: input.repository.repoId,
      kind: 'file-flow',
      scope,
      selector: parserFile ? { filePath: parserFile.relativePath } : undefined,
      reason: 'no-parser-supported-source-file',
    }),
    applicableOrNa({
      repoId: input.repository.repoId,
      kind: 'file-symbols',
      scope,
      selector: parserFile ? { filePath: parserFile.relativePath } : undefined,
      reason: 'no-parser-supported-source-file',
    }),
    applicableOrNa({
      repoId: input.repository.repoId,
      kind: 'source-slice',
      scope,
      selector: anyFile
        ? { filePath: anyFile.relativePath, includeText: true, range: { startLine: 1, endLine: 1 } }
        : undefined,
      reason: 'no-eligible-source-file',
    }),
  ];
  return plans;
}

function createCompleteModuleSeeds(
  repoId: string,
  files: readonly ProjectContextFoundationFileDescriptor[]
): ProjectFactsJson[] {
  const byOwner = new Map<string, Set<string>>();
  for (const file of files) {
    const owners = file.ownerModuleIds?.length
      ? file.ownerModuleIds
      : inferOwnerModuleIds(file.relativePath);
    for (const owner of owners) {
      const ownedFiles = byOwner.get(owner) ?? new Set<string>();
      ownedFiles.add(file.relativePath);
      byOwner.set(owner, ownedFiles);
    }
  }
  return [...byOwner.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([owner, ownedFiles]) => {
      const ownerPath = owner.slice(owner.indexOf(':') + 1);
      const modulePath = owner.startsWith('package:')
        ? `Packages/${ownerPath}`
        : ['module:', 'path:', 'test:'].some((prefix) => owner.startsWith(prefix))
          ? ownerPath
          : undefined;
      const moduleName =
        owner === 'root' ? repoId : path.posix.basename(modulePath ?? ownerPath) || repoId;
      return {
        moduleName,
        ...(modulePath ? { modulePath } : {}),
        ownerModuleId: owner,
        ownedFiles: [...ownedFiles].sort(),
        role: 'certified-inventory-owner',
      };
    });
}

function projectContextEnvelopeToAuditResult(
  envelope: ProjectContextEnvelope<ProjectContextResult>,
  repository: ProjectContextFoundationRepositoryInput,
  plan: ProjectContextRequestAuditPlan,
  portableRoots: ResolvedPortableRoot[]
): ProjectContextRequestExecutionResult {
  const output = portableProjectContextJson(envelope, portableRoots);
  const unavailable = isUnavailableData(envelope.data);
  const queryUnavailable = (envelope.errors ?? []).some(
    (error) => error.code === 'query-unavailable'
  );
  const detectedLanguage = findFirstStringByKey(output, 'language');
  const diagnostics = (envelope.errors ?? [])
    .map((error) => classifyProjectContextDiagnostic(error, plan, portableRoots))
    .sort(compareDiagnostics);
  const hasConfirmedDefect = diagnostics.some(
    (diagnostic) => diagnostic.classification === 'confirmed-defect'
  );
  return {
    terminalStatus: hasConfirmedDefect ? 'failed' : unavailable ? 'unavailable' : 'completed',
    output,
    ...(detectedLanguage ? { detectedLanguage } : {}),
    parserRuntime: parserReadiness(plan, detectedLanguage, queryUnavailable),
    queryInitialization: queryReadiness(plan, queryUnavailable),
    sourceRanges: collectSourceRanges(output, repository.repoId),
    errors: diagnostics,
  };
}

function classifyProjectContextDiagnostic(
  error: ProjectContextQueryError,
  plan: ProjectContextRequestAuditPlan,
  portableRoots: ResolvedPortableRoot[]
): ProjectContextRequestDiagnosticV1 {
  const externalDependencyMessage =
    error.code === 'query-unavailable' &&
    error.message.startsWith('map external dependency is not owned by module seeds:');
  const dependencyName = externalDependencyMessage
    ? error.message.slice(error.message.indexOf(':') + 1).trim()
    : undefined;
  const declaredModules = collectDeclaredModuleNames(plan.selector);
  const unresolvedInternal = Boolean(
    dependencyName &&
      [...declaredModules].some(
        (moduleName) =>
          moduleName.toLowerCase() === dependencyName.toLowerCase() ||
          dependencyName.toLowerCase().includes(`/${moduleName.toLowerCase()}/`)
      )
  );
  const sibling = dependencyName
    ? findRelatedPortableRepo(dependencyName, portableRoots)
    : undefined;
  const expectedExternal = Boolean(
    dependencyName && !unresolvedInternal && !sibling && isExternalDependencyName(dependencyName)
  );
  const classification = unresolvedInternal
    ? 'confirmed-defect'
    : sibling
      ? 'advisory'
      : expectedExternal
        ? 'expected-external'
        : error.severity === 'warning'
          ? 'advisory'
          : 'confirmed-defect';
  return {
    classification,
    code: error.code,
    message: portableString(error.message, portableRoots),
    retryable: error.retryable,
    severity: error.severity,
    typedReason: unresolvedInternal
      ? 'declared-internal-module-remained-unresolved'
      : sibling
        ? 'dependency-crosses-an-approved-sibling-repository-boundary'
        : expectedExternal
          ? 'dependency-is-outside-certified-repository-ownership'
          : classification === 'advisory'
            ? 'project-context-warning-retained-for-review'
            : 'project-context-error-invalidates-certified-readiness',
    ...(error.path ? { path: portableString(error.path, portableRoots) } : {}),
    ...(sibling ? { relatedRepoId: sibling } : {}),
  };
}

function collectDeclaredModuleNames(value: ProjectFactsJson): Set<string> {
  const names = new Set<string>();
  visitJsonObjects(value, (record) => {
    const moduleName = readString(record, 'moduleName');
    if (moduleName) {
      names.add(moduleName);
    }
  });
  return names;
}

function findRelatedPortableRepo(
  dependencyName: string,
  portableRoots: ResolvedPortableRoot[]
): string | undefined {
  const normalized = dependencyName.replace(/\\/g, '/').toLowerCase();
  if (!dependencyName.startsWith('.')) {
    return portableRoots.find(
      (root) =>
        !root.current &&
        (normalized === path.posix.basename(root.root).toLowerCase() ||
          normalized === root.portableId.toLowerCase() ||
          root.moduleAliases.some((alias) => normalized === alias.toLowerCase()))
    )?.portableId;
  }
  return portableRoots.find(
    (root) =>
      !root.current &&
      (normalized.includes(`/${path.posix.basename(root.root).toLowerCase()}/`) ||
        normalized.includes(root.portableId.toLowerCase()))
  )?.portableId;
}

function uniquePortableAliases(aliases: readonly string[]): string[] {
  return [...new Set(aliases.map((alias) => alias.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
}

function isExternalDependencyName(value: string): boolean {
  return (
    value.startsWith('node:') ||
    value.startsWith('@') ||
    (!value.startsWith('.') && !value.startsWith('/') && !value.includes('\\'))
  );
}

function compareDiagnostics(
  left: ProjectContextRequestDiagnosticV1,
  right: ProjectContextRequestDiagnosticV1
): number {
  return (
    left.classification.localeCompare(right.classification) ||
    left.code.localeCompare(right.code) ||
    left.message.localeCompare(right.message)
  );
}

function portableProjectContextJson(
  value: unknown,
  portableRoots: ResolvedPortableRoot[],
  key?: string
): ProjectFactsJson {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return toProjectFactsJson(value);
  }
  if (typeof value === 'string') {
    return portableString(value, portableRoots);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => portableProjectContextJson(entry, portableRoots));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, ProjectFactsJson> = {};
    for (const [entryKey, entry] of Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right)
    )) {
      if (entry === undefined || VOLATILE_SEMANTIC_KEYS.has(entryKey)) {
        continue;
      }
      result[entryKey] = portableProjectContextJson(entry, portableRoots, entryKey);
    }
    return result;
  }
  throw new TypeError(`ProjectContext response key ${key ?? '<root>'} is not JSON serializable.`);
}

function portableString(value: string, portableRoots: ResolvedPortableRoot[]): string {
  const normalizedValue = value.replace(/\\/g, '/');
  for (const portableRoot of portableRoots) {
    if (normalizedValue === portableRoot.root) {
      return portableRoot.current ? '.' : `portable:${portableRoot.portableId}:.`;
    }
    if (normalizedValue.startsWith(`${portableRoot.root}/`)) {
      const relativePath = normalizePortableRelativePath(
        normalizedValue.slice(portableRoot.root.length + 1)
      );
      return portableRoot.current
        ? relativePath
        : `portable:${portableRoot.portableId}:${relativePath}`;
    }
  }
  return portableRoots.reduce(
    (result, portableRoot) =>
      portableRoot.root === '/'
        ? result
        : result.replaceAll(
            portableRoot.root,
            portableRoot.current ? '.' : `portable:${portableRoot.portableId}`
          ),
    normalizedValue
  );
}

function collectSourceRanges(
  value: ProjectFactsJson,
  fallbackRepoId: string
): ProjectContextSourceRangeV1[] {
  const ranges = new Map<string, ProjectContextSourceRangeV1>();
  visitJsonObjects(value, (record) => {
    const range = readRecord(record.range);
    const relativePath = readString(record, 'filePath');
    const startLine = readNumber(range, 'startLine');
    const endLine = readNumber(range, 'endLine');
    if (!relativePath || !startLine || !endLine) {
      return;
    }
    const repoId = readString(record, 'repoId') ?? fallbackRepoId;
    const normalizedPath = normalizePortableRelativePath(relativePath, 'sourceRange.relativePath');
    const row = { repoId, relativePath: normalizedPath, startLine, endLine };
    ranges.set(`${repoId}\u0000${normalizedPath}\u0000${startLine}\u0000${endLine}`, row);
  });
  return [...ranges.values()].sort(
    (left, right) =>
      left.repoId.localeCompare(right.repoId) ||
      left.relativePath.localeCompare(right.relativePath) ||
      left.startLine - right.startLine ||
      left.endLine - right.endLine
  );
}

function parserReadiness(
  plan: ProjectContextRequestAuditPlan,
  detectedLanguage: string | undefined,
  queryUnavailable: boolean
): ProjectContextRequestExecutionResult['parserRuntime'] {
  if (!PARSER_REQUEST_KINDS.has(plan.kind)) {
    return 'not-required';
  }
  const selector = readRecord(plan.selector);
  const filePath = readString(selector, 'filePath') ?? '';
  if (!resolveAstParserLanguage(filePath, detectedLanguage)) {
    return 'not-required';
  }
  return queryUnavailable ? 'unavailable' : 'ready';
}

function queryReadiness(
  plan: ProjectContextRequestAuditPlan,
  queryUnavailable: boolean
): ProjectContextRequestExecutionResult['queryInitialization'] {
  if (!PARSER_REQUEST_KINDS.has(plan.kind)) {
    return 'not-required';
  }
  return queryUnavailable ? 'unavailable' : 'ready';
}

function applicableOrNa(input: {
  repoId: string;
  kind: ProjectContextRequestAuditPlan['kind'];
  scope: ProjectContextRequestAuditPlan['scope'];
  selector: ProjectFactsJson | undefined;
  reason: string;
}): ProjectContextRequestAuditPlan {
  return input.selector
    ? {
        repoId: input.repoId,
        kind: input.kind,
        applicability: 'applicable',
        scope: input.scope,
        selector: input.selector,
      }
    : {
        repoId: input.repoId,
        kind: input.kind,
        applicability: 'not-applicable',
        typedReason: input.reason,
        scope: input.scope,
        selector: {},
      };
}

function isUnavailableData(value: ProjectContextResult): boolean {
  return Boolean(
    value && typeof value === 'object' && 'available' in value && value.available === false
  );
}

function visitJsonObjects(
  value: ProjectFactsJson,
  visitor: (record: Record<string, ProjectFactsJson>) => void
): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      visitJsonObjects(entry, visitor);
    }
  } else if (value && typeof value === 'object') {
    visitor(value);
    for (const entry of Object.values(value)) {
      visitJsonObjects(entry, visitor);
    }
  }
}

function findFirstStringByKey(value: ProjectFactsJson, key: string): string | undefined {
  let result: string | undefined;
  visitJsonObjects(value, (record) => {
    if (!result && typeof record[key] === 'string') {
      result = record[key];
    }
  });
  return result;
}

function inferOwnerModuleIds(relativePath: string): string[] {
  const parts = relativePath.split('/');
  const extension = path.posix.extname(relativePath).toLowerCase();
  const sourceLike = [
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.swift',
    '.m',
    '.mm',
    '.h',
    '.kt',
    '.kts',
    '.java',
    '.py',
    '.go',
    '.rs',
    '.dart',
  ].includes(extension);
  if (!sourceLike || parts.length <= 1) {
    return [];
  }
  const packageIndex = parts.findIndex((part) => part.toLowerCase() === 'packages');
  const packageSourcesIndex = packageIndex >= 0 ? parts.indexOf('Sources', packageIndex + 1) : -1;
  if (packageSourcesIndex >= 0 && parts[packageSourcesIndex + 1]) {
    return [`module:${parts.slice(0, packageSourcesIndex + 2).join('/')}`];
  }
  if (parts[0] === 'Sources') {
    const layered = ['Core', 'Infrastructure', 'Features'].includes(parts[1] ?? '');
    const moduleEnd = layered && parts[2] ? 3 : 2;
    return [`module:${parts.slice(0, moduleEnd).join('/')}`];
  }
  if (parts[0] === 'BiliDili') {
    return ['module:BiliDili'];
  }
  if (parts[0] === 'Tests' && parts[1]) {
    return [`test:${parts.slice(0, 2).join('/')}`];
  }
  if (['src', 'lib', 'app', 'source'].includes(parts[0]?.toLowerCase() ?? '')) {
    return [`module:${parts[0]}`];
  }
  return [];
}

function isExcluded(relativePath: string, excludes: readonly string[]): boolean {
  return excludes.some(
    (exclude) => relativePath === exclude || relativePath.startsWith(`${exclude}/`)
  );
}

function isContained(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function readRecord(value: unknown): Record<string, ProjectFactsJson> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, ProjectFactsJson>)
    : {};
}

function readString(record: Record<string, ProjectFactsJson>, key: string): string | undefined {
  return typeof record[key] === 'string' ? record[key] : undefined;
}

function readNumber(record: Record<string, ProjectFactsJson>, key: string): number | undefined {
  return typeof record[key] === 'number' ? record[key] : undefined;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error('ProjectContext capture aborted.');
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'Aborted');
}

function requirePortableId(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized !== value || /[\\/]/.test(normalized)) {
    throw new TypeError('Portable root id must be a canonical stable identifier.');
  }
  return normalized;
}
