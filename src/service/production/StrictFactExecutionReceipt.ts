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
  const fileExecutionIds = receipt.fileExecutions.map(
    (execution) => `${execution.repoId}:${execution.relativePath}@${execution.blobHash}`
  );
  if (hasInvalidFactReceiptShape(receipt, fileExecutionIds)) {
    throw new Error('FACT_QUERY_EXECUTION_RECEIPT_INVALID');
  }
  for (const execution of receipt.fileExecutions) {
    if (hasInvalidFileExecution(execution)) {
      throw new Error('FACT_QUERY_EXECUTION_RECEIPT_INVALID');
    }
  }
  if (hasInvalidFactReceiptHashes(receipt)) {
    throw new Error('FACT_QUERY_EXECUTION_RECEIPT_INVALID');
  }
}

function hasInvalidFactReceiptShape(
  receipt: FactQueryExecutionReceiptV1,
  fileExecutionIds: readonly string[]
): boolean {
  return (
    receipt.schemaVersion !== 1 ||
    receipt.denominator !== 'complete-frozen-subject' ||
    !Number.isSafeInteger(receipt.expectedFileCount) ||
    receipt.expectedFileCount < 0 ||
    !Number.isSafeInteger(receipt.inspectedFileCount) ||
    receipt.inspectedFileCount < 0 ||
    new Set(receipt.denominatorFileIds).size !== receipt.denominatorFileIds.length ||
    new Set(fileExecutionIds).size !== fileExecutionIds.length ||
    new Set(receipt.fileExecutions.map((execution) => execution.executionHash)).size !==
      receipt.fileExecutions.length ||
    new Set(receipt.derivedFactIds).size !== receipt.derivedFactIds.length ||
    new Set(receipt.emittedFactIds).size !== receipt.emittedFactIds.length
  );
}

function hasInvalidFileExecution(execution: StrictFactFileExecutionV1): boolean {
  const { executionHash, ...executionSemantic } = execution;
  return (
    hashCanonicalJson(executionSemantic) !== executionHash ||
    new Set(execution.stagedFactIds).size !== execution.stagedFactIds.length ||
    new Set(execution.discardedFactIds).size !== execution.discardedFactIds.length ||
    new Set(execution.emittedFactIds).size !== execution.emittedFactIds.length ||
    execution.discardedFactIds.some((factId) => execution.emittedFactIds.includes(factId)) ||
    JSON.stringify(execution.stagedFactIds) !==
      JSON.stringify([...execution.emittedFactIds, ...execution.discardedFactIds].sort())
  );
}

function hasInvalidFactReceiptHashes(receipt: FactQueryExecutionReceiptV1): boolean {
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
  return (
    receipt.outputHash !== expectedOutputHash ||
    hashCanonicalJson(receiptSemantic) !== receiptHash ||
    terminalReceiptId !== `fact-execution:${receiptHash.slice(7, 31)}` ||
    receipt.expectedFileCount !== receipt.denominatorFileIds.length ||
    receipt.inspectedFileCount !== receipt.fileExecutions.length ||
    hashCanonicalJson(receipt.denominatorFileIds) !== receipt.denominatorHash
  );
}

/**
 * 基础回执允许记录 failed/unknown 终态，不能把“记录完整”误当成“可以授权语义处置”。
 * 独立评审只有在完整冻结分母被逐文件成功检查且没有续页/截断时，才能签发 pass。
 */
export function assertReviewAuthorizingFactExecutionV1(receipt: FactQueryExecutionReceiptV1): void {
  assertFactQueryExecutionReceiptV1(receipt);
  const inspectedFileIds = receipt.fileExecutions
    .map((execution) => `${execution.repoId}:${execution.relativePath}@${execution.blobHash}`)
    .sort();
  const directFactIds = receipt.fileExecutions
    .flatMap((execution) => execution.emittedFactIds)
    .sort();
  const allEmittedFactIds = [...new Set([...directFactIds, ...receipt.derivedFactIds])].sort();
  const fileExecutionIncomplete = receipt.fileExecutions.some(
    (execution) =>
      execution.status !== 'complete' ||
      execution.truncated ||
      execution.continuation !== null ||
      !execution.witnessBindingHash ||
      !execution.evidenceEntryId ||
      !execution.projectContextRefId
  );
  const dispositionMismatch =
    (receipt.disposition === 'matched' && receipt.emittedFactIds.length === 0) ||
    (receipt.disposition === 'inspected-no-pattern' && receipt.emittedFactIds.length !== 0);
  if (
    receipt.expectedFileCount < 1 ||
    receipt.inspectedFileCount !== receipt.expectedFileCount ||
    receipt.fileExecutions.length !== receipt.expectedFileCount ||
    JSON.stringify(inspectedFileIds) !== JSON.stringify([...receipt.denominatorFileIds].sort()) ||
    (receipt.disposition !== 'matched' && receipt.disposition !== 'inspected-no-pattern') ||
    receipt.truncated ||
    receipt.continuation !== null ||
    fileExecutionIncomplete ||
    dispositionMismatch ||
    JSON.stringify(allEmittedFactIds) !== JSON.stringify([...receipt.emittedFactIds].sort())
  ) {
    throw new Error('KNOWLEDGE_DISPOSITION_EXECUTION_NONTERMINAL');
  }
}
