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
  /**
   * Generic-only mode (RIC-2a-2): when true, return Guard rules ONLY from packs
   * with no framework conditions, ignoring `language`/`frameworks` (the resolver
   * is not used). Mirrors the Plugin guard handler, which defers
   * framework-conditioned packs (e.g. go-grpc) to a later precise resolve so
   * non-matching projects do not get false-positive findings.
   */
  frameworkAgnostic?: boolean;
}

/**
 * Collect the Guard rules contributed by enhancement packs.
 *
 * - No options → all registered packs' Guard rules.
 * - `frameworkAgnostic: true` → only packs with no framework conditions
 *   (generic-only; takes precedence over the resolver path).
 * - `language` (+ optional `frameworks`) → only packs matched by the registry
 *   resolver (framework/language aware).
 *
 * Returns an empty array when the enhancement registry has not been initialized.
 */
export function resolveEnhancementGuardRules(
  options: ResolveEnhancementGuardRulesOptions = {}
): EnhancementGuardRule[] {
  const registry = getEnhancementRegistry();
  let packs: EnhancementPack[];
  if (options.frameworkAgnostic) {
    // Generic-only: packs without framework conditions — semantics identical to
    // the Plugin guard handler's all().filter((p) => !p.conditions?.frameworks?.length).
    packs = registry.all().filter((pack) => !pack.conditions?.frameworks?.length);
  } else if (options.language) {
    packs = registry.resolve(options.language, options.frameworks ?? []);
  } else {
    packs = registry.all();
  }
  return packs.flatMap((pack) => pack.getGuardRules());
}
