import type { AnalysisScale } from '../plan/intent/coldStartProductionPlan.js';
import { hashCanonicalJson } from '../project-context/foundation/canonical.js';

export interface StrictFactFileExecutionV1 {
  readonly repoId: string;
  readonly relativePath: string;
  readonly blobHash: string;
  readonly status: 'complete' | 'failed' | 'unknown';
  readonly reasonCode: string;
  readonly truncated: boolean;
  readonly continuation: string | null;
  readonly witnessBindingHash: string | null;
  readonly evidenceEntryId: string | null;
  readonly projectContextRefId: string | null;
  readonly stagedFactIds: readonly string[];
  readonly discardedFactIds: readonly string[];
  readonly emittedFactIds: readonly string[];
  readonly executionHash: string;
}

export interface FactQueryExecutionReceiptV1 {
  readonly schemaVersion: 1;
  readonly terminalReceiptId: string;
  readonly obligationId: string;
  readonly factFamilyId: string;
  readonly capabilityId: string;
  readonly canonicalSubjectRef: string;
  readonly analysisScale: AnalysisScale;
  readonly denominator: 'complete-frozen-subject';
  readonly sourceRevisionVectorHash: string;
  readonly backendProducer: string;
  readonly backendManifestHash: string;
  readonly backendLoadReceiptHash: string;
  readonly queryPackHash: string;
  readonly harvestKey: string;
  readonly harvestReceiptHash: string;
  readonly expectedFileCount: number;
  readonly inspectedFileCount: number;
  readonly denominatorFileIds: readonly string[];
  readonly denominatorHash: string;
  readonly witnessBindingHash: string;
  readonly fileExecutions: readonly StrictFactFileExecutionV1[];
  readonly derivedFactIds: readonly string[];
  readonly emittedFactIds: readonly string[];
  readonly disposition: 'matched' | 'inspected-no-pattern' | 'failed' | 'unknown';
  readonly reasonCode: string;
  readonly truncated: boolean;
  readonly continuation: string | null;
  /** 对 denominator、文件执行和最终 facts 的紧凑输出承诺，供 population/review 跨进程绑定。 */
  readonly outputHash: string;
  readonly receiptHash: string;
}

/**
 * Fact 执行回执只有这一处确定性验真入口。分析、反证、统一生产 authority 都复用它，
 * 避免不同消费者对 denominator 或 staged/discarded conservation 形成分叉语义。
 */
export function assertFactQueryExecutionReceiptV1(receipt: FactQueryExecutionReceiptV1): void {
  for (const execution of receipt.fileExecutions) {
    const { executionHash, ...executionSemantic } = execution;
    if (
      hashCanonicalJson(executionSemantic) !== executionHash ||
      JSON.stringify(execution.stagedFactIds) !==
        JSON.stringify([...execution.emittedFactIds, ...execution.discardedFactIds].sort())
    ) {
      throw new Error('FACT_QUERY_EXECUTION_RECEIPT_INVALID');
    }
  }
  const expectedOutputHash = hashCanonicalJson({
    obligationId: receipt.obligationId,
    denominatorHash: receipt.denominatorHash,
    fileExecutionHashes: receipt.fileExecutions.map((execution) => execution.executionHash),
    derivedFactIds: receipt.derivedFactIds,
    emittedFactIds: receipt.emittedFactIds,
    disposition: receipt.disposition,
    truncated: receipt.truncated,
    continuation: receipt.continuation,
  });
  const { terminalReceiptId, receiptHash, ...receiptSemantic } = receipt;
  if (
    receipt.outputHash !== expectedOutputHash ||
    hashCanonicalJson(receiptSemantic) !== receiptHash ||
    terminalReceiptId !== `fact-execution:${receiptHash.slice(7, 31)}` ||
    receipt.expectedFileCount !== receipt.denominatorFileIds.length ||
    receipt.inspectedFileCount !== receipt.fileExecutions.length ||
    hashCanonicalJson(receipt.denominatorFileIds) !== receipt.denominatorHash
  ) {
    throw new Error('FACT_QUERY_EXECUTION_RECEIPT_INVALID');
  }
}
