// Output-budget gate (MT2, Train A): freezes the MT1-measured budget sheet
// and self-tests the shared enforcement mechanism. Blocking in `npm run
// check` per the MT0 ruling (budgets became blocking once MT1 measured).
// Requires a current `npm run build` output (same constraint as the smoke
// gate; the check pipeline builds before this gate runs).
//
// Invariants enforced:
//  1. Sheet integrity — every entry carries positive budgetBytes,
//     measuredMaxBytes and a raw measurement ref (no estimated budgets).
//  2. Class honesty — a tool measured ABOVE its budget may not claim
//     'within-budget'/'no-headroom'; it must be classed as a composite/
//     compaction case so the overflow route is owned, not hidden.
//  3. Enforcement honesty — applyOutputBudget truncates over-budget
//     payloads to the byte budget with truncated:true and an overflow
//     route; within-budget payloads pass through with truncated:false.
//  4. Destructive-reset contract — a reset that claims retention with no
//     archiveRef must throw (the MT1 P1 silent-data-loss case).

const failures = [];

const { CORE_TOOL_OUTPUT_BUDGETS, applyOutputBudget, assertDestructiveResetHasArchive } =
  await import('../dist/shared/OutputBudget.js').catch((err) => {
    console.error(`Output-budget gate cannot load dist/shared/OutputBudget.js: ${err.message}`);
    console.error('Run `npm run build` first.');
    process.exit(1);
  });

// 1 + 2: sheet integrity and class honesty
for (const [tool, entry] of Object.entries(CORE_TOOL_OUTPUT_BUDGETS)) {
  if (!Number.isInteger(entry.budgetBytes) || entry.budgetBytes <= 0) {
    failures.push(`${tool}: budgetBytes must be a positive integer`);
  }
  if (!Number.isInteger(entry.measuredMaxBytes) || entry.measuredMaxBytes <= 0) {
    failures.push(`${tool}: measuredMaxBytes missing — budgets come from measurements, not estimates`);
  }
  if (!entry.rawRef) {
    failures.push(`${tool}: rawRef missing — every budget needs its raw measurement reference`);
  }
  const overBudget = entry.measuredMaxBytes > entry.budgetBytes;
  if (overBudget && (entry.class === 'within-budget' || entry.class === 'no-headroom')) {
    failures.push(
      `${tool}: measured ${entry.measuredMaxBytes}B exceeds budget ${entry.budgetBytes}B but class is '${entry.class}' — over-budget tools must own a compaction/composite ruling`
    );
  }
  if (!overBudget && entry.class === 'diagnostics-composite') {
    failures.push(`${tool}: classed diagnostics-composite but measured within budget — re-rule`);
  }
}

// 3: enforcement honesty self-test
const probeTool = 'alembic_prime';
const budget = CORE_TOOL_OUTPUT_BUDGETS[probeTool]?.budgetBytes ?? 0;
const oversized = 'x'.repeat(budget + 1000);
const truncatedResult = applyOutputBudget(probeTool, oversized, { artifactRef: 'probe://full' });
if (!truncatedResult.truncated) {
  failures.push('applyOutputBudget shipped an over-budget payload without truncated:true');
}
if (Buffer.byteLength(truncatedResult.content, 'utf8') > budget) {
  failures.push('applyOutputBudget left content above the byte budget');
}
if (truncatedResult.overflow?.route !== 'artifact-ref' || truncatedResult.overflow?.artifactRef !== 'probe://full') {
  failures.push('applyOutputBudget lost the overflow route/artifact ref');
}
const fitting = applyOutputBudget(probeTool, 'small payload');
if (fitting.truncated !== false || fitting.content !== 'small payload') {
  failures.push('applyOutputBudget mangled a within-budget payload');
}
// multibyte safety: truncation must not split a code point
const multibyte = '汉'.repeat(budget); // 3 bytes each — guaranteed over budget
const multibyteResult = applyOutputBudget(probeTool, multibyte);
if (multibyteResult.content.includes('�')) {
  failures.push('applyOutputBudget split a multi-byte code point at the budget boundary');
}

// 4: destructive-reset contract
let threw = false;
try {
  assertDestructiveResetHasArchive({
    target: 'wiki/candidates file projections',
    removedCount: 12,
    archiveRef: null,
    claimsRetention: true,
  });
} catch {
  threw = true;
}
if (!threw) {
  failures.push(
    'assertDestructiveResetHasArchive allowed a retention-claiming destructive reset with no archiveRef (MT1 P1 silent data loss)'
  );
}
try {
  assertDestructiveResetHasArchive({
    target: 'wiki/candidates file projections',
    removedCount: 12,
    archiveRef: '.asd/.trash/20260612-000000/',
    claimsRetention: true,
  });
} catch (err) {
  failures.push(`assertDestructiveResetHasArchive rejected a properly archived reset: ${err.message}`);
}

if (failures.length > 0) {
  console.error(`Output-budget gate failed: ${failures.length} issue(s).`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Output-budget gate OK: ${Object.keys(CORE_TOOL_OUTPUT_BUDGETS).length} tool budgets frozen at MT1 measured values; enforcement honesty and the destructive-reset archive contract verified.`
);
