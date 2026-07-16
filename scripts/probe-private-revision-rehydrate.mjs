#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), '..');
const [mode, workspaceRoot, controlRoot] = process.argv.slice(2);

if (mode === '--process-a' || mode === '--process-b') {
  if (!workspaceRoot || !controlRoot) {
    throw new Error('PRIVATE_REVISION_PROBE_WORKER_ARGUMENTS_REQUIRED');
  }
  await runWorker(mode, workspaceRoot, controlRoot);
} else {
  const outIndex = process.argv.indexOf('--out');
  const outputPath = outIndex >= 0 ? process.argv[outIndex + 1] : null;
  await runOrchestrator(outputPath);
}

async function runOrchestrator(outputPath) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alembic-rehydrate-probe-'));
  const isolatedWorkspace = path.join(temporaryRoot, 'workspace');
  const isolatedControl = path.join(temporaryRoot, 'control');
  fs.mkdirSync(isolatedWorkspace, { mode: 0o700 });
  fs.mkdirSync(isolatedControl, { mode: 0o700 });

  try {
    const processA = runProcess('--process-a', isolatedWorkspace, isolatedControl);
    const processB = runProcess('--process-b', isolatedWorkspace, isolatedControl);
    const processAResult = readJson(path.join(isolatedControl, 'process-a.json'));
    const processBResult = readJson(path.join(isolatedControl, 'process-b.json'));
    const semantic = {
      schemaVersion: 1,
      kind: 'PrivateCorpusRevisionFreshProcessRehydrateProbeV1',
      publicApi: {
        initialize: processAResult.publicApi.initialize,
        rehydrate: processBResult.publicApi.rehydrate,
        repositoryFactory: processBResult.publicApi.repositoryFactory,
      },
      distinctProcesses: processAResult.pid !== processBResult.pid,
      processAExitCode: processA.status,
      processBExitCode: processB.status,
      sameDataRootIdentity:
        processAResult.dataRootHash === processBResult.dataRootHash &&
        processAResult.dataRootHash === processAResult.initReceiptHashBoundDataRoot,
      sameDatabaseBytes:
        processAResult.databaseBytesHash === processBResult.databaseBytesHash,
      initReceiptHash: processAResult.initReceiptHash,
      dataRootHash: processAResult.dataRootHash,
      databaseBytesHash: processBResult.databaseBytesHash,
      durableSession: processBResult.durableSession,
      builtArtifactHashes: {
        workspace: hashFile(path.join(repositoryRoot, 'dist', 'workspace.js')),
        repositories: hashFile(path.join(repositoryRoot, 'dist', 'repositories.js')),
        shared: hashFile(path.join(repositoryRoot, 'dist', 'shared', 'index.js')),
        productionPersistence: hashFile(
          path.join(
            repositoryRoot,
            'dist',
            'service',
            'production',
            'ProductionPersistenceContracts.js'
          )
        ),
      },
    };
    if (
      !semantic.publicApi.initialize ||
      !semantic.publicApi.rehydrate ||
      !semantic.publicApi.repositoryFactory ||
      !semantic.distinctProcesses ||
      semantic.processAExitCode !== 0 ||
      semantic.processBExitCode !== 0 ||
      !semantic.sameDataRootIdentity ||
      !semantic.sameDatabaseBytes ||
      semantic.durableSession?.context?.durableStage !== 'PERSIST_PREPARED'
    ) {
      throw new Error('PRIVATE_REVISION_FRESH_PROCESS_PROBE_FAILED');
    }
    const result = {
      ...semantic,
      probeReceiptHash: hashCanonicalJson(semantic),
    };
    const bytes = `${canonicalJsonStringify(result)}\n`;
    if (outputPath) {
      fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
      fs.writeFileSync(path.resolve(outputPath), bytes, { mode: 0o600 });
    }
    process.stdout.write(bytes);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

async function runWorker(workerMode, workspace, control) {
  const [{ readAlembicMigrationBundleManifest }, { createAlembicRepositories }, shared, api] =
    await Promise.all([
      import('@alembic/core/database'),
      import('@alembic/core/repositories'),
      import('@alembic/core/shared'),
      import('@alembic/core/workspace'),
    ]);
  const baseResolver = createBaseResolver(shared, workspace);
  if (workerMode === '--process-a') {
    const migrationBundleSemanticHash = hashCanonicalJson(
      readAlembicMigrationBundleManifest()
    );
    const initialized = await api.initializePrivateCorpusRevisionV1(baseResolver, {
      runId: 'run-fresh-process',
      revisionId: 'revision-1',
      analysisFixpointHash: `sha256:${'1'.repeat(64)}`,
      configReceiptHash: `sha256:${'c'.repeat(64)}`,
      credentialLocationSymbol: 'env:DEEPSEEK_API_KEY',
      acceptedMigrationBundleSemanticHash: migrationBundleSemanticHash,
    });
    const repositories = createAlembicRepositories(initialized.runtime.connection);
    await repositories.sessionRepository.create({
      id: 'durable-session',
      scope: 'strict-run',
      scopeId: 'run-fresh-process',
      context: { durableStage: 'PERSIST_PREPARED' },
      metadata: { revisionId: 'revision-1' },
      actor: 'alembic-main',
      createdAt: 1,
    });
    const databasePath = initialized.handle.resolver.databasePath;
    const result = {
      pid: process.pid,
      publicApi: {
        initialize: typeof api.initializePrivateCorpusRevisionV1 === 'function',
      },
      initReceipt: initialized.handle.initReceipt,
      initReceiptHash: initialized.handle.initReceipt.initReceiptHash,
      initReceiptHashBoundDataRoot: initialized.handle.initReceipt.dataRootHash,
      dataRootHash: hashPath(initialized.handle.resolver.dataRoot),
    };
    initialized.runtime.close();
    writeJson(path.join(control, 'process-a.json'), {
      ...result,
      databaseBytesHash: hashFile(databasePath),
    });
    return;
  }

  const processAResult = readJson(path.join(control, 'process-a.json'));
  const rehydrated = await api.rehydratePrivateCorpusRevisionV1(
    baseResolver,
    processAResult.initReceipt
  );
  const repositories = createAlembicRepositories(rehydrated.runtime.connection);
  const durableSession = await repositories.sessionRepository.findById('durable-session');
  const databasePath = rehydrated.handle.resolver.databasePath;
  const result = {
    pid: process.pid,
    publicApi: {
      rehydrate: typeof api.rehydratePrivateCorpusRevisionV1 === 'function',
      repositoryFactory: typeof createAlembicRepositories === 'function',
    },
    dataRootHash: hashPath(rehydrated.handle.resolver.dataRoot),
    durableSession,
  };
  rehydrated.runtime.close();
  writeJson(path.join(control, 'process-b.json'), {
    ...result,
    databaseBytesHash: hashFile(databasePath),
  });
}

function createBaseResolver(shared, root) {
  const folderId = 'folder-private-corpus';
  const projectScope = shared.createProjectDescriptor({
    controlRoot: path.dirname(root),
    dataRoot: root,
    projectId: 'project-private-corpus',
    projectScopeId: 'scope-private-corpus',
    currentFolderId: folderId,
    folders: [{ id: folderId, path: root }],
  });
  return new shared.WorkspaceResolver({
    projectRoot: root,
    projectScope,
    currentFolderId: folderId,
  });
}

function runProcess(workerMode, workspace, control) {
  const result = spawnSync(process.execPath, [scriptPath, workerMode, workspace, control], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, ALEMBIC_QUIET: '1' },
  });
  if (result.status !== 0) {
    throw new Error(
      `PRIVATE_REVISION_PROBE_PROCESS_FAILED:${workerMode}\n${result.stdout}\n${result.stderr}`
    );
  }
  return result;
}

function writeJson(target, value) {
  fs.writeFileSync(target, `${canonicalJsonStringify(value)}\n`, { mode: 0o600 });
}

function readJson(target) {
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}

function hashFile(target) {
  return `sha256:${createHash('sha256').update(fs.readFileSync(target)).digest('hex')}`;
}

function hashPath(target) {
  return `sha256:${createHash('sha256').update(path.resolve(target)).digest('hex')}`;
}

function hashCanonicalJson(value) {
  return `sha256:${createHash('sha256').update(canonicalJsonStringify(value)).digest('hex')}`;
}

function canonicalJsonStringify(value) {
  return JSON.stringify(toCanonicalJson(value));
}

function toCanonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON does not accept non-finite numbers.');
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toCanonicalJson(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, toCanonicalJson(value[key])])
    );
  }
  throw new TypeError(`Canonical JSON does not accept values of type ${typeof value}.`);
}
