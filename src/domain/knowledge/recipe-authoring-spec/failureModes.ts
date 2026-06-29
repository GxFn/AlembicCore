/**
 * failure-modes.ts — SECTION 5.
 *
 * The reject-code → avoidance catalog, COMPUTED from the gate-rules table rather than hand-authored.
 * Each failure mode's avoidance is the same `guidanceText` the gate rule carries, so the "how to
 * avoid this rejection" copy can never drift from "what the gate actually enforces" — they are two
 * reads of one table (the CG-1 guarantee, applied to failures).
 */
import { gateRules } from './gateRules.js';

/** One reject code and how to avoid it, traced back to its owning gate rule. */
export interface FailureMode {
  /** the reject code the gate emits. */
  code: string;
  /** enforcement stage (1 content-quality, 2 evidence, 3 field gate). */
  stage: 1 | 2 | 3;
  /** the gate rule this code belongs to. */
  ruleId: string;
  /** avoidance guidance — the rule's own guidanceText (single source). */
  avoidance: string;
}

/** Every reject code mapped to its avoidance, derived from the shared gateRules() table. */
export function failureModes(): FailureMode[] {
  return gateRules().flatMap((rule) =>
    rule.rejectCodes.map((code) => ({
      code,
      stage: rule.stage,
      ruleId: rule.id,
      avoidance: rule.guidanceText,
    }))
  );
}
