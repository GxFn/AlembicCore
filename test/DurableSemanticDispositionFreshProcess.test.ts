import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertSemanticDispositionReviewDurableAttestationV3,
  assertSemanticDispositionReviewDurableAttestationV4,
  consumeMainSemanticDispositionReviewDurableAttestationV4,
  type SemanticDispositionReviewDurableAttestationV3,
  type SemanticDispositionReviewDurableAttestationV4,
  type SemanticDispositionReviewRequestV1,
  type SemanticDispositionReviewTrustPolicyV3,
} from '../src/production.js';

const fixturePath = process.env.ALEMBIC_DURABLE_ATTESTATION_FIXTURE;

describe.skipIf(!fixturePath)('durable semantic disposition-review fresh-process verifier', () => {
  it('rehydrates and verifies a serialized Agent attestation without producer module state', () => {
    const fixture = JSON.parse(readFileSync(fixturePath!, 'utf8')) as {
      readonly attestation:
        | SemanticDispositionReviewDurableAttestationV3
        | SemanticDispositionReviewDurableAttestationV4;
      readonly expectedSemanticRequest?: SemanticDispositionReviewRequestV1;
      readonly expectedTrustPolicy: SemanticDispositionReviewTrustPolicyV3;
    };

    if (fixture.attestation.schemaVersion === 3) {
      expect(() =>
        assertSemanticDispositionReviewDurableAttestationV3({
          attestation: fixture.attestation,
          expectedTrustPolicy: fixture.expectedTrustPolicy,
        })
      ).not.toThrow();
      return;
    }
    if (!fixture.expectedSemanticRequest) {
      throw new Error('V4 fixture requires expectedSemanticRequest');
    }
    expect(() =>
      assertSemanticDispositionReviewDurableAttestationV4({
        attestation: fixture.attestation,
        expectedTrustPolicy: fixture.expectedTrustPolicy,
      })
    ).not.toThrow();
    const review = consumeMainSemanticDispositionReviewDurableAttestationV4({
      attestation: fixture.attestation,
      expectedSemanticRequest: fixture.expectedSemanticRequest,
      expectedTrustPolicy: fixture.expectedTrustPolicy,
    });
    expect(review.executionReceiptHashes).toHaveLength(2);
  });
});
