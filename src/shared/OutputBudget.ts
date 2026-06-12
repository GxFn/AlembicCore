/**
 * OutputBudget — shared per-tool output budgets and overflow honesty (MT2).
 *
 * One mechanism replaces per-handler magic-number slices:
 *  - every tool has a DECLARED budget (bytes of one MCP `result`), set from
 *    the MT1 measured sweep (findings-train-a.md; raw refs in the Train H
 *    state root) — never from estimates;
 *  - enforcement is MEASURED (UTF-8 bytes) and HONEST: an over-budget
 *    payload is truncated with `truncated: true` plus an overflow route
 *    (pagination or artifact-ref) — oversized responses never ship whole
 *    and are never silently dropped;
 *  - destructive knowledge-store resets must carry an archive ref: the
 *    MT1 P1 finding showed alembic_rescan deleting wiki/candidates file
 *    projections with NO snapshot while claiming retention. The
 *    DestructiveResetReport contract makes that combination structurally
 *    visible (and assertable) instead of silent.
 *
 * Enforcement gate: scripts/check-output-budgets.mjs (wired into
 * `npm run check`) self-tests this module and freezes the budget sheet.
 * Adoption: Core presenters own the content-slice budgets below; the
 * response-level budgets are adopted by the Alembic resident handlers now
 * and the Plugin MCP handlers post-CKG (they serialize the final result).
 *
 * @module shared/OutputBudget
 */

/** Budget classes per the MT0 ruling on the MT1 measured table. */
export type OutputBudgetClass =
  | 'within-budget'
  | 'diagnostics-composite'
  | 'compaction-pending'
  | 'no-headroom';

export interface ToolOutputBudget {
  /** Declared budget for one serialized MCP result, in UTF-8 bytes. */
  budgetBytes: number;
  /** Largest measured real result (MT1 sweep, BiliDili fixture). */
  measuredMaxBytes: number;
  /** MT0/MT1 ruling class for over-budget tools. */
  class: OutputBudgetClass;
  /** Raw measurement reference inside the Train H state-root evidence. */
  rawRef: string;
}

/**
 * Frozen budget sheet (MT1 measured, 2026-06-12). Tools measured above
 * their budget are classed: job/status/init embed full diagnostics/work-
 * package composites (same class as the harvest's 529KB benchmark) and
 * must compact via projection trimming + refs; diagnostics itself has no
 * headroom and is watched.
 */
export const CORE_TOOL_OUTPUT_BUDGETS: Record<string, ToolOutputBudget> = {
  alembic_codex_job: {
    budgetBytes: 16_384,
    measuredMaxBytes: 767_413,
    class: 'diagnostics-composite',
    rawRef: 'bilidili-agent-initphase/raw/alembic_codex_job__rep__minimal.json',
  },
  alembic_bootstrap: {
    budgetBytes: 262_144,
    measuredMaxBytes: 187_033,
    class: 'within-budget',
    rawRef: 'bilidili-agent-initphase/raw/alembic_bootstrap__rep__minimal.json',
  },
  alembic_rescan: {
    budgetBytes: 262_144,
    measuredMaxBytes: 128_209,
    class: 'within-budget',
    rawRef: 'bilidili-agent/raw/alembic_rescan__rep__minimal.json',
  },
  alembic_codex_status: {
    budgetBytes: 16_384,
    measuredMaxBytes: 112_785,
    class: 'diagnostics-composite',
    rawRef: 'bilidili-agent-initphase/raw/alembic_codex_status__rep__minimal.json',
  },
  alembic_codex_init: {
    budgetBytes: 24_576,
    measuredMaxBytes: 74_110,
    class: 'diagnostics-composite',
    rawRef: 'bilidili-agent-initphase/raw/alembic_codex_init__rep__minimal.json',
  },
  alembic_codex_diagnostics: {
    budgetBytes: 32_768,
    measuredMaxBytes: 31_670,
    class: 'no-headroom',
    rawRef: 'bilidili-agent-usable/raw/alembic_codex_diagnostics__rep__minimal.json',
  },
  alembic_knowledge: {
    budgetBytes: 32_768,
    measuredMaxBytes: 14_469,
    class: 'within-budget',
    rawRef: 'bilidili-agent-usable',
  },
  alembic_graph: {
    budgetBytes: 16_384,
    measuredMaxBytes: 11_481,
    class: 'within-budget',
    rawRef: 'bilidili-agent-usable',
  },
  alembic_prime: {
    budgetBytes: 16_384,
    measuredMaxBytes: 6_532,
    class: 'within-budget',
    rawRef: 'bilidili-agent-usable',
  },
};

/**
 * Named content-slice budgets for Core-owned response shaping. These
 * replace the previous magic numbers in place (same values — budget
 * semantics preserved); the names tie each slice to this mechanism.
 */
export const CORE_CONTENT_SLICE_BUDGETS = {
  /** RescanEvidenceProjectors: recipe markdown body for host-agent evidence. */
  rescanEvidenceMarkdownChars: 500,
  /** RescanEvidenceProjectors: recipe rationale. */
  rescanEvidenceRationaleChars: 200,
  /** RescanEvidenceProjectors: recipe coreCode skeleton. */
  rescanEvidenceCoreCodeChars: 400,
  /** RescanEvidenceProjectors: sourceRefs entries per recipe. */
  rescanEvidenceSourceRefs: 5,
  /** HostAgentSubmissionTracker: coreCode preview per submission. */
  submissionCoreCodePreviewChars: 200,
} as const;

export interface OutputBudgetResult {
  /** Payload to ship — unchanged when within budget, truncated otherwise. */
  content: string;
  /** HONESTY FLAG: true whenever the payload was cut. Never omitted. */
  truncated: boolean;
  originalBytes: number;
  budgetBytes: number;
  /** Present only when truncated: how the caller routes the remainder. */
  overflow?: {
    route: 'artifact-ref' | 'pagination';
    /** Bytes that did not ship. */
    omittedBytes: number;
    /** Where the full payload lives, when the caller persisted it. */
    artifactRef?: string;
  };
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/** Truncate at a UTF-8 byte budget without splitting a code point. */
function truncateToBytes(value: string, maxBytes: number): string {
  if (utf8Bytes(value) <= maxBytes) {
    return value;
  }
  const buffer = Buffer.from(value, 'utf8').subarray(0, maxBytes);
  // Strip a trailing partial multi-byte sequence.
  let end = buffer.length;
  while (end > 0 && (buffer[end - 1] & 0b1100_0000) === 0b1000_0000) {
    end--;
  }
  if (end > 0 && (buffer[end - 1] & 0b1100_0000) === 0b1100_0000) {
    end--;
  }
  return buffer.subarray(0, end).toString('utf8');
}

/**
 * Apply a tool's declared output budget to a serialized payload.
 *
 * Unknown tools pass through unbudgeted but the result still reports
 * `truncated: false` so callers always read an explicit signal.
 */
export function applyOutputBudget(
  toolName: string,
  payload: string,
  options: { artifactRef?: string; route?: 'artifact-ref' | 'pagination' } = {}
): OutputBudgetResult {
  const declared = CORE_TOOL_OUTPUT_BUDGETS[toolName];
  const originalBytes = utf8Bytes(payload);
  if (!declared || originalBytes <= declared.budgetBytes) {
    return {
      content: payload,
      truncated: false,
      originalBytes,
      budgetBytes: declared?.budgetBytes ?? Number.POSITIVE_INFINITY,
    };
  }

  const content = truncateToBytes(payload, declared.budgetBytes);
  return {
    content,
    truncated: true,
    originalBytes,
    budgetBytes: declared.budgetBytes,
    overflow: {
      route: options.route ?? 'artifact-ref',
      omittedBytes: originalBytes - utf8Bytes(content),
      ...(options.artifactRef ? { artifactRef: options.artifactRef } : {}),
    },
  };
}

/* ═══ Destructive-reset archive contract (MT1 P1) ═══ */

export interface DestructiveResetReport {
  /** What the reset removed (e.g. 'wiki/candidates file projections'). */
  target: string;
  /** Count of removed items/files. */
  removedCount: number;
  /**
   * Where the removed data was archived (e.g. '.asd/.trash/<ts>/').
   * null means NO snapshot exists — only legal when claimsRetention=false.
   */
  archiveRef: string | null;
  /** Whether the surrounding response claims the data is retained/preserved. */
  claimsRetention: boolean;
}

/**
 * The mechanism that makes silent data-loss impossible: a destructive
 * reset that claims retention without an archive ref is a contract
 * violation, not a presentation choice.
 */
export function assertDestructiveResetHasArchive(report: DestructiveResetReport): void {
  if (report.removedCount > 0 && report.claimsRetention && !report.archiveRef) {
    throw new Error(
      `Destructive reset of ${report.target} removed ${report.removedCount} item(s) and claims retention but has no archiveRef — ` +
        'persist a snapshot (e.g. .asd/.trash/<ts>/) and attach its ref, or stop claiming retention'
    );
  }
}
