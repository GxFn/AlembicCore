// RIC-2a / R1 — read-only high-level helper on the @alembic/core/guard facade
// that surfaces the Guard rules contributed by enhancement packs. Outer repos
// (Plugin/Alembic guard handlers + HTTP routes) consume Guard rules through this
// method instead of importing @alembic/core/core/enhancement directly — the only
// business use of enhancement is producing Guard rules, which is guard domain.
//
// Additive to the guard surface; does NOT change the D4 decision (guard stays a
// Core export consumed by both execution routes). The enhancement registry is a
// blessed lazy singleton hydrated at bootstrap (initEnhancementRegistry — infra
// wiring, RIC-2a/R3); this helper is sync and returns [] when the registry has
// not been initialized yet (graceful, never throws).

import type { EnhancementPack, GuardRule } from '../../core/enhancement/EnhancementPack.js';
import { getEnhancementRegistry } from '../../core/enhancement/index.js';

/** A Guard rule contributed by an enhancement pack (re-exported via @alembic/core/guard). */
export type EnhancementGuardRule = GuardRule;

export interface ResolveEnhancementGuardRulesOptions {
  /** Primary language; when set, packs are matched via the registry resolver. */
  language?: string;
  /** Detected frameworks used alongside `language` to narrow matching packs. */
  frameworks?: string[];
}

/**
 * Collect the Guard rules contributed by enhancement packs.
 *
 * - No options → all registered packs' Guard rules.
 * - `language` (+ optional `frameworks`) → only packs matched by the registry
 *   resolver (framework/language aware).
 *
 * Returns an empty array when the enhancement registry has not been initialized.
 */
export function resolveEnhancementGuardRules(
  options: ResolveEnhancementGuardRulesOptions = {}
): EnhancementGuardRule[] {
  const registry = getEnhancementRegistry();
  const packs: EnhancementPack[] = options.language
    ? registry.resolve(options.language, options.frameworks ?? [])
    : registry.all();
  return packs.flatMap((pack) => pack.getGuardRules());
}
