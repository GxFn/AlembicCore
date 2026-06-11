/**
 * CO4 E2 — service/panorama floor suite.
 *
 * Real-behavior unit tests for profileTechStack (classification, hotspot
 * threshold, ordering) and CouplingAnalyzer (Tarjan cycle detection with
 * severity rules, fan-in/out metrics, external-dependency profiling) using
 * the shared panorama mock repositories.
 */

import { CouplingAnalyzer } from '../src/service/panorama/CouplingAnalyzer.js';
import { profileTechStack } from '../src/service/panorama/TechStackProfiler.js';
import { createMockRepos, type MockEdge } from './helpers/panorama-mocks.js';

const PROJECT = '/test';

function makeAnalyzer(edges: MockEdge[]) {
  const repos = createMockRepos({ edges });
  return new CouplingAnalyzer(repos.edgeRepo, repos.entityRepo, PROJECT);
}

function moduleEdge(from: string, to: string, relation = 'depends_on'): MockEdge {
  return { from_id: from, from_type: 'module', to_id: to, to_type: 'module', relation };
}

describe('profileTechStack', () => {
  test('empty input yields an empty profile', () => {
    expect(profileTechStack([])).toEqual({ categories: [], hotspots: [], totalExternalDeps: 0 });
  });

  test('known libraries are classified into their catalog categories', () => {
    const profile = profileTechStack([
      { name: 'react', fanIn: 1, dependedBy: ['UI'] },
      { name: 'WeirdInternalLibXyz', fanIn: 1, dependedBy: ['Misc'] },
    ]);
    const categoryOf = (dep: string) =>
      profile.categories.find((category) => category.deps.some((d) => d.name === dep))?.name;
    expect(categoryOf('react')).toBeDefined();
    expect(categoryOf('react')).not.toBe('Other');
    expect(categoryOf('WeirdInternalLibXyz')).toBe('Other');
    expect(profile.totalExternalDeps).toBe(2);
  });

  test('hotspots include only deps with fanIn >= 3', () => {
    const profile = profileTechStack([
      { name: 'react', fanIn: 5, dependedBy: ['A', 'B', 'C', 'D', 'E'] },
      { name: 'axios', fanIn: 3, dependedBy: ['A', 'B', 'C'] },
      { name: 'lodash', fanIn: 2, dependedBy: ['A', 'B'] },
    ]);
    expect(profile.hotspots.map((h) => h.name)).toEqual(['react', 'axios']);
  });

  test('deps inside a category are ordered by fanIn descending', () => {
    const profile = profileTechStack([
      { name: 'vue', fanIn: 1, dependedBy: ['A'] },
      { name: 'react', fanIn: 4, dependedBy: ['A', 'B', 'C', 'D'] },
    ]);
    const uiCategory = profile.categories.find((category) =>
      category.deps.some((d) => d.name === 'react')
    );
    expect(uiCategory).toBeDefined();
    const fanIns = uiCategory!.deps.map((d) => d.fanIn);
    expect(fanIns).toEqual([...fanIns].sort((a, b) => b - a));
  });
});

describe('CouplingAnalyzer', () => {
  test('computes fan-in/fan-out metrics from module dependency edges', async () => {
    const analyzer = makeAnalyzer([
      moduleEdge('App', 'Service'),
      moduleEdge('App', 'Core'),
      moduleEdge('Service', 'Core'),
    ]);
    const result = await analyzer.analyze(
      new Map([
        ['App', []],
        ['Service', []],
        ['Core', []],
      ])
    );

    expect(result.metrics.get('App')).toEqual({ fanIn: 0, fanOut: 2 });
    expect(result.metrics.get('Service')).toEqual({ fanIn: 1, fanOut: 1 });
    expect(result.metrics.get('Core')).toEqual({ fanIn: 2, fanOut: 0 });
    expect(result.cycles).toEqual([]);
  });

  test('detects a small cycle as warning severity', async () => {
    const analyzer = makeAnalyzer([
      moduleEdge('A', 'B'),
      moduleEdge('B', 'A'),
      moduleEdge('B', 'C'),
    ]);
    const result = await analyzer.analyze(
      new Map([
        ['A', []],
        ['B', []],
        ['C', []],
      ])
    );

    expect(result.cycles).toHaveLength(1);
    expect([...result.cycles[0].cycle].sort()).toEqual(['A', 'B']);
    expect(result.cycles[0].severity).toBe('warning');
  });

  test('cycles longer than three modules escalate to error severity', async () => {
    const analyzer = makeAnalyzer([
      moduleEdge('A', 'B'),
      moduleEdge('B', 'C'),
      moduleEdge('C', 'D'),
      moduleEdge('D', 'A'),
    ]);
    const result = await analyzer.analyze(
      new Map([
        ['A', []],
        ['B', []],
        ['C', []],
        ['D', []],
      ])
    );

    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0].cycle).toHaveLength(4);
    expect(result.cycles[0].severity).toBe('error');
  });

  test('profiles external dependencies with fan-in and dependents', async () => {
    const analyzer = makeAnalyzer([
      moduleEdge('App', 'Alamofire'),
      moduleEdge('Service', 'Alamofire'),
      moduleEdge('App', 'Core'),
    ]);
    const result = await analyzer.analyze(
      new Map([
        ['App', []],
        ['Service', []],
        ['Core', []],
      ]),
      new Set(['Alamofire'])
    );

    expect(result.externalDeps).toHaveLength(1);
    expect(result.externalDeps[0].name).toBe('Alamofire');
    expect(result.externalDeps[0].fanIn).toBe(2);
    expect([...result.externalDeps[0].dependedBy].sort()).toEqual(['App', 'Service']);
  });
});
