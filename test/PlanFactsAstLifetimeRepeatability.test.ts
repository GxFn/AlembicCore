import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Parser, Tree } from 'web-tree-sitter';
import { reloadPlugins } from '../src/core/ast/ensureGrammars.js';
import { collectPlanProjectContext } from '../src/service/plan/facts/collectProjectContext.js';
import { buildCompleteProjectInfoTree } from '../src/service/plan/facts/projectInfoTree.js';
import {
  createProjectDescriptor,
  createProjectScopeRegistryDocument,
  PROJECT_SCOPE_REGISTRY_FILENAME,
} from '../src/shared/ProjectScope.js';

const SOURCE_FACT_COUNT = 2_139;
const EXPORTED_SYMBOL_COUNT = 833;
const LEAK_SENSITIVE_SYMBOL_COUNT = 17;
const fixtureRoots: string[] = [];
let previousAlembicHome: string | undefined;

beforeAll(async () => {
  await reloadPlugins();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (previousAlembicHome === undefined) {
    delete process.env.ALEMBIC_HOME;
  } else {
    process.env.ALEMBIC_HOME = previousAlembicHome;
  }
  for (const fixtureRoot of fixtureRoots.splice(0)) {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
});

describe('planFacts AST lifetime repeatability', () => {
  it('keeps all 833 symbols and exact full-tree bytes across two stable 2,139-file scans', async () => {
    const sourceRoot = createFiveFolderProjectScope();
    let repeatedPass = false;
    let liveTreeCount = 0;
    const deletedTrees = new WeakSet<Tree>();
    const originalParse = Parser.prototype.parse;
    const originalDelete = Tree.prototype.delete;

    vi.spyOn(Parser.prototype, 'parse').mockImplementation(function (input, oldTree, options) {
      if (
        repeatedPass &&
        liveTreeCount > 0 &&
        typeof input === 'string' &&
        input.includes('LEAK_SENSITIVE_SYMBOL')
      ) {
        throw new Error('Aborted(intentional leaked-tree capacity)');
      }
      const tree = originalParse.call(this, input, oldTree, options);
      if (tree) {
        liveTreeCount += 1;
      }
      return tree;
    });
    vi.spyOn(Tree.prototype, 'delete').mockImplementation(function () {
      if (!deletedTrees.has(this)) {
        deletedTrees.add(this);
        liveTreeCount -= 1;
      }
      return originalDelete.call(this);
    });

    const firstAnalysis = await collectPlanProjectContext(sourceRoot, undefined);
    const firstTree = buildCompleteProjectInfoTree(firstAnalysis);
    repeatedPass = true;
    const repeatedAnalysis = await collectPlanProjectContext(sourceRoot, undefined);
    const repeatedTree = buildCompleteProjectInfoTree(repeatedAnalysis);

    const firstSummary = summarize(firstAnalysis, firstTree);
    const repeatedSummary = summarize(repeatedAnalysis, repeatedTree);
    expect(firstSummary.sourceFileFactCount).toBe(SOURCE_FACT_COUNT);
    expect(firstSummary.symbolCount).toBe(EXPORTED_SYMBOL_COUNT);
    expect(firstSummary.parserFailures).toEqual([]);
    expect(repeatedSummary.sourceFileFactCount).toBe(SOURCE_FACT_COUNT);
    expect(repeatedSummary.symbolCount).toBe(EXPORTED_SYMBOL_COUNT);
    expect(repeatedSummary.parserFailures).toEqual([]);
    expect(repeatedSummary.semanticFacts).toStrictEqual(firstSummary.semanticFacts);
    expect(JSON.stringify(repeatedTree)).toBe(JSON.stringify(firstTree));
    expect(liveTreeCount).toBe(0);
  }, 120_000);
});

function createFiveFolderProjectScope(): string {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'plan-facts-repeatability-'));
  fixtureRoots.push(fixtureRoot);
  previousAlembicHome = process.env.ALEMBIC_HOME;
  const sourceRoot = path.join(fixtureRoot, 'source');
  const homeRoot = path.join(fixtureRoot, 'home');
  const memberNames = ['Primary', 'MemberA', 'MemberB', 'MemberC', 'MemberD'];
  for (const memberName of memberNames) {
    mkdirSync(path.join(sourceRoot, memberName, 'src'), { recursive: true });
  }

  writeFileSync(
    path.join(sourceRoot, 'Primary', 'package.json'),
    JSON.stringify({ name: 'plan-facts-primary', version: '1.0.0' })
  );
  for (let fileIndex = 0; fileIndex < 102; fileIndex += 1) {
    const declarations = Array.from(
      { length: 8 },
      (_, symbolIndex) => `export class Stable_${fileIndex}_${symbolIndex} {}`
    ).join('\n');
    writeFileSync(path.join(sourceRoot, 'Primary', 'src', `stable-${fileIndex}.ts`), declarations);
  }
  for (let index = 0; index < LEAK_SENSITIVE_SYMBOL_COUNT; index += 1) {
    writeFileSync(
      path.join(sourceRoot, 'Primary', 'src', `sensitive-${index}.ts`),
      `// LEAK_SENSITIVE_SYMBOL\nexport class Sensitive_${index} {}`
    );
  }

  const primarySourceFiles = 102 + LEAK_SENSITIVE_SYMBOL_COUNT;
  const paddingFileCount = SOURCE_FACT_COUNT - primarySourceFiles - 1;
  const paddingMembers = memberNames.slice(1);
  for (let index = 0; index < paddingFileCount; index += 1) {
    const memberName = paddingMembers[index % paddingMembers.length];
    writeFileSync(
      path.join(sourceRoot, memberName, 'src', `padding-${index}.ts`),
      `const padding_${index} = ${index};`
    );
  }

  process.env.ALEMBIC_HOME = homeRoot;
  const dataRoot = path.join(homeRoot, '.asd', 'workspaces', 'repeatability');
  const scope = createProjectDescriptor({
    controlRoot: sourceRoot,
    dataRoot,
    displayName: 'Core planFacts repeatability',
    folders: memberNames.map((memberName, index) => ({
      displayName: memberName,
      id: `folder-${memberName.toLowerCase()}`,
      path: path.join(sourceRoot, memberName),
      repositoryId: memberName,
      role: index === 0 ? ('primary-source' as const) : ('source' as const),
    })),
    projectId: 'core-plan-facts-repeatability',
    projectScopeId: 'scope-core-plan-facts-repeatability',
  });
  mkdirSync(path.join(homeRoot, '.asd'), { recursive: true });
  writeFileSync(
    path.join(homeRoot, '.asd', PROJECT_SCOPE_REGISTRY_FILENAME),
    JSON.stringify(createProjectScopeRegistryDocument([scope]), null, 2)
  );
  return sourceRoot;
}

function summarize(
  analysis: Awaited<ReturnType<typeof collectPlanProjectContext>>,
  tree: ReturnType<typeof buildCompleteProjectInfoTree>
) {
  return {
    parserFailures: analysis.presenterInput.warnings
      .filter((warning) => warning.message.includes('parser failed for'))
      .map((warning) => warning.message),
    semanticFacts: {
      contextStatus: analysis.contextStatus,
      fileCount: analysis.fileCount,
      moduleCount: analysis.moduleCount,
      modules: tree.children.map((moduleNode) => ({
        dependencies: moduleNode.keyDependencies,
        path: moduleNode.path,
        symbolCount: countKind(moduleNode, 'symbol'),
      })),
      requestKinds: analysis.requestKinds,
    },
    sourceFileFactCount: analysis.sourceFileFacts.length,
    symbolCount: countKind(tree, 'symbol'),
  };
}

function countKind(value: unknown, kind: string): number {
  const node = record(value);
  return (
    (node.kind === kind ? 1 : 0) +
    array(node.children).reduce((sum, child) => sum + countKind(child, kind), 0)
  );
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
