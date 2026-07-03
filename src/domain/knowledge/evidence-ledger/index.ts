/** 证据台账契约统一导出（Wave A E1；消费方：AlembicAgent 运行时 + 未来 host-agent 接入） */
export {
  EVIDENCE_ENTRY_MAX_CHARS,
  EVIDENCE_ID_RE,
  EVIDENCE_TOOL_IDS,
  type EvidenceEntry,
  type EvidenceRange,
  type EvidenceToolId,
  isEvidenceToolId,
  isValidEvidenceEntry,
  makeEvidenceId,
  type ParsedEvidenceRef,
  parseEvidenceRef,
} from './EvidenceLedgerContract.js';
