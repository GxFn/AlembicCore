import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertSemanticDispositionReviewDurableAttestationV3,
  type SemanticDispositionReviewDurableAttestationV3,
  type SemanticDispositionReviewTrustPolicyV3,
} from '../src/production.js';

const fixturePath = process.env.ALEMBIC_DURABLE_ATTESTATION_FIXTURE;

describe.skipIf(!fixturePath)('durable semantic disposition-review fresh-process verifier', () => {
  it('rehydrates and verifies a serialized Agent attestation without producer module state', () => {
    const fixture = JSON.parse(readFileSync(fixturePath!, 'utf8')) as {
      readonly attestation: SemanticDispositionReviewDurableAttestationV3;
      readonly expectedTrustPolicy: SemanticDispositionReviewTrustPolicyV3;
    };

    expect(() => assertSemanticDispositionReviewDurableAttestationV3(fixture)).not.toThrow();
  });
});
