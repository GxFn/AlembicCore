/**
 * IC1 (Train A) — wire-type manifest drift gate.
 *
 * config/wire-type-manifest.json is the script-readable contract the
 * Train B generator reads to emit the Dashboard types artifact. Every
 * runtime-verifiable member list must match the compiled Core authority;
 * type-only unions are verified against their source text.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALEMBIC_JOB_KINDS } from '../src/daemon/RuntimeContracts.js';
import { CANDIDATE_STATES, Lifecycle } from '../src/domain/knowledge/Lifecycle.js';
import { CORE_FAILURE_TAXONOMY } from '../src/shared/FailureTaxonomy.js';

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../config/wire-type-manifest.json', import.meta.url)), 'utf8')
);

function sourceOf(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), 'utf8');
}

describe('Wire-type manifest (config/wire-type-manifest.json)', () => {
  test('candidate states match the compiled CANDIDATE_STATES authority', () => {
    expect(manifest.authorities.candidateStates.members).toEqual(CANDIDATE_STATES);
    // The locator ruling is recorded (P0 OPEN item closed by this manifest).
    expect(manifest.authorities.candidateStates.locatorRuling).toContain('CLOSED');
  });

  test('knowledge lifecycle members match the compiled Lifecycle authority', () => {
    expect(manifest.authorities.knowledgeLifecycle.members).toEqual(Object.values(Lifecycle));
    // The wire union in types/KnowledgeWire.ts carries the same members.
    const wireSource = sourceOf('src/types/KnowledgeWire.ts');
    for (const member of manifest.authorities.knowledgeLifecycle.members) {
      expect(wireSource).toContain(`'${member}'`);
    }
  });

  test('job kinds match the compiled ALEMBIC_JOB_KINDS authority', () => {
    expect(manifest.authorities.jobKinds.members).toEqual([...ALEMBIC_JOB_KINDS]);
  });

  test('failure-kind authority defers to the IC4 error registry and stays in sync', () => {
    const registry = JSON.parse(sourceOf('config/error-registry.json'));
    expect(registry.failureKinds).toEqual(CORE_FAILURE_TAXONOMY.map((entry) => entry.kind));
    expect(manifest.authorities.failureKinds.registry).toBe('config/error-registry.json');
  });

  test('proposal status members match the ProposalRepository source union', () => {
    const source = sourceOf('src/repository/evolution/ProposalRepository.ts');
    const match = source.match(/export type ProposalStatus = ([^;]+);/);
    expect(match).toBeTruthy();
    const sourceMembers = [...match![1].matchAll(/'([a-z-]+)'/g)].map((token) => token[1]);
    expect(manifest.authorities.proposalStatus.members).toEqual(sourceMembers);
  });

  test('every authority names its module, specifier, and the module exists', () => {
    for (const [key, authority] of Object.entries(
      manifest.authorities as Record<string, { module: string; specifier: string }>
    )) {
      expect(authority.specifier, key).toMatch(/^@alembic\/core/);
      expect(() => sourceOf(authority.module), `${key}: ${authority.module}`).not.toThrow();
    }
  });
});
