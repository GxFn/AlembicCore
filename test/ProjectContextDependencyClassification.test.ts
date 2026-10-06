import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildProjectScopeManifestV1,
  createProjectContextRequestAuditPlansV2,
  NodeProjectContextFoundationHostPorts,
  type ProjectContextFoundationFileDescriptor,
  type ProjectContextInventoryPolicyV1,
} from '../src/projectContextFoundation.js';

/**
 * 相对路径 import 在认证里的归类：目标落在清单策略排除的目录里（dist、node_modules…）不是项目的缺陷，
 * 离开仓库的也不是；仓库内找不到的只是待复核的警告。它们都不再按"名字里含模块名"被判成确认缺陷。
 */

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

async function createTree(files: Record<string, string>): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pc-classify-')));
  temporaryRoots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }
  return root;
}

const POLICY: ProjectContextInventoryPolicyV1 = {
  version: 'classification-fixture',
  includeExtensions: ['.ts'],
  excludeDirectories: ['.git', 'node_modules', 'dist'],
};

/** 清单行带宿主声明的归属，让 shared 与 tools 各成为一个模块种子。 */
function describe_(relativePath: string, owner: string): ProjectContextFoundationFileDescriptor {
  return {
    relativePath,
    language: 'typescript',
    mode: '100644',
    ownerModuleIds: [owner],
    ownersV2: [
      {
        ownerModuleId: owner,
        origin: 'host-declared',
        confidence: 'medium',
        disposition: 'exclusive',
        typedReason: 'fixture-host-declared-owner',
        evidence: [{ kind: 'host-port-declaration' }],
      },
    ],
  };
}

async function runMapRequest(input: {
  files: Record<string, string>;
  owners: Record<string, string>;
  inventoryPolicy?: ProjectContextInventoryPolicyV1;
}) {
  const controlRoot = await createTree(input.files);
  const projectScope = buildProjectScopeManifestV1({
    acceptedScope: {
      projectMode: 'classification-fixture',
      projectIdentity: { projectId: 'classify', scopeId: 'classify' },
      repositories: [{ repoId: 'app', relativeRoot: '.' }],
    },
    controlRoot,
    sourceRoots: [{ repoId: 'app', sourceRoot: controlRoot }],
  });
  const repository = projectScope.repositories[0];
  const ports = new NodeProjectContextFoundationHostPorts(undefined, {
    portableRoots: [{ portableId: 'app', sourceRoot: repository.sourceRoot }],
  });
  const plans = createProjectContextRequestAuditPlansV2({
    repository,
    eligibleFiles: Object.entries(input.owners).map(([relativePath, owner]) =>
      describe_(relativePath, owner)
    ),
    projectScopeManifest: projectScope.manifest,
  });
  const plan = plans.find((candidate) => candidate.kind === 'map');
  if (!plan) {
    throw new Error('map plan missing');
  }
  return ports.executeRequest({
    repository,
    plan,
    ...(input.inventoryPolicy ? { inventoryPolicy: input.inventoryPolicy } : {}),
  });
}

const FILES = {
  'src/shared/format.ts': 'export const format = () => 1;\n',
  'src/tools/build.ts': [
    "import { format } from '../../dist/shared/format.js';",
    "import { gone } from './missing.js';",
    "import { far } from '../../../elsewhere/far.js';",
    'export const run = () => [format(), gone, far];',
    '',
  ].join('\n'),
};
const OWNERS = {
  'src/shared/format.ts': 'module:src/shared',
  'src/tools/build.ts': 'module:src/tools',
};

/** map 对每条认不出归属的依赖给一条观测诊断；file-flow 的"找不到 import 目标"是另一条，不在此列。 */
function dependencyDiagnostic(
  result: Awaited<ReturnType<typeof runMapRequest>>,
  dependencyName: string
) {
  return result.errors.find(
    (error) =>
      error.message === `map external dependency is not owned by module seeds: ${dependencyName}`
  );
}

describe('relative import classification in certified requests', () => {
  it('treats an import into a policy-excluded directory as expected-external, even when a module shares a path segment with it', async () => {
    const result = await runMapRequest({ files: FILES, owners: OWNERS, inventoryPolicy: POLICY });

    expect(dependencyDiagnostic(result, '../../dist/shared/format.js')).toMatchObject({
      classification: 'expected-external',
      typedReason: 'dependency-target-is-excluded-by-inventory-policy',
    });
    expect(result.dependencyResolutions).toContainEqual(
      expect.objectContaining({
        classification: 'expected-external',
        dependencyName: '../../dist/shared/format.js',
        typedReason: 'dependency-target-is-excluded-by-inventory-policy',
      })
    );
    expect(result.terminalStatus).toBe('completed');
  });

  it('keeps a missing in-repository relative import a warning and an import leaving the repository external', async () => {
    const result = await runMapRequest({ files: FILES, owners: OWNERS, inventoryPolicy: POLICY });

    expect(dependencyDiagnostic(result, './missing.js')).toMatchObject({
      classification: 'advisory',
      typedReason: 'relative-import-target-is-missing-in-repository',
    });
    expect(dependencyDiagnostic(result, '../../../elsewhere/far.js')).toMatchObject({
      classification: 'expected-external',
      typedReason: 'dependency-target-is-outside-repository-root',
    });
    // 每条依赖观测都有一条决议，与观测数相同。
    expect(result.dependencyResolutions).toHaveLength(result.dependencyObservationCount!);
    expect(
      result.dependencyResolutions.map((resolution) => resolution.classification)
    ).not.toContain('confirmed-defect');
  });

  it('never turns a relative import into a confirmed defect when no inventory policy is given', async () => {
    const result = await runMapRequest({ files: FILES, owners: OWNERS });

    expect(result.errors.map((error) => error.classification)).not.toContain('confirmed-defect');
    expect(dependencyDiagnostic(result, '../../dist/shared/format.js')).toMatchObject({
      classification: 'advisory',
      typedReason: 'relative-import-target-is-missing-in-repository',
    });
  });
});
