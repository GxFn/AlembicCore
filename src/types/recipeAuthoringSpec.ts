/**
 * RecipeAuthoringSpec — types-layer contracts (§C.11 ports).
 *
 * The canonical RecipeAuthoringSpec module lives in `domain/knowledge/recipe-authoring-spec`
 * and must stay pure (domain imports only `shared` + `types`, zero node:fs / node:path /
 * host-agent-workflows). The two runtime-bound couplings the gates have today —
 * on-disk source-ref reads and bootstrap-session scope — are severed here as injected
 * typed ports so the spec can run the SAME pure predicates while the host injects the I/O.
 *
 * Only pure-data types live here; no runtime code.
 */

/** The four submission paths the spec serves (host cold-start / deep-mining / module-mining + in-process). */
export type RecipeAuthoringSubmitPath =
  | 'host-cold-start'
  | 'host-deep-mining'
  | 'host-module-mining'
  | 'in-process';

/**
 * A single authoring violation — the union of the stage-1 content-quality and stage-2 evidence
 * violation shapes the live gates emit (so `validateAgainst` can return the identical objects).
 */
export interface RecipeAuthoringViolation {
  code: string;
  itemIndex: number;
  message: string;
  nextAction: string;
  /** stage-1 field tag (`content.markdown` | `doClause` | `dontClause`). */
  field?: string;
  /** stage-2 candidate title. */
  title?: string;
  /** stage-2 resolved source path (on SOURCE_REF_* violations). */
  path?: string;
  /** stage-2 raw ref echo. */
  sourceRef?: string;
}

/** Validated on-disk evidence for one source ref (produced by the injected resolver). */
export interface RecipeSourceRefEvidence {
  /** repo-relative, normalized source path. */
  sourcePath: string;
  /** the exact text of the cited line range (fs-read by the host). */
  rangeText: string;
  /** absolute resolved path (host-side). */
  filePath?: string;
  /** cleaned raw ref. */
  raw?: string;
}

/**
 * §C.11 port — resolves a parsed source ref against the filesystem.
 *
 * The domain spec parses the ref shape purely (regex → {sourcePath, startLine, endLine}) and
 * hands it to this host-injected resolver, which owns the node:path normalization + node:fs
 * reads (SOURCE_REF_INVALID / SOURCE_REF_NOT_FOUND / SOURCE_REF_LINE_OUT_OF_RANGE) and yields
 * the validated `{ rangeText }` the pure snippet/floor predicates then operate on. When no
 * resolver is injected the spec skips the fs-bound checks (pure-only run).
 */
export type RecipeSourceRefResolver = (input: {
  projectRoot: string;
  sourcePath: string;
  startLine: number;
  endLine: number;
  sourceRef: string;
  itemIndex: number;
  title: string;
}) => { evidence: RecipeSourceRefEvidence } | { violation: RecipeAuthoringViolation };

/**
 * §C.11 port — bootstrap-session scope check.
 *
 * Owns SESSION_NOT_FOUND / WRONG_SCOPE (projectRoot match + dimension membership). The domain
 * spec calls it when provided; when absent the spec skips the session-bound checks.
 */
export type RecipeSessionScope = (input: {
  projectRoot?: string;
  dimensionId?: string;
  itemIndex: number;
  title: string;
}) => { violation: RecipeAuthoringViolation } | { ok: true };
