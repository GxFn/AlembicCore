import { describe, expect, it } from 'vitest';

describe('strict-test automatic-selection public replacement', () => {
  it('exports automatic-selection authority and removes the manual-confirmation route', async () => {
    const plans = await import('../src/plans.js');
    const production = await import('../src/production.js');

    for (const surface of [plans, production]) {
      expect(Object.hasOwn(surface, 'createStrictTestAutomaticSelectionReceiptV1')).toBe(true);
      expect(Object.hasOwn(surface, 'assertStrictTestAutomaticSelectionReceiptV1')).toBe(true);
      expect(Object.hasOwn(surface, 'createStrictTestSelectionConfirmationV1')).toBe(false);
      expect(Object.hasOwn(surface, 'assertStrictTestSelectionConfirmationV1')).toBe(false);
    }

    expect(plans.STRICT_TEST_STATE_SEQUENCE_V1).toContain('AUTOMATIC_SELECTION_READY');
    expect(plans.STRICT_TEST_STATE_SEQUENCE_V1).toContain('SELECTION_AUTO_SELECTED');
    expect(plans.STRICT_TEST_STATE_SEQUENCE_V1).not.toContain('AWAITING_CONFIRMATION');
    expect(plans.STRICT_TEST_STATE_SEQUENCE_V1).not.toContain('SELECTION_CONFIRMED');
  });
});
