import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetDiscovererRegistry } from '../src/core/discovery/index.js';
import {
  type AnchorRangeContext,
  type FileFlowContext,
  type FileSymbolContext,
  type ModuleContext,
  type ModuleLayerContext,
  PROJECT_CONTEXT_REQUEST_KIND_VALUES,
  type ProjectContextRef,
  type ProjectContextRequestKind,
  type ProjectContextUnavailableData,
  type ProjectMap,
  type RepoContext,
  type SourceSliceContext,
  type SpaceContext,
} from '../src/domain/project-context/index.js';
import { ProjectContext } from '../src/project-context.js';

const FEATURE_MODULE_SEED = {
  moduleName: 'feature',
  modulePath: 'App/src/feature',
  ownedFiles: [
    'App/src/feature/api/index.ts',
    'App/src/feature/domain/model.ts',
    'App/src/feature/service/run.ts',
  ],
};

const SHARED_MODULE_SEED = {
  moduleName: 'shared',
  modulePath: 'App/src/shared',
  ownedFiles: ['App/src/shared/format.ts'],
};

const MODULE_SEEDS = [FEATURE_MODULE_SEED, SHARED_MODULE_SEED] as const;

type ProjectContextExecutionEnvelope = Awaited<ReturnType<typeof ProjectContext.execute>>;

describe('ProjectContext PCQ-9 end-to-end validation', () => {
  beforeEach(() => {
    resetDiscovererRegistry();
  });

  afterEach(() => {
    resetDiscovererRegistry();
  });

  it('connects project-space top-down refs without hidden broad scan or command execution', async () => {
    await withFixture(createProjectSpaceFixture(), async (projectRoot) => {
      const space = await ProjectContext.execute({
        kind: 'space',
        payload: { sourceRefs: ['App/src/feature/service/run.ts'] },
        scope: {
          activeFile: 'App/src/feature/service/run.ts',
          projectRoot,
        },
      });
      const spaceData = space.data as SpaceContext;
      const appRepoRef = expectRef(
        spaceData.nextRefs.find((ref) => ref.kind === 'repo' && ref.scope.repoId === 'repo-app'),
        'space repo ref'
      );

      expect(space.errors).toBeUndefined();
      expect(spaceData.activeRepo?.id).toBe(appRepoRef.id);
      expect(spaceData.projectTree?.roots.map((root) => root.path)).toContain(
        'App/src/feature/service/run.ts'
      );

      const repo = await ProjectContext.execute({
        kind: 'repo',
        payload: {
          moduleSeeds: MODULE_SEEDS,
          ref: appRepoRef,
        },
        scope: { projectRoot },
      });
      const repoData = repo.data as RepoContext;

      expect(repo.errors).toBeUndefined();
      expect(repoData.repo).toMatchObject({
        id: 'repo-app',
        name: 'App',
        root: 'App',
      });
      expect(repoData.commands.map((command) => command.name)).toEqual(['build', 'test']);
      expect(repoData.mapSummary).toMatchObject({
        dependencyEdgeCount: 1,
        moduleCount: 2,
      });
      expect(repoData.nextRefs.some((ref) => ref.kind === 'map')).toBe(true);

      const map = await ProjectContext.execute({
        kind: 'map',
        payload: {
          moduleSeeds: MODULE_SEEDS,
          ref: repoData.mapRef,
          repoName: repoData.repo.name,
        },
        scope: {
          projectRoot,
          repoId: repoData.repo.id,
          sourceFolder: repoData.repo.root,
        },
      });
      const mapData = map.data as ProjectMap;
      const featureModuleRef = expectRef(
        mapData.modules.find((module) => module.name === 'feature')?.ref,
        'map feature module ref'
      );

      expect(map.errors).toBeUndefined();
      expect(mapData.nextRefs.some((ref) => ref.kind === 'module')).toBe(true);
      expect(mapData.nextRefs.some((ref) => ref.kind === 'module-layer')).toBe(true);
      expect(mapData.nextRefs.some((ref) => ref.kind === 'file-flow')).toBe(true);
      expect(mapData.nextRefs.some((ref) => ref.kind === 'relation-site')).toBe(true);
      expect(mapData.nextRefs.some((ref) => ref.kind === 'source-slice')).toBe(true);

      const module = await ProjectContext.execute({
        kind: 'module',
        payload: { ref: featureModuleRef },
        scope: {
          projectRoot,
          repoId: repoData.repo.id,
          sourceFolder: repoData.repo.root,
        },
      });
      const moduleData = module.data as ModuleContext;
      const moduleLayerRef = expectRef(
        moduleData.nextRefs.find((ref) => ref.kind === 'module-layer'),
        'module layer ref'
      );

      expect(module.errors).toBeUndefined();
      expect(moduleData.module.name).toBe('feature');
      expect(moduleData.ownedFiles.map((file) => file.filePath)).toEqual(
        FEATURE_MODULE_SEED.ownedFiles
      );
      expect(moduleData.nextRefs.some((ref) => ref.kind === 'file-symbol')).toBe(true);
      expect(moduleData.nextRefs.some((ref) => ref.kind === 'relation-site')).toBe(true);

      const moduleLayers = await ProjectContext.execute({
        kind: 'module-layers',
        payload: { ref: featureModuleRef },
        scope: {
          projectRoot,
          repoId: repoData.repo.id,
          sourceFolder: repoData.repo.root,
        },
      });
      const moduleLayersData = moduleLayers.data as ModuleLayerContext;
      const boundaryRelationRef = expectRef(
        moduleLayersData.boundaryCrossings.find(
          (relation) => relation.to?.filePath === 'App/src/shared/format.ts'
        )?.ref,
        'module-layers boundary relation ref'
      );

      expect(moduleLayers.errors).toBeUndefined();
      expect(moduleLayersData.layers.map((layer) => layer.fileGroups)).toEqual([
        ['domain'],
        ['service'],
        ['api'],
      ]);
      expect(moduleLayersData.nextRefs).toContainEqual(
        expect.objectContaining({ id: moduleLayerRef.id })
      );

      const fileFlow = await ProjectContext.execute({
        kind: 'file-flow',
        payload: { filePath: 'App/src/feature/service/run.ts' },
        scope: {
          projectRoot,
          repoId: repoData.repo.id,
          sourceFolder: repoData.repo.root,
        },
      });
      const fileFlowData = fileFlow.data as FileFlowContext;
      const importRelationRef = expectRef(
        fileFlowData.imports.find(
          (relation) => relation.to?.filePath === 'App/src/shared/format.ts'
        )?.ref,
        'file-flow import relation ref'
      );

      expect(fileFlow.errors).toBeUndefined();
      expect(fileFlowData.exports.map((symbol) => symbol.qualifiedName ?? symbol.name)).toEqual([
        'FeatureService',
      ]);
      expect(fileFlowData.nextRefs.some((ref) => ref.kind === 'relation-site')).toBe(true);

      const fileSymbols = await ProjectContext.execute({
        kind: 'file-symbols',
        payload: { filePath: fileFlowData.file.filePath },
        scope: {
          projectRoot,
          repoId: repoData.repo.id,
          sourceFolder: repoData.repo.root,
        },
      });
      const fileSymbolsData = fileSymbols.data as FileSymbolContext;
      const runSymbol = fileSymbolsData.symbols.find(
        (symbol) => symbol.qualifiedName === 'FeatureService.run'
      );
      const runSourceSliceRef = expectRef(
        fileSymbolsData.nextRefs.find((ref) => ref.id === runSymbol?.ref?.parentRef),
        'file-symbol source-slice ref'
      );

      expect(fileSymbols.errors).toBeUndefined();
      expect(runSymbol?.ref?.kind).toBe('file-symbol');
      expect(fileSymbolsData.nextRefs.every((ref) => ref.kind === 'source-slice')).toBe(true);

      const sourceSlice = await ProjectContext.execute({
        kind: 'source-slice',
        payload: { includeText: true, ref: runSourceSliceRef },
        scope: {
          projectRoot,
          repoId: repoData.repo.id,
          sourceFolder: repoData.repo.root,
        },
      });
      const sourceSliceData = sourceSlice.data as SourceSliceContext;

      expect(sourceSlice.errors).toBeUndefined();
      expect(sourceSliceData.file.filePath).toBe('App/src/feature/service/run.ts');
      expect(sourceSliceData.text).toContain('run(input: FeatureInput): string');

      const refChain = {
        fileFlowToFileSymbols: fileFlowData.file.ref?.id,
        fileSymbolsToSourceSlice: runSourceSliceRef.id,
        mapToModule: featureModuleRef.id,
        moduleLayersToFileFlow: boundaryRelationRef.id,
        moduleToModuleLayers: moduleLayerRef.id,
        repoToMap: repoData.mapRef?.id,
        spaceToRepo: appRepoRef.id,
      };

      expect(Object.values(refChain).every((value) => typeof value === 'string')).toBe(true);
      expect(importRelationRef.id).toBe(boundaryRelationRef.id);
      expect(await pathExists(path.join(projectRoot, 'forbidden-build-ran'))).toBe(false);
      expect(await pathExists(path.join(projectRoot, 'forbidden-test-ran'))).toBe(false);
      expect(await pathExists(path.join(projectRoot, 'App/forbidden-build-ran'))).toBe(false);
      expect(await pathExists(path.join(projectRoot, 'App/forbidden-test-ran'))).toBe(false);
      expect(
        JSON.stringify([space, repo, map, module, moduleLayers, fileFlow, fileSymbols])
      ).not.toMatch(/HiddenProject|secretProject|MCP|adapter|TaskPackage|DirectThreadDelivery/i);
    });
  });

  it('keeps every default request kind bound to a factual provider', async () => {
    await withFixture(createProjectSpaceFixture(), async (projectRoot) => {
      const coverage = new Map<ProjectContextRequestKind, ProjectContextExecutionEnvelope>();
      const remember = (
        kind: ProjectContextRequestKind,
        envelope: ProjectContextExecutionEnvelope
      ) => {
        expect(envelope.queryLevel).toBe(kind);
        expect(envelope.errors).toBeUndefined();
        expect(isUnavailableData(envelope.data)).toBe(false);
        expect(envelope.refs.length).toBeGreaterThan(0);
        expect(new Set(envelope.refs.map((ref) => ref.id)).size).toBe(envelope.refs.length);
        coverage.set(kind, envelope);
      };

      const space = await ProjectContext.execute({
        kind: 'space',
        payload: { sourceRefs: ['App/src/feature/service/run.ts'] },
        project: { projectRoot, source: 'pcu3-provider-coverage' },
        scope: {
          activeFile: 'App/src/feature/service/run.ts',
        },
      });
      remember('space', space);
      const spaceData = space.data as SpaceContext;
      const appRepoRef = expectRef(
        spaceData.nextRefs.find((ref) => ref.kind === 'repo' && ref.scope.repoId === 'repo-app'),
        'pcu3 space repo ref'
      );

      const repo = await ProjectContext.execute({
        kind: 'repo',
        payload: { moduleSeeds: MODULE_SEEDS, ref: appRepoRef },
        project: { projectRoot, source: 'pcu3-provider-coverage' },
        scope: {},
      });
      remember('repo', repo);
      const repoData = repo.data as RepoContext;

      const map = await ProjectContext.execute({
        kind: 'map',
        payload: {
          moduleSeeds: MODULE_SEEDS,
          ref: repoData.mapRef,
          repoName: repoData.repo.name,
        },
        project: { projectRoot, source: 'pcu3-provider-coverage' },
        scope: {
          repoId: repoData.repo.id,
          sourceFolder: repoData.repo.root,
        },
      });
      remember('map', map);
      const mapData = map.data as ProjectMap;
      const featureModuleRef = expectRef(
        mapData.modules.find((module) => module.name === 'feature')?.ref,
        'pcu3 feature module ref'
      );

      const module = await ProjectContext.execute({
        kind: 'module',
        payload: { ref: featureModuleRef },
        project: { projectRoot, source: 'pcu3-provider-coverage' },
        scope: {
          repoId: repoData.repo.id,
          sourceFolder: repoData.repo.root,
        },
      });
      remember('module', module);

      const moduleLayers = await ProjectContext.execute({
        kind: 'module-layers',
        payload: { ref: featureModuleRef },
        project: { projectRoot, source: 'pcu3-provider-coverage' },
        scope: {
          repoId: repoData.repo.id,
          sourceFolder: repoData.repo.root,
        },
      });
      remember('module-layers', moduleLayers);

      const fileFlow = await ProjectContext.execute({
        kind: 'file-flow',
        payload: { filePath: 'App/src/feature/service/run.ts' },
        project: { projectRoot, source: 'pcu3-provider-coverage' },
        scope: {
          repoId: repoData.repo.id,
          sourceFolder: repoData.repo.root,
        },
      });
      remember('file-flow', fileFlow);
      const fileFlowData = fileFlow.data as FileFlowContext;

      const fileSymbols = await ProjectContext.execute({
        kind: 'file-symbols',
        payload: { filePath: fileFlowData.file.filePath },
        project: { projectRoot, source: 'pcu3-provider-coverage' },
        scope: {
          repoId: repoData.repo.id,
          sourceFolder: repoData.repo.root,
        },
      });
      remember('file-symbols', fileSymbols);
      const fileSymbolsData = fileSymbols.data as FileSymbolContext;
      const runSymbolRef = expectRef(
        fileSymbolsData.nextRefs.find((ref) => ref.scope.range?.startLine === 6),
        'pcu3 run source-slice ref'
      );

      const sourceSlice = await ProjectContext.execute({
        kind: 'source-slice',
        payload: { includeText: true, ref: runSymbolRef },
        project: { projectRoot, source: 'pcu3-provider-coverage' },
        scope: {
          repoId: repoData.repo.id,
          sourceFolder: repoData.repo.root,
        },
      });
      remember('source-slice', sourceSlice);

      const anchorRange = await ProjectContext.execute({
        kind: 'anchor-range',
        payload: {
          filePath: 'App/src/feature/service/run.ts',
          line: 8,
          radius: { afterLines: 0, beforeLines: 0, relationHops: 1 },
        },
        project: { projectRoot, source: 'pcu3-provider-coverage' },
        scope: {
          repoId: repoData.repo.id,
          sourceFolder: repoData.repo.root,
        },
      });
      remember('anchor-range', anchorRange);

      expect([...coverage.keys()].sort()).toEqual([...PROJECT_CONTEXT_REQUEST_KIND_VALUES].sort());
      expect(JSON.stringify([...coverage.values()].map((envelope) => envelope.data))).not.toContain(
        'declared by PCQ-0'
      );
    });
  });

  it('rolls source-slice facts back up through file, module, map, repo, and space queries', async () => {
    await withFixture(createProjectSpaceFixture(), async (projectRoot) => {
      const sourceSlice = await ProjectContext.execute({
        kind: 'source-slice',
        payload: {
          filePath: 'App/src/feature/service/run.ts',
          includeText: true,
          range: { endLine: 8, startLine: 6 },
        },
        scope: { projectRoot, repoId: 'repo-app', sourceFolder: 'App' },
      });
      const sourceSliceData = sourceSlice.data as SourceSliceContext;

      expect(sourceSlice.errors).toBeUndefined();
      expect(sourceSliceData.text).toContain('const candidate = input.name || this.fallbackName;');

      const fileSymbols = await ProjectContext.execute({
        kind: 'file-symbols',
        payload: { ref: sourceSliceData.file.ref },
        scope: { projectRoot, repoId: 'repo-app', sourceFolder: 'App' },
      });
      const fileSymbolsData = fileSymbols.data as FileSymbolContext;

      expect(fileSymbols.errors).toBeUndefined();
      expect(
        fileSymbolsData.symbols.map((symbol) => symbol.qualifiedName ?? symbol.name)
      ).toContain('FeatureService.run');

      const fileFlow = await ProjectContext.execute({
        kind: 'file-flow',
        payload: { ref: fileSymbolsData.file.ref },
        scope: { projectRoot, repoId: 'repo-app', sourceFolder: 'App' },
      });
      const fileFlowData = fileFlow.data as FileFlowContext;

      expect(fileFlow.errors).toBeUndefined();
      expect(fileFlowData.imports.map((relation) => relation.to?.filePath)).toContain(
        'App/src/shared/format.ts'
      );

      const reverseModuleSeed = expectModuleSeedForFile(sourceSliceData.file.filePath);
      const moduleLayers = await ProjectContext.execute({
        kind: 'module-layers',
        payload: reverseModuleSeed,
        scope: { projectRoot, repoId: 'repo-app', sourceFolder: 'App' },
      });
      const moduleLayersData = moduleLayers.data as ModuleLayerContext;

      expect(moduleLayers.errors).toBeUndefined();
      expect(moduleLayersData.module.name).toBe('feature');

      const module = await ProjectContext.execute({
        kind: 'module',
        payload: { ref: moduleLayersData.module.ref },
        scope: { projectRoot, repoId: 'repo-app', sourceFolder: 'App' },
      });
      const moduleData = module.data as ModuleContext;

      expect(module.errors).toBeUndefined();
      expect(moduleData.ownedFiles.map((file) => file.filePath)).toContain(
        sourceSliceData.file.filePath
      );

      const map = await ProjectContext.execute({
        kind: 'map',
        payload: { moduleSeeds: [moduleData.module, SHARED_MODULE_SEED], repoName: 'App' },
        scope: { projectRoot, repoId: 'repo-app', sourceFolder: 'App' },
      });
      const mapData = map.data as ProjectMap;

      expect(map.errors).toBeUndefined();
      expect(mapData.modules.map((item) => item.name)).toEqual(['feature', 'shared']);
      expect(mapData.nextRefs).toContainEqual(
        expect.objectContaining({ id: moduleData.module.ref?.id })
      );

      const space = await ProjectContext.execute({
        kind: 'space',
        payload: { sourceRefs: [sourceSliceData.file.filePath] },
        scope: { activeFile: sourceSliceData.file.filePath, projectRoot },
      });
      const spaceData = space.data as SpaceContext;
      const appRepoRef = expectRef(
        spaceData.nextRefs.find((ref) => ref.kind === 'repo' && ref.scope.repoId === 'repo-app'),
        'reverse space repo ref'
      );

      const repo = await ProjectContext.execute({
        kind: 'repo',
        payload: { modules: mapData.modules, ref: appRepoRef },
        scope: { projectRoot },
      });
      const repoData = repo.data as RepoContext;

      expect(space.errors).toBeUndefined();
      expect(spaceData.activeRepo?.id).toBe(appRepoRef.id);
      expect(repo.errors).toBeUndefined();
      expect(repoData.mapSummary).toMatchObject({
        dependencyEdgeCount: 1,
        moduleCount: 2,
      });
    });
  });

  it('resolves anchor-range from active file, line, symbol, relation, source-slice, and generic refs', async () => {
    await withFixture(createProjectSpaceFixture(), async (projectRoot) => {
      const activeFileAnchor = await ProjectContext.execute({
        kind: 'anchor-range',
        payload: { line: 6, radius: { afterLines: 1, beforeLines: 1, relationHops: 1 } },
        scope: {
          activeFile: 'App/src/feature/service/run.ts',
          projectRoot,
          repoId: 'repo-app',
          sourceFolder: 'App',
        },
      });
      const activeFileData = activeFileAnchor.data as AnchorRangeContext;

      expect(activeFileAnchor.errors).toBeUndefined();
      expect(activeFileData.anchor).toMatchObject({
        filePath: 'App/src/feature/service/run.ts',
        kind: 'file-line',
        line: 6,
      });

      const exactLineAnchor = await ProjectContext.execute({
        kind: 'anchor-range',
        payload: {
          filePath: 'App/src/feature/service/run.ts',
          line: 8,
          radius: { afterLines: 0, beforeLines: 0, relationHops: 0 },
        },
        scope: { projectRoot, repoId: 'repo-app', sourceFolder: 'App' },
      });
      expect((exactLineAnchor.data as AnchorRangeContext).range).toEqual({
        endLine: 8,
        startLine: 8,
      });

      const fileSymbols = await ProjectContext.execute({
        kind: 'file-symbols',
        payload: { filePath: 'App/src/feature/service/run.ts' },
        scope: { projectRoot, repoId: 'repo-app', sourceFolder: 'App' },
      });
      const runSymbolRef = expectRef(
        (fileSymbols.data as FileSymbolContext).symbols.find(
          (symbol) => symbol.qualifiedName === 'FeatureService.run'
        )?.ref,
        'anchor symbol ref'
      );

      const symbolAnchor = await ProjectContext.execute({
        kind: 'anchor-range',
        payload: { ref: runSymbolRef, radius: { afterLines: 0, beforeLines: 0, relationHops: 0 } },
        scope: { projectRoot, repoId: 'repo-app', sourceFolder: 'App' },
      });
      expect((symbolAnchor.data as AnchorRangeContext).anchor.kind).toBe('symbol-ref');
      expect(
        (symbolAnchor.data as AnchorRangeContext).symbols.map((symbol) => symbol.name)
      ).toContain('run');

      const fileFlow = await ProjectContext.execute({
        kind: 'file-flow',
        payload: { filePath: 'App/src/feature/service/run.ts' },
        scope: { projectRoot, repoId: 'repo-app', sourceFolder: 'App' },
      });
      const relationRef = expectRef(
        (fileFlow.data as FileFlowContext).imports.find(
          (relation) => relation.to?.filePath === 'App/src/shared/format.ts'
        )?.ref,
        'anchor relation ref'
      );

      const relationAnchor = await ProjectContext.execute({
        kind: 'anchor-range',
        payload: { ref: relationRef, radius: { afterLines: 0, beforeLines: 0, relationHops: 1 } },
        scope: { projectRoot, repoId: 'repo-app', sourceFolder: 'App' },
      });
      expect((relationAnchor.data as AnchorRangeContext).anchor.kind).toBe('relation-site-ref');
      expect(
        (relationAnchor.data as AnchorRangeContext).relationSites.map(
          (relation) => relation.to?.filePath
        )
      ).toContain('App/src/shared/format.ts');

      const sourceSlice = await ProjectContext.execute({
        kind: 'source-slice',
        payload: {
          filePath: 'App/src/feature/service/run.ts',
          range: { endLine: 10, startLine: 10 },
        },
        scope: { projectRoot, repoId: 'repo-app', sourceFolder: 'App' },
      });
      const sourceSliceRef = expectRef(
        sourceSlice.refs.find((ref) => ref.kind === 'source-slice'),
        'anchor source-slice ref'
      );

      const sourceSliceAnchor = await ProjectContext.execute({
        kind: 'anchor-range',
        payload: {
          ref: sourceSliceRef,
          radius: { afterLines: 0, beforeLines: 0, relationHops: 0 },
        },
        scope: { projectRoot, repoId: 'repo-app', sourceFolder: 'App' },
      });
      expect((sourceSliceAnchor.data as AnchorRangeContext).anchor.kind).toBe('source-slice-ref');

      const genericContextRef: ProjectContextRef = {
        id: `path:repo-app:${encodeURIComponent('App/src/feature/service/run.ts')}:context-range`,
        kind: 'path',
        label: 'generic context range',
        level: 'anchor-range',
        metadata: { source: 'pcq9-generic-context-ref' },
        scope: {
          filePath: 'App/src/feature/service/run.ts',
          projectRoot,
          range: { endLine: 7, startLine: 7 },
          repoId: 'repo-app',
          sourceFolder: 'App',
        },
      };
      const genericAnchor = await ProjectContext.execute({
        kind: 'anchor-range',
        payload: {
          ref: genericContextRef,
          radius: { afterLines: 0, beforeLines: 0, relationHops: 0 },
        },
        scope: { projectRoot, repoId: 'repo-app', sourceFolder: 'App' },
      });
      const genericAnchorData = genericAnchor.data as AnchorRangeContext;

      expect(genericAnchor.errors).toBeUndefined();
      expect(genericAnchorData.anchor.kind).toBe('context-ref');
      expect(genericAnchorData.range).toEqual({ endLine: 7, startLine: 7 });
      expect(
        [
          activeFileData,
          exactLineAnchor.data,
          symbolAnchor.data,
          relationAnchor.data,
          sourceSliceAnchor.data,
          genericAnchorData,
        ].every((item) => (item as AnchorRangeContext).nextRefs.length > 0)
      ).toBe(true);
    });
  });

  it('keeps repo map warnings explicit and resolves NodeNext source import anchors', async () => {
    await withFixture(createNodeNextProjectSpaceFixture(), async (projectRoot) => {
      const space = await ProjectContext.execute({
        kind: 'space',
        payload: { sourceRefs: ['App/src/feature/api/index.ts'] },
        scope: {
          activeFile: 'App/src/feature/api/index.ts',
          projectRoot,
        },
      });
      const spaceData = space.data as SpaceContext;
      const appRepoRef = expectRef(
        spaceData.nextRefs.find((ref) => ref.kind === 'repo' && ref.scope.repoId === 'repo-app'),
        'NodeNext warning repo ref'
      );

      const repoWithoutMapFacts = await ProjectContext.execute({
        kind: 'repo',
        payload: { ref: appRepoRef },
        scope: { projectRoot },
      });
      expect(repoWithoutMapFacts.errors).toContainEqual(
        expect.objectContaining({
          code: 'query-unavailable',
          message:
            'repo map facts are unavailable because payload.moduleSeeds or payload.modules is missing.',
          severity: 'warning',
        })
      );

      const anchor = await ProjectContext.execute({
        kind: 'anchor-range',
        payload: {
          filePath: 'App/src/feature/api/index.ts',
          radius: { afterLines: 0, beforeLines: 0, relationHops: 1 },
          range: { endLine: 2, startLine: 1 },
        },
        scope: {
          projectRoot,
          repoId: 'repo-app',
          sourceFolder: 'App',
        },
      });
      const anchorData = anchor.data as AnchorRangeContext;

      expect(anchor.errors).toBeUndefined();
      expect(anchorData.relationSites.map((relation) => relation.to?.filePath)).toEqual(
        expect.arrayContaining([
          'App/src/feature/domain/model.ts',
          'App/src/feature/service/run.ts',
        ])
      );
    });
  });
});

function expectRef(ref: ProjectContextRef | undefined, label: string): ProjectContextRef {
  if (!ref) {
    throw new Error(`Expected ${label}.`);
  }
  return ref;
}

function expectModuleSeedForFile(filePath: string): (typeof MODULE_SEEDS)[number] {
  const seed = MODULE_SEEDS.find((candidate) => candidate.ownedFiles.includes(filePath));
  if (!seed) {
    throw new Error(`Expected module seed for ${filePath}.`);
  }
  return seed;
}

function isUnavailableData(data: unknown): data is ProjectContextUnavailableData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'available' in data &&
    (data as { available?: unknown }).available === false
  );
}

function createProjectSpaceFixture(): Record<string, string> {
  return {
    'App/package.json': JSON.stringify(
      {
        name: '@fixture/app',
        scripts: {
          build: "node -e \"require('node:fs').writeFileSync('forbidden-build-ran', 'ran')\"",
          test: "node -e \"require('node:fs').writeFileSync('forbidden-test-ran', 'ran')\"",
        },
        type: 'module',
      },
      null,
      2
    ),
    'App/src/feature/api/index.ts': [
      "import { FeatureService } from '../service/run';",
      "import type { FeatureInput } from '../domain/model';",
      '',
      'export function createFeature(input: FeatureInput): FeatureService {',
      '  return new FeatureService(input.name);',
      '}',
    ].join('\n'),
    'App/src/feature/domain/model.ts': [
      'export interface FeatureInput {',
      '  name: string;',
      '}',
    ].join('\n'),
    'App/src/feature/service/run.ts': [
      "import type { FeatureInput } from '../domain/model';",
      "import { formatFeature } from '../../shared/format';",
      '',
      'export class FeatureService {',
      '  constructor(private readonly fallbackName: string) {}',
      '  run(input: FeatureInput): string {',
      '    const candidate = input.name || this.fallbackName;',
      '    return formatFeature(candidate);',
      '  }',
      '}',
    ].join('\n'),
    'App/src/index.ts': [
      "import { createFeature } from './feature/api/index';",
      '',
      'export function boot(): string {',
      '  return createFeature({ name: "pcq9" }).run({ name: "pcq9" });',
      '}',
    ].join('\n'),
    'App/src/shared/format.ts': [
      'export function formatFeature(name: string): string {',
      '  return name.trim();',
      '}',
    ].join('\n'),
    'Docs/package.json': JSON.stringify({ name: '@fixture/docs', type: 'module' }, null, 2),
    'Docs/src/index.ts': 'export const docs = true;\n',
    'HiddenProject/package.json': JSON.stringify({ name: 'secretProject' }, null, 2),
    'HiddenProject/src/secret.ts': 'export const secretProject = true;\n',
    'workspace.config.json': workspaceConfig(['App', 'Docs']),
  };
}

function createNodeNextProjectSpaceFixture(): Record<string, string> {
  return {
    ...createProjectSpaceFixture(),
    'App/src/feature/api/index.ts': [
      "import { FeatureService } from '../service/run.js';",
      "import type { FeatureInput } from '../domain/model.js';",
      '',
      'export function createFeature(input: FeatureInput): FeatureService {',
      '  return new FeatureService(input.name);',
      '}',
    ].join('\n'),
  };
}

function workspaceConfig(names: readonly string[]): string {
  return JSON.stringify(
    {
      repoNames: names,
      repositories: names.map((name) => ({
        name,
        path: name,
        repositoryId: `repo-${name.toLowerCase()}`,
      })),
      workspaceName: 'PCQ9FixtureSpace',
    },
    null,
    2
  );
}

async function withFixture(
  files: Record<string, string>,
  callback: (projectRoot: string) => Promise<void>
): Promise<void> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-context-e2e-'));
  try {
    for (const [filePath, content] of Object.entries(files)) {
      const absolutePath = path.join(projectRoot, filePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf8');
    }
    await callback(projectRoot);
  } finally {
    await fs.rm(projectRoot, { force: true, recursive: true });
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
