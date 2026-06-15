export type {
  AnchorRangeContext,
  AnchorRangeRadius,
  ProjectContextAnchor,
} from '../../../domain/project-context/index.js';

import type {
  AnchorRangeRadius,
  ProjectContextAnchorKind,
  ProjectContextQueryErrorCode,
  ProjectContextRef,
  SourceRangeSummary,
} from '../../../domain/project-context/index.js';

export interface AnchorRangeRequestPayload {
  anchor?: AnchorRangePayloadAnchor;
  filePath?: string;
  line?: number;
  range?: SourceRangeSummary;
  ref?: ProjectContextRef;
  radius?: Partial<AnchorRangeRadius>;
  beforeLines?: number;
  afterLines?: number;
  relationHops?: number;
  includeSourceSlices?: boolean;
  includeSymbols?: boolean;
  includeRelations?: boolean;
  includeRelatedRefs?: boolean;
  includeContainingRefs?: boolean;
}

export interface AnchorRangePayloadAnchor {
  kind?: ProjectContextAnchorKind;
  filePath?: string;
  line?: number;
  range?: SourceRangeSummary;
  ref?: ProjectContextRef;
}

export interface AnchorRangeQueryFailure {
  code: ProjectContextQueryErrorCode;
  message: string;
  path?: string;
  retryable?: boolean;
}

export interface NormalizedAnchorRangeOptions {
  includeContainingRefs: boolean;
  includeRelatedRefs: boolean;
  includeRelations: boolean;
  includeSourceSlices: boolean;
  includeSymbols: boolean;
  radius: AnchorRangeRadius;
}
