import { describe, expect, it } from 'vitest';

import {
  createHostAgentKnowledgeRescanIntent,
  createInternalKnowledgeRescanIntent,
  DEFAULT_KNOWLEDGE_RESCAN_CONTENT_MAX_LINES,
  DEFAULT_KNOWLEDGE_RESCAN_MAX_FILES,
  MAX_KNOWLEDGE_RESCAN_CONTENT_MAX_LINES,
  MAX_KNOWLEDGE_RESCAN_MAX_FILES,
} from '../src/workflows/knowledge-rescan/index.js';

describe('KnowledgeRescanIntent analysis options', () => {
  it('keeps legacy defaults when rescan args omit analysis limits', () => {
    const intent = createInternalKnowledgeRescanIntent({
      reason: 'manual',
      dimensions: ['architecture'],
    });

    expect(intent.projectAnalysis).toMatchObject({
      maxFiles: DEFAULT_KNOWLEDGE_RESCAN_MAX_FILES,
      contentMaxLines: DEFAULT_KNOWLEDGE_RESCAN_CONTENT_MAX_LINES,
      sourceTag: 'rescan-internal',
    });
  });

  it('preserves explicit non-truncated internal rescan analysis limits', () => {
    const intent = createInternalKnowledgeRescanIntent({
      maxFiles: 2000,
      contentMaxLines: 200,
      reason: 'pscssi-p5',
    });

    expect(intent.projectAnalysis).toMatchObject({
      maxFiles: 2000,
      contentMaxLines: 200,
    });
    expect(intent.reason).toBe('pscssi-p5');
  });

  it('applies the same analysis option contract to host-agent rescan intent', () => {
    const intent = createHostAgentKnowledgeRescanIntent({
      maxFiles: '2000',
      contentMaxLines: '200',
      force: true,
      dimensions: ['quality'],
    });

    expect(intent).toMatchObject({
      executor: 'host-agent',
      analysisMode: 'full',
      cleanupPolicy: 'force-rescan',
      dimensionIds: ['quality'],
      projectAnalysis: {
        maxFiles: 2000,
        contentMaxLines: 200,
        sourceTag: 'rescan-host-agent',
      },
    });
  });

  it('falls back to legacy defaults for invalid analysis limits', () => {
    const intent = createInternalKnowledgeRescanIntent({
      maxFiles: 0,
      contentMaxLines: 'not-a-number',
    });

    expect(intent.projectAnalysis).toMatchObject({
      maxFiles: DEFAULT_KNOWLEDGE_RESCAN_MAX_FILES,
      contentMaxLines: DEFAULT_KNOWLEDGE_RESCAN_CONTENT_MAX_LINES,
    });
  });

  it('clamps oversized analysis limits at the Core contract boundary', () => {
    const intent = createHostAgentKnowledgeRescanIntent({
      maxFiles: 999_999,
      contentMaxLines: 999_999,
    });

    expect(intent.projectAnalysis).toMatchObject({
      maxFiles: MAX_KNOWLEDGE_RESCAN_MAX_FILES,
      contentMaxLines: MAX_KNOWLEDGE_RESCAN_CONTENT_MAX_LINES,
    });
  });
});
