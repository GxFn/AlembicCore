import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import {
  hashBytes,
  hashCanonicalJson,
  normalizePortableRelativePath,
  toProjectFactsJson,
} from './canonical.js';
import type {
  CanonicalSha256,
  ProjectContextDependencyOwnershipEntryV1,
  ProjectContextDependencyOwnershipV1,
  ProjectContextDependencyResolutionV1,
  ProjectContextFoundationFileDescriptor,
  ProjectContextFoundationHostPorts,
  ProjectContextFoundationRepositoryInput,
  ProjectContextInventoryPolicyV1,
  ProjectContextRequestAuditPlan,
  ProjectContextRequestDiagnosticV1,
  ProjectContextRequestExecutionResult,
  ProjectContextSnapshotCandidateV1,
  ProjectContextSnapshotVerificationV1,
  ProjectContextSourceRangeV1,
  ProjectFactsJson,
} from './contracts.js';
import {
  PROJECT_CONTEXT_DEPENDENCY_OWNERSHIP_VERSION,
  PROJECT_CONTEXT_SNAPSHOT_PROTOCOL_VERSION,
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
  dependencyOwnership?: ProjectContextDependencyOwnershipV1;
}

interface ResolvedPortableRoot {
  portableId: string;
  root: string;
  current: boolean;
  moduleAliases: string[];
}

export function createProjectContextDependencyOwnershipV1(
  entries: readonly ProjectContextDependencyOwnershipEntryV1[]
): ProjectContextDependencyOwnershipV1 {
  const normalizedEntries = entries
    .map((entry) => ({
      ...entry,
      repoId: requirePortableId(entry.repoId),
      ownerModuleId: requireNonEmpty(entry.ownerModuleId, 'ownerModuleId'),
      ...(entry.ownerPackageName
        ? { ownerPackageName: requireNonEmpty(entry.ownerPackageName, 'ownerPackageName') }
        : {}),
      pattern: requireNonEmpty(entry.pattern, 'ownership pattern'),
      ...(entry.targetPatterns
        ? {
            targetPatterns: uniquePortableAliases(
              entry.targetPatterns.map((target) =>
                normalizePortableRelativePath(target, 'ownership.targetPatterns')
              )
            ),
          }
        : {}),
      provenance: {
        relativePath: normalizePortableRelativePath(
          entry.provenance.relativePath,
          'ownership.provenance.relativePath'
        ),
        contentHash: requireCanonicalSha256(entry.provenance.contentHash),
      },
    }))
    .sort(compareOwnershipEntries);
  const identityKeys = new Set<string>();
  for (const entry of normalizedEntries) {
    if (
      !['package-name', 'package-export', 'package-import', 'module-alias'].includes(entry.source)
    ) {
      throw new TypeError(`Unsupported dependency ownership source: ${entry.source}.`);
    }
    if (entry.source === 'package-import' && !entry.targetPatterns?.length) {
      throw new TypeError(
        `Package import ownership requires at least one canonical target: ${entry.pattern}.`
      );
    }
    const key = hashCanonicalJson(entry);
    if (identityKeys.has(key)) {
      throw new TypeError(
        `Duplicate dependency ownership entry: ${entry.repoId}/${entry.source}/${entry.pattern}.`
      );
    }
    identityKeys.add(key);
  }
  const semantic = {
    version: PROJECT_CONTEXT_DEPENDENCY_OWNERSHIP_VERSION,
    entries: normalizedEntries,
  };
  return { ...semantic, ownershipHash: hashCanonicalJson(semantic) };
}

export class NodeProjectContextFoundationHostPorts implements ProjectContextFoundationHostPorts {
  readonly #projectContext: ProjectContextContract;
  readonly #portableRoots: NodeProjectContextFoundationPortableRoot[];
  readonly #dependencyOwnership?: ProjectContextDependencyOwnershipV1;

  constructor(
    projectContext: ProjectContextContract = ProjectContext,
    options: NodeProjectContextFoundationHostPortsOptions = {}
  ) {
    this.#projectContext = projectContext;
    this.#portableRoots = options.portableRoots ?? [];
    this.#dependencyOwnership = options.dependencyOwnership
      ? validateDependencyOwnership(options.dependencyOwnership)
      : undefined;
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
      const commitResult = await execFileAsync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        signal: input.signal,
      });
      const commitId = commitResult.stdout.trim();
      const [treeResult, statusResult] = await Promise.all([
        execFileAsync('git', ['-C', sourceRoot, 'rev-parse', `${commitId}^{tree}`], {
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
        commitId: commitId || null,
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

  async verifySnapshot(input: {
    repository: ProjectContextFoundationRepositoryInput;
    policy: ProjectContextInventoryPolicyV1;
    candidate: ProjectContextSnapshotCandidateV1;
    signal?: AbortSignal;
  }): Promise<ProjectContextSnapshotVerificationV1> {
    throwIfAborted(input.signal);
    const cleanGit =
      input.candidate.preRevision.kind === 'git' && !input.candidate.preRevision.dirty;
    let verified = false;
    let binding: ProjectContextSnapshotVerificationV1['binding'] = 'working-tree-content';
    let promotedToContentBoundDirty = false;
    if (cleanGit) {
      verified = await this.#candidateMatchesGitTree(input);
      if (verified) {
        binding = 'git-tree';
      } else {
        const terminalCandidate = await this.#captureTerminalCandidate(input);
        verified =
          terminalCandidate.eligibleInventoryHash === input.candidate.eligibleInventoryHash &&
          terminalCandidate.workingTreeContentHash === input.candidate.workingTreeContentHash;
        promotedToContentBoundDirty = verified;
      }
    } else {
      const terminalCandidate = await this.#captureTerminalCandidate(input);
      verified =
        terminalCandidate.eligibleInventoryHash === input.candidate.eligibleInventoryHash &&
        terminalCandidate.workingTreeContentHash === input.candidate.workingTreeContentHash;
    }
    throwIfAborted(input.signal);
    const observedFinalRevision = await this.observeRevision({
      repository: input.repository,
      signal: input.signal,
    });
    const cleanObservationContentPromotion = Boolean(
      promotedToContentBoundDirty &&
        observedFinalRevision.kind === 'git' &&
        !observedFinalRevision.dirty
    );
    const finalRevision =
      cleanObservationContentPromotion && observedFinalRevision.kind === 'git'
        ? { ...observedFinalRevision, dirty: true }
        : observedFinalRevision;
    return {
      version: PROJECT_CONTEXT_SNAPSHOT_PROTOCOL_VERSION,
      verified,
      binding,
      finalRevision,
      eligibleInventoryHash: input.candidate.eligibleInventoryHash,
      workingTreeContentHash: input.candidate.workingTreeContentHash,
      ...(binding === 'git-tree' && input.candidate.preRevision.kind === 'git'
        ? { treeId: input.candidate.preRevision.treeId ?? undefined }
        : {}),
      ...(cleanObservationContentPromotion ? { cleanObservationContentPromotion: true } : {}),
      typedReason: verified
        ? binding === 'git-tree'
          ? 'candidate-path-mode-and-bytes-match-declared-git-tree'
          : promotedToContentBoundDirty
            ? 'candidate-outside-declared-tree-promoted-to-content-bound-dirty-revision'
            : 'terminal-working-tree-content-matches-candidate'
        : cleanGit
          ? 'candidate-does-not-match-declared-git-tree'
          : 'terminal-working-tree-content-does-not-match-candidate',
    };
  }

  async #candidateMatchesGitTree(input: {
    repository: ProjectContextFoundationRepositoryInput;
    policy: ProjectContextInventoryPolicyV1;
    candidate: ProjectContextSnapshotCandidateV1;
    signal?: AbortSignal;
  }): Promise<boolean> {
    const revision = input.candidate.preRevision;
    if (revision.kind !== 'git' || revision.dirty || !revision.treeId) {
      return false;
    }
    const root = await fs.realpath(input.repository.sourceRoot);
    const [{ stdout: treeOutput }, { stdout: objectFormatOutput }] = await Promise.all([
      execFileAsync('git', ['-C', root, 'ls-tree', '-r', '-z', '--full-tree', revision.treeId], {
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
        signal: input.signal,
      }),
      execFileAsync('git', ['-C', root, 'rev-parse', '--show-object-format'], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        signal: input.signal,
      }),
    ]);
    const algorithm = objectFormatOutput.trim();
    if (algorithm !== 'sha1' && algorithm !== 'sha256') {
      return false;
    }
    const expected = parseEligibleGitTree(treeOutput, input.policy);
    const actual = input.candidate.files
      .map(({ file, content }) => ({
        mode: file.mode,
        objectId: gitBlobObjectId(content, algorithm),
        relativePath: file.relativePath,
      }))
      .sort(compareSnapshotTreeRows);
    return hashCanonicalJson(actual) === hashCanonicalJson(expected);
  }

  async #captureTerminalCandidate(input: {
    repository: ProjectContextFoundationRepositoryInput;
    policy: ProjectContextInventoryPolicyV1;
    signal?: AbortSignal;
  }): Promise<{
    eligibleInventoryHash: CanonicalSha256;
    workingTreeContentHash: CanonicalSha256;
  }> {
    const descriptors = await this.enumerateEligibleFiles(input);
    const files = [];
    for (const descriptor of descriptors) {
      throwIfAborted(input.signal);
      const content = Uint8Array.from(
        await this.readFile({
          repository: input.repository,
          relativePath: descriptor.relativePath,
          signal: input.signal,
        })
      );
      files.push({
        repoId: input.repository.repoId,
        relativePath: descriptor.relativePath,
        language: descriptor.language.trim() || 'unknown',
        mode: descriptor.mode.trim(),
        sizeBytes: content.byteLength,
        blobSha256: hashBytes(content),
        ownerModuleIds: uniquePortableAliases(descriptor.ownerModuleIds ?? []),
      });
    }
    files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    return {
      eligibleInventoryHash: hashCanonicalJson(files),
      workingTreeContentHash: hashCanonicalJson(
        files.map((file) => [file.relativePath, file.mode, file.blobSha256])
      ),
    };
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
        await this.#resolvePortableRoots(input.repository),
        this.#dependencyOwnership
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
  dependencyOwnership?: ProjectContextDependencyOwnershipV1;
}): ProjectContextRequestAuditPlan[] {
  const files = [...input.eligibleFiles].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
  const parserFile = files.find((file) =>
    Boolean(resolveAstParserLanguage(file.relativePath, file.language))
  );
  const anyFile = parserFile ?? files[0];
  const moduleSeeds = createCompleteModuleSeeds(
    input.repository.repoId,
    files,
    input.dependencyOwnership ? validateDependencyOwnership(input.dependencyOwnership) : undefined
  );
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
  files: readonly ProjectContextFoundationFileDescriptor[],
  dependencyOwnership?: ProjectContextDependencyOwnershipV1
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
      const ownershipBindings = dependencyOwnership?.entries
        .filter((entry) => entry.repoId === repoId && entry.ownerModuleId === owner)
        .map((entry) => ({
          matchedOwnershipKey: entry.pattern,
          ownershipEvidenceHash: entry.provenance.contentHash,
          ownershipProvenancePath: entry.provenance.relativePath,
          ownershipSource: entry.source,
          ...(entry.targetPatterns ? { targetPatterns: entry.targetPatterns } : {}),
          ...(entry.ownerPackageName ? { ownerPackageName: entry.ownerPackageName } : {}),
        }));
      return {
        moduleName,
        ...(modulePath ? { modulePath } : {}),
        ownerModuleId: owner,
        ownedFiles: [...ownedFiles].sort(),
        role: 'certified-inventory-owner',
        ...(ownershipBindings && ownershipBindings.length > 0
          ? {
              dependencyOwnershipBindings: ownershipBindings,
              dependencyOwnershipHash: dependencyOwnership?.ownershipHash,
            }
          : {}),
      };
    });
}

function projectContextEnvelopeToAuditResult(
  envelope: ProjectContextEnvelope<ProjectContextResult>,
  repository: ProjectContextFoundationRepositoryInput,
  plan: ProjectContextRequestAuditPlan,
  portableRoots: ResolvedPortableRoot[],
  dependencyOwnership?: ProjectContextDependencyOwnershipV1
): ProjectContextRequestExecutionResult {
  const classifications = (envelope.errors ?? []).map((error) =>
    classifyProjectContextDiagnostic(error, repository, plan, portableRoots, dependencyOwnership)
  );
  const dependencyResolutions = classifications
    .map((classification) => classification.resolution)
    .filter((resolution): resolution is ProjectContextDependencyResolutionV1 => Boolean(resolution))
    .sort(compareDependencyResolutions);
  const dependencyObservationCount = (envelope.errors ?? []).filter(
    isExternalDependencyDiagnostic
  ).length;
  const dependencyGraphReconciliation = summarizeDependencyGraphReconciliation(
    envelope.data,
    dependencyResolutions
  );
  const reconciledEnvelope = reconcileDependencyGraphEnvelope(envelope, dependencyResolutions);
  const output = portableProjectContextJson(reconciledEnvelope, portableRoots);
  const unavailable = isUnavailableData(envelope.data);
  const queryUnavailable = (envelope.errors ?? []).some(
    (error) => error.code === 'query-unavailable'
  );
  const detectedLanguage = findFirstStringByKey(output, 'language');
  const diagnostics = classifications
    .map((classification) => classification.diagnostic)
    .filter((diagnostic): diagnostic is ProjectContextRequestDiagnosticV1 => Boolean(diagnostic))
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
    dependencyResolutions,
    dependencyObservationCount,
    dependencyGraphReconciliation,
  };
}

function classifyProjectContextDiagnostic(
  error: ProjectContextQueryError,
  repository: ProjectContextFoundationRepositoryInput,
  plan: ProjectContextRequestAuditPlan,
  portableRoots: ResolvedPortableRoot[],
  dependencyOwnership?: ProjectContextDependencyOwnershipV1
): {
  diagnostic?: ProjectContextRequestDiagnosticV1;
  resolution?: ProjectContextDependencyResolutionV1;
} {
  const externalDependencyMessage = isExternalDependencyDiagnostic(error);
  const dependencyName = externalDependencyMessage
    ? error.message.slice(error.message.indexOf(':') + 1).trim()
    : undefined;
  if (dependencyName && dependencyOwnership) {
    const ownership = resolveDependencyOwnership(
      dependencyName,
      repository.repoId,
      dependencyOwnership
    );
    const declaredOwnerIds = new Set(collectOwnerModuleIds(plan.selector));
    if (ownership.kind === 'matched') {
      const entry = ownership.entry;
      const ownerDeclared = declaredOwnerIds.has(entry.ownerModuleId);
      if (entry.repoId === repository.repoId && ownerDeclared) {
        const resolvedTargets = resolveOwnershipTargetPaths(entry, dependencyName, plan.selector);
        if (
          entry.source === 'package-import' &&
          (!entry.targetPatterns?.length || resolvedTargets.length !== 1)
        ) {
          return confirmedOwnershipFailure(
            error,
            dependencyName,
            repository.repoId,
            plan,
            entry.targetPatterns?.length
              ? 'package-import-target-is-not-one-certified-owned-file'
              : 'package-import-ownership-has-no-canonical-target',
            entry
          );
        }
        return {
          resolution: createDependencyResolution({
            classification: 'internal-resolved',
            dependencyName,
            entry,
            importerRepoId: repository.repoId,
            requestKind: plan.kind,
            resolvedTargets,
            typedReason: 'dependency-resolved-by-current-repository-module-seed-binding',
          }),
        };
      }
      if (entry.repoId === repository.repoId) {
        return confirmedOwnershipFailure(
          error,
          dependencyName,
          repository.repoId,
          plan,
          'certified-owner-module-is-missing-from-request-seeds',
          entry
        );
      }
      return {
        diagnostic: {
          classification: 'advisory',
          code: error.code,
          message: portableString(error.message, portableRoots),
          retryable: error.retryable,
          severity: error.severity,
          typedReason: 'dependency-crosses-an-approved-sibling-repository-boundary',
          ...(error.path ? { path: portableString(error.path, portableRoots) } : {}),
          relatedRepoId: entry.repoId,
        },
        resolution: createDependencyResolution({
          classification: 'approved-sibling',
          dependencyName,
          entry,
          importerRepoId: repository.repoId,
          requestKind: plan.kind,
          typedReason: 'dependency-resolved-to-approved-sibling-package-export-or-module',
        }),
      };
    }
    if (ownership.kind === 'ambiguous' || ownership.kind === 'known-unexported') {
      return confirmedOwnershipFailure(
        error,
        dependencyName,
        repository.repoId,
        plan,
        ownership.kind === 'ambiguous'
          ? 'dependency-ownership-is-ambiguous'
          : 'known-package-subpath-is-not-exported',
        ownership.entries[0]
      );
    }
    return {
      diagnostic: {
        classification: 'expected-external',
        code: error.code,
        message: portableString(error.message, portableRoots),
        retryable: error.retryable,
        severity: error.severity,
        typedReason: 'dependency-is-outside-certified-repository-ownership',
        ...(error.path ? { path: portableString(error.path, portableRoots) } : {}),
      },
      resolution: {
        classification: 'expected-external',
        dependencyName,
        importerRepoId: repository.repoId,
        requestKind: plan.kind,
        typedReason: 'no-canonical-certified-owner-matched-dependency',
      },
    };
  }
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
    diagnostic: {
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
    },
  };
}

function isExternalDependencyDiagnostic(error: ProjectContextQueryError): boolean {
  return (
    error.code === 'query-unavailable' &&
    error.message.startsWith('map external dependency is not owned by module seeds:')
  );
}

function createDependencyResolution(input: {
  classification: 'internal-resolved' | 'approved-sibling';
  dependencyName: string;
  entry: ProjectContextDependencyOwnershipEntryV1;
  importerRepoId: string;
  requestKind: ProjectContextRequestAuditPlan['kind'];
  resolvedTargets?: string[];
  typedReason: string;
}): ProjectContextDependencyResolutionV1 {
  return {
    classification: input.classification,
    dependencyName: input.dependencyName,
    importerRepoId: input.importerRepoId,
    requestKind: input.requestKind,
    typedReason: input.typedReason,
    ownerRepoId: input.entry.repoId,
    ownerModuleId: input.entry.ownerModuleId,
    ...(input.entry.ownerPackageName ? { ownerPackageName: input.entry.ownerPackageName } : {}),
    ownershipSource: input.entry.source,
    matchedOwnershipKey: input.entry.pattern,
    ownershipEvidenceHash: input.entry.provenance.contentHash,
    ownershipProvenancePath: input.entry.provenance.relativePath,
    ...(input.resolvedTargets?.length
      ? {
          resolvedTargets: input.resolvedTargets.map((relativePath) => ({ relativePath })),
        }
      : {}),
  };
}

function confirmedOwnershipFailure(
  error: ProjectContextQueryError,
  dependencyName: string,
  importerRepoId: string,
  plan: ProjectContextRequestAuditPlan,
  typedReason: string,
  entry?: ProjectContextDependencyOwnershipEntryV1
): {
  diagnostic: ProjectContextRequestDiagnosticV1;
  resolution: ProjectContextDependencyResolutionV1;
} {
  return {
    diagnostic: {
      classification: 'confirmed-defect',
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      severity: 'error',
      typedReason,
      ...(entry && entry.repoId !== importerRepoId ? { relatedRepoId: entry.repoId } : {}),
    },
    resolution: {
      classification: 'confirmed-defect',
      dependencyName,
      importerRepoId,
      requestKind: plan.kind,
      typedReason,
      ...(entry
        ? {
            ownerRepoId: entry.repoId,
            ownerModuleId: entry.ownerModuleId,
            ...(entry.ownerPackageName ? { ownerPackageName: entry.ownerPackageName } : {}),
            ownershipSource: entry.source,
            matchedOwnershipKey: entry.pattern,
            ownershipEvidenceHash: entry.provenance.contentHash,
            ownershipProvenancePath: entry.provenance.relativePath,
          }
        : {}),
    },
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

function collectOwnerModuleIds(value: ProjectFactsJson): string[] {
  const owners = new Set<string>();
  visitJsonObjects(value, (record) => {
    const owner = readString(record, 'ownerModuleId');
    if (owner) {
      owners.add(owner);
    }
  });
  return [...owners].sort();
}

function resolveOwnershipTargetPaths(
  entry: ProjectContextDependencyOwnershipEntryV1,
  dependencyName: string,
  selector: ProjectFactsJson
): string[] {
  const captures = ownershipPatternCaptures(entry.pattern, dependencyName);
  if (!captures || !entry.targetPatterns?.length) {
    return [];
  }
  const ownedFiles = new Set<string>();
  visitJsonObjects(selector, (record) => {
    if (readString(record, 'ownerModuleId') !== entry.ownerModuleId) {
      return;
    }
    const files = record.ownedFiles;
    if (Array.isArray(files)) {
      for (const file of files) {
        if (typeof file === 'string') {
          ownedFiles.add(file);
        }
      }
    }
  });
  const resolved = new Set<string>();
  for (const targetPattern of entry.targetPatterns) {
    let captureIndex = 0;
    const target = targetPattern.replaceAll('*', () => captures[captureIndex++] ?? '');
    for (const candidate of sourceTargetCandidates(target)) {
      if (ownedFiles.has(candidate)) {
        resolved.add(candidate);
      }
    }
  }
  return [...resolved].sort();
}

function ownershipPatternCaptures(pattern: string, dependencyName: string): string[] | undefined {
  if (!pattern.includes('*')) {
    return pattern === dependencyName ? [] : undefined;
  }
  const expression = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('(.+)');
  const match = new RegExp(`^${expression}$`).exec(dependencyName);
  return match?.slice(1);
}

function sourceTargetCandidates(target: string): string[] {
  const candidates = new Set([target]);
  const sourceExtensions: Record<string, string[]> = {
    '.js': ['.ts', '.tsx'],
    '.mjs': ['.mts'],
    '.cjs': ['.cts'],
  };
  const extension = path.posix.extname(target);
  for (const replacement of sourceExtensions[extension] ?? []) {
    candidates.add(`${target.slice(0, -extension.length)}${replacement}`);
  }
  return [...candidates];
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

interface SnapshotTreeRow {
  relativePath: string;
  mode: string;
  objectId: string;
}

function parseEligibleGitTree(
  output: string,
  policy: ProjectContextInventoryPolicyV1
): SnapshotTreeRow[] {
  const includeExtensions = new Set(policy.includeExtensions.map((value) => value.toLowerCase()));
  const excludeDirectories = new Set(policy.excludeDirectories);
  const result: SnapshotTreeRow[] = [];
  for (const record of output.split('\0')) {
    if (!record) {
      continue;
    }
    const tabIndex = record.indexOf('\t');
    const metadata = tabIndex >= 0 ? record.slice(0, tabIndex) : '';
    const relativePath = tabIndex >= 0 ? record.slice(tabIndex + 1) : '';
    const [mode, type, objectId] = metadata.split(' ');
    if (
      type !== 'blob' ||
      !['100644', '100755'].includes(mode ?? '') ||
      !relativePath ||
      !includeExtensions.has(path.posix.extname(relativePath).toLowerCase()) ||
      relativePath.split('/').some((segment) => excludeDirectories.has(segment)) ||
      isExcluded(relativePath, policy.excludeRelativePaths ?? [])
    ) {
      continue;
    }
    result.push({ mode: mode!, objectId: objectId!, relativePath });
  }
  return result.sort(compareSnapshotTreeRows);
}

function gitBlobObjectId(content: Uint8Array, algorithm: 'sha1' | 'sha256'): string {
  return createHash(algorithm).update(`blob ${content.byteLength}\0`).update(content).digest('hex');
}

function compareSnapshotTreeRows(left: SnapshotTreeRow, right: SnapshotTreeRow): number {
  return (
    left.relativePath.localeCompare(right.relativePath) ||
    left.mode.localeCompare(right.mode) ||
    left.objectId.localeCompare(right.objectId)
  );
}

function validateDependencyOwnership(
  ownership: ProjectContextDependencyOwnershipV1
): ProjectContextDependencyOwnershipV1 {
  if (ownership.version !== PROJECT_CONTEXT_DEPENDENCY_OWNERSHIP_VERSION) {
    throw new TypeError(`Unsupported dependency ownership version: ${ownership.version}.`);
  }
  const normalized = createProjectContextDependencyOwnershipV1(ownership.entries);
  if (normalized.ownershipHash !== ownership.ownershipHash) {
    throw new TypeError('Dependency ownership hash does not match its canonical entries.');
  }
  return normalized;
}

type OwnershipResolution =
  | { kind: 'matched'; entry: ProjectContextDependencyOwnershipEntryV1 }
  | { kind: 'ambiguous'; entries: ProjectContextDependencyOwnershipEntryV1[] }
  | { kind: 'known-unexported'; entries: ProjectContextDependencyOwnershipEntryV1[] }
  | { kind: 'unowned' };

function resolveDependencyOwnership(
  dependencyName: string,
  importerRepoId: string,
  ownership: ProjectContextDependencyOwnershipV1
): OwnershipResolution {
  const matches = ownership.entries.filter((entry) => {
    if (entry.source === 'package-import' && entry.repoId !== importerRepoId) {
      return false;
    }
    return ownershipPatternMatches(entry.pattern, dependencyName);
  });
  if (matches.length > 0) {
    const mostSpecific = Math.max(...matches.map(ownershipSpecificity));
    const finalists = matches.filter((entry) => ownershipSpecificity(entry) === mostSpecific);
    const ownerKeys = new Set(finalists.map((entry) => `${entry.repoId}\0${entry.ownerModuleId}`));
    if (ownerKeys.size > 1) {
      return { kind: 'ambiguous', entries: finalists.sort(compareOwnershipEntries) };
    }
    return { kind: 'matched', entry: finalists.sort(compareOwnershipEntries)[0]! };
  }
  const knownPackages = ownership.entries.filter(
    (entry) =>
      entry.ownerPackageName &&
      dependencyName.startsWith(`${entry.ownerPackageName}/`) &&
      entry.source !== 'package-import'
  );
  if (knownPackages.length > 0) {
    return { kind: 'known-unexported', entries: knownPackages.sort(compareOwnershipEntries) };
  }
  return { kind: 'unowned' };
}

function ownershipPatternMatches(pattern: string, dependencyName: string): boolean {
  if (!pattern.includes('*')) {
    return pattern === dependencyName;
  }
  const expression = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('(.+)');
  return new RegExp(`^${expression}$`).test(dependencyName);
}

function ownershipSpecificity(entry: ProjectContextDependencyOwnershipEntryV1): number {
  const exactBonus = entry.pattern.includes('*') ? 0 : 1_000_000;
  const sourceBonus =
    entry.source === 'package-import' ? 30 : entry.source === 'package-export' ? 20 : 10;
  return exactBonus + sourceBonus + entry.pattern.replaceAll('*', '').length;
}

function compareDependencyResolutions(
  left: ProjectContextDependencyResolutionV1,
  right: ProjectContextDependencyResolutionV1
): number {
  return (
    left.classification.localeCompare(right.classification) ||
    left.dependencyName.localeCompare(right.dependencyName) ||
    left.importerRepoId.localeCompare(right.importerRepoId)
  );
}

function summarizeDependencyGraphReconciliation(
  value: unknown,
  resolutions: readonly ProjectContextDependencyResolutionV1[]
): ProjectContextRequestExecutionResult['dependencyGraphReconciliation'] {
  const classificationsByName = new Map<string, Set<string>>();
  for (const resolution of resolutions) {
    const classifications = classificationsByName.get(resolution.dependencyName) ?? new Set();
    classifications.add(resolution.classification);
    classificationsByName.set(resolution.dependencyName, classifications);
  }
  const summary = {
    originalExternalHotspotCount: 0,
    internalResolvedHotspotCount: 0,
    approvedSiblingHotspotCount: 0,
    remainingExternalHotspotCount: 0,
  };
  const originalNames = new Set<string>();
  const internalNames = new Set<string>();
  const approvedSiblingNames = new Set<string>();
  const remainingNames = new Set<string>();
  visit(value);
  return {
    ...summary,
    originalExternalDependencyNames: [...originalNames].sort(),
    internalResolvedDependencyNames: [...internalNames].sort(),
    approvedSiblingDependencyNames: [...approvedSiblingNames].sort(),
    remainingExternalDependencyNames: [...remainingNames].sort(),
  };

  function visit(entry: unknown): void {
    if (Array.isArray(entry)) {
      for (const item of entry) {
        visit(item);
      }
      return;
    }
    const record = readRecord(entry);
    if (!record) {
      return;
    }
    for (const [key, child] of Object.entries(record)) {
      if (key !== 'externalDependencyHotspots' || !Array.isArray(child)) {
        visit(child);
        continue;
      }
      for (const hotspot of child) {
        summary.originalExternalHotspotCount += 1;
        const name = readString(readRecord(hotspot), 'name');
        if (name) {
          originalNames.add(name);
        }
        const classifications = name ? classificationsByName.get(name) : undefined;
        if (classifications?.has('internal-resolved')) {
          summary.internalResolvedHotspotCount += 1;
          internalNames.add(name!);
        } else if (classifications?.has('approved-sibling')) {
          summary.approvedSiblingHotspotCount += 1;
          approvedSiblingNames.add(name!);
        } else {
          summary.remainingExternalHotspotCount += 1;
          if (name) {
            remainingNames.add(name);
          }
        }
      }
    }
  }
}

function reconcileDependencyGraphEnvelope<T extends ProjectContextResult>(
  envelope: ProjectContextEnvelope<T>,
  resolutions: readonly ProjectContextDependencyResolutionV1[]
): ProjectContextEnvelope<T> {
  const graphResolutions = resolutions.filter((resolution) =>
    ['internal-resolved', 'approved-sibling'].includes(resolution.classification)
  );
  if (graphResolutions.length === 0) {
    return envelope;
  }
  return {
    ...envelope,
    data: reconcileDependencyGraphValue(envelope.data, graphResolutions) as T,
  };
}

function reconcileDependencyGraphValue(
  value: unknown,
  resolutions: readonly ProjectContextDependencyResolutionV1[]
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => reconcileDependencyGraphValue(entry, resolutions));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const record = value as Record<string, unknown>;
  const transformed = Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [
      key,
      key === 'externalDependencyHotspots' && Array.isArray(entry)
        ? entry.filter((hotspot) => {
            const name = readString(readRecord(hotspot), 'name');
            return !name || !resolutions.some((resolution) => resolution.dependencyName === name);
          })
        : reconcileDependencyGraphValue(entry, resolutions),
    ])
  );
  if (Array.isArray(record.externalDependencyHotspots)) {
    const hotspotNames = new Set(
      record.externalDependencyHotspots
        .map((hotspot) => readString(readRecord(hotspot), 'name'))
        .filter((name): name is string => Boolean(name))
    );
    const nodeResolutions = resolutions.filter((resolution) =>
      hotspotNames.has(resolution.dependencyName)
    );
    const approvedSiblingDependencies = buildOwnedDependencyHotspots(
      record.externalDependencyHotspots,
      nodeResolutions.filter((resolution) => resolution.classification === 'approved-sibling')
    );
    const internalResolutions = nodeResolutions.filter(
      (resolution) => resolution.classification === 'internal-resolved'
    );
    const internalDependencies = buildOwnedDependencyHotspots(
      record.externalDependencyHotspots,
      internalResolutions
    );
    transformed.dependencyOwnershipResolutions = nodeResolutions;
    transformed.approvedSiblingDependencyHotspots = approvedSiblingDependencies;
    transformed.internalDependencyNamespaceResolutions = internalDependencies;
    transformed.dependencySummary = reconcileDependencySummary(
      transformed.dependencySummary,
      internalDependencies.length,
      approvedSiblingDependencies.length,
      (transformed.externalDependencyHotspots as unknown[]).length
    );
  }
  return transformed;
}

function buildOwnedDependencyHotspots(
  hotspots: readonly unknown[],
  resolutions: readonly ProjectContextDependencyResolutionV1[]
): unknown[] {
  return resolutions.flatMap((resolution) =>
    hotspots
      .filter((hotspot) => readString(readRecord(hotspot), 'name') === resolution.dependencyName)
      .map((hotspot) => ({
        ...readRecord(hotspot),
        ownerModuleId: resolution.ownerModuleId,
        ownerRepoId: resolution.ownerRepoId,
        ownershipEvidenceHash: resolution.ownershipEvidenceHash,
        ownershipProvenancePath: resolution.ownershipProvenancePath,
        ownershipSource: resolution.ownershipSource,
        matchedOwnershipKey: resolution.matchedOwnershipKey,
        ...(resolution.resolvedTargets ? { resolvedTargets: resolution.resolvedTargets } : {}),
      }))
  );
}

function reconcileDependencySummary(
  value: unknown,
  internalResolutionCount: number,
  approvedSiblingCount: number,
  externalCount: number
): unknown {
  const summary = readRecord(value);
  if (!summary) {
    return value;
  }
  const notes = Array.isArray(summary.notes)
    ? summary.notes.filter(
        (entry): entry is string =>
          typeof entry === 'string' && !entry.startsWith('external-dependencies:')
      )
    : [];
  return {
    ...summary,
    notes: [
      ...notes,
      `internal-namespace-resolutions:${internalResolutionCount}`,
      `approved-sibling-dependencies:${approvedSiblingCount}`,
      `external-dependencies:${externalCount}`,
    ],
  };
}

function compareOwnershipEntries(
  left: ProjectContextDependencyOwnershipEntryV1,
  right: ProjectContextDependencyOwnershipEntryV1
): number {
  return (
    left.repoId.localeCompare(right.repoId) ||
    left.ownerModuleId.localeCompare(right.ownerModuleId) ||
    left.source.localeCompare(right.source) ||
    left.pattern.localeCompare(right.pattern) ||
    left.provenance.contentHash.localeCompare(right.provenance.contentHash)
  );
}

function requireNonEmpty(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`${fieldName} is required.`);
  }
  return normalized;
}

function requireCanonicalSha256(value: CanonicalSha256): CanonicalSha256 {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`Invalid canonical SHA-256: ${value}.`);
  }
  return value;
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
