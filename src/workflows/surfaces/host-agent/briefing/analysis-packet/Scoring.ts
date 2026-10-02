import type { ProjectContextRef } from '../../../../../domain/project-context/index.js';
import { sortUnique } from './StableIdentity.js';
import type { HostAgentStructuralEvidenceRef } from './Types.js';

export function scoreProjectContextRef(ref: ProjectContextRef): number {
  switch (ref.kind) {
    case 'source-slice':
    case 'anchor-range':
    case 'symbol':
      return 96;
    case 'file-symbol':
    case 'file-flow':
      return 92;
    case 'file':
      return 88;
    case 'module':
    case 'module-layer':
      return 82;
    case 'map':
    case 'repo':
      return 76;
    default:
      return 60;
  }
}

export function expectedEvidenceForDimension(
  dimensionId: string,
  evidenceRefs: readonly HostAgentStructuralEvidenceRef[]
): string[] {
  const kinds = sortUnique(evidenceRefs.map((ref) => ref.kind));
  const expected = ['reasoning.sources intersects unit.requiredReadSet'];
  if (kinds.length) {
    expected.push(`structural evidence: ${kinds.join(', ')}`);
  }
  if (dimensionId.includes('flow')) {
    expected.push('call/data-flow relationship or explicit deviation reason');
  }
  return expected;
}
