import { describe, expect, it } from 'vitest';

import { getGatewaySourceUserId, normalizeGatewaySource } from '../src/knowledge.js';
import { normalizeProposalSource } from '../src/repositories.js';
import { normalizeFileChangeEventSource } from '../src/types/index.js';

describe('host-neutral source contracts', () => {
  it('normalizes legacy agent and edit sources to host-neutral values', () => {
    expect(normalizeProposalSource('ide-agent')).toBe('host-agent');
    expect(normalizeProposalSource('alembic-agent')).toBe('alembic-agent');
    expect(normalizeGatewaySource('ide-agent')).toBe('host-agent');
    expect(normalizeGatewaySource('alembic-agent')).toBe('alembic-agent');
    expect(getGatewaySourceUserId('alembic-agent')).toBe('alembic-agent');
    expect(normalizeFileChangeEventSource('ide-edit')).toBe('host-edit');
    expect(normalizeFileChangeEventSource(undefined)).toBe('host-edit');
  });
});
