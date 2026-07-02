/**
 * CO4 E2 — weakest workflows path: host-agent submission tracking READ paths.
 *
 * Real-behavior tests for HostAgentSubmissionTracker reads: per-dimension
 * submission retrieval, cross-dimension file evidence and shared-file
 * detection, normalized title/trigger dedup sets, accumulated-evidence
 * exclusion semantics, and stats aggregation.
 */

import { HostAgentSubmissionTracker } from '../src/workflows/surfaces/host-agent/HostAgentSubmissionTracker.js';

function record(
  tracker: HostAgentSubmissionTracker,
  dimId: string,
  recipeId: string,
  args: Record<string, unknown> = {}
) {
  tracker.recordSubmission(
    dimId,
    {
      title: `Pattern ${recipeId}`,
      knowledgeType: 'code-pattern',
      kind: 'pattern',
      category: 'architecture',
      trigger: `@trigger-${recipeId}`,
      coreCode: 'const x = 1;',
      content: { markdown: 'Body '.repeat(60) },
      reasoning: { sources: [`src/${recipeId}.ts:10`], confidence: 0.8 },
      ...args,
    },
    recipeId
  );
}

describe('HostAgentSubmissionTracker read paths', () => {
  test('getSubmissions returns recorded fields for a dimension and [] for unknown ones', () => {
    const tracker = new HostAgentSubmissionTracker();
    record(tracker, 'architecture', 'r1');
    record(tracker, 'architecture', 'r2', {
      reasoning: { sources: ['src/r2.ts:5', 'src/shared.ts:9'], confidence: 0.6 },
    });

    const submissions = tracker.getSubmissions('architecture');
    expect(submissions).toHaveLength(2);
    expect(submissions[0]).toMatchObject({
      recipeId: 'r1',
      title: 'Pattern r1',
      knowledgeType: 'code-pattern',
      kind: 'pattern',
      category: 'architecture',
    });
    expect(submissions[1].sources).toEqual(['src/r2.ts:5', 'src/shared.ts:9']);
    expect(tracker.getSubmissions('unknown-dim')).toEqual([]);
  });

  test('getFileEvidenceMap parses file:line sources and tracks dimensions per file', () => {
    const tracker = new HostAgentSubmissionTracker();
    record(tracker, 'dim1', 'a', { reasoning: { sources: ['src/a.ts:10', 'src/shared.ts:20'] } });
    record(tracker, 'dim2', 'b', { reasoning: { sources: ['src/shared.ts:5', 'src/b.ts:30'] } });

    const evidence = tracker.getFileEvidenceMap();
    expect([...(evidence.get('src/shared.ts') ?? [])].sort()).toEqual(['dim1', 'dim2']);
    expect([...(evidence.get('src/a.ts') ?? [])]).toEqual(['dim1']);
    expect([...(evidence.get('src/b.ts') ?? [])]).toEqual(['dim2']);
  });

  test('getAllSubmittedTitles normalizes case/whitespace and honors excludeDimId', () => {
    const tracker = new HostAgentSubmissionTracker();
    record(tracker, 'dim1', 'a', { title: '  Repository Pattern  ' });
    record(tracker, 'dim2', 'b', { title: 'NETWORK retry policy' });

    const all = tracker.getAllSubmittedTitles();
    expect(all.has('repository pattern')).toBe(true);
    expect(all.has('network retry policy')).toBe(true);

    const withoutDim1 = tracker.getAllSubmittedTitles('dim1');
    expect(withoutDim1.has('repository pattern')).toBe(false);
    expect(withoutDim1.has('network retry policy')).toBe(true);
  });

  test('getAllSubmittedTriggers returns lowercase trigger set across dimensions', () => {
    const tracker = new HostAgentSubmissionTracker();
    record(tracker, 'dim1', 'a', { trigger: '@Repo-Transaction' });
    record(tracker, 'dim2', 'b', { trigger: '@net-retry' });

    const triggers = tracker.getAllSubmittedTriggers();
    expect(triggers.has('@repo-transaction')).toBe(true);
    expect(triggers.has('@net-retry')).toBe(true);
  });

  test('getAccumulatedEvidence excludes the current dimension and reports only shared files', () => {
    const tracker = new HostAgentSubmissionTracker();
    record(tracker, 'dim1', 'a', { reasoning: { sources: ['src/shared.ts:1', 'src/a.ts:2'] } });
    record(tracker, 'dim2', 'b', { reasoning: { sources: ['src/shared.ts:3'] } });
    record(tracker, 'dim3', 'c', { reasoning: { sources: ['src/c.ts:4'] } });

    const evidence = tracker.getAccumulatedEvidence('dim1');
    expect(evidence.completedDimSummaries.map((summary) => summary.dimId).sort()).toEqual([
      'dim2',
      'dim3',
    ]);
    // Only files referenced by more than one dimension count as shared.
    expect(evidence.sharedFiles.map((file) => file.filePath)).toEqual(['src/shared.ts']);
    expect(evidence.sharedFiles[0].dimensions.sort()).toEqual(['dim1', 'dim2']);
    expect(evidence.usedTriggers.length).toBeGreaterThanOrEqual(3);
  });

  test('getStats aggregates dimensions, submissions, unique files and triggers', () => {
    const tracker = new HostAgentSubmissionTracker();
    record(tracker, 'dim1', 'a', { reasoning: { sources: ['src/a.ts:1'] } });
    record(tracker, 'dim1', 'b', { reasoning: { sources: ['src/b.ts:1'] } });
    record(tracker, 'dim2', 'c', { reasoning: { sources: ['src/a.ts:9'] } });

    expect(tracker.getStats()).toMatchObject({
      dimensions: 2,
      totalSubmissions: 3,
      uniqueFiles: 2,
      usedTriggers: 3,
    });
  });
});
