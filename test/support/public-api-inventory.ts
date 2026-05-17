import { readFileSync } from 'node:fs';

export type PublicApiStatus =
  | 'stable-public'
  | 'provisional-public'
  | 'transitional-internal'
  | 'internal-only'
  | 'forbidden';

export interface PublicApiClassification {
  status: PublicApiStatus;
  reason: string;
}

interface PublicApiBoundaryPolicy {
  expectedCounts: Record<PublicApiStatus, number>;
  stablePublicExports: string[];
  provisionalPublicExports: string[];
  transitionalInternalExports: string[];
  wildcardExportStatus: PublicApiStatus;
}

function readPublicApiBoundaryPolicy(): PublicApiBoundaryPolicy {
  return JSON.parse(
    readFileSync(new URL('../../config/public-api-boundary.json', import.meta.url), 'utf8')
  );
}

export const PUBLIC_API_BOUNDARY_POLICY = readPublicApiBoundaryPolicy();

export const STABLE_PUBLIC_EXPORTS = new Set<string>(
  PUBLIC_API_BOUNDARY_POLICY.stablePublicExports
);
export const PROVISIONAL_PUBLIC_EXPORTS = new Set<string>(
  PUBLIC_API_BOUNDARY_POLICY.provisionalPublicExports
);
export const TRANSITIONAL_INTERNAL_EXPORTS = new Set<string>(
  PUBLIC_API_BOUNDARY_POLICY.transitionalInternalExports
);

export function classifyPublicApiExport(exportPath: string): PublicApiClassification | null {
  if (STABLE_PUBLIC_EXPORTS.has(exportPath)) {
    return {
      status: 'stable-public',
      reason: '该入口已经通过阶段性契约测试锁定为长期稳定公开 API。',
    };
  }

  if (PROVISIONAL_PUBLIC_EXPORTS.has(exportPath)) {
    return {
      status: 'provisional-public',
      reason: '模块级入口已有真实调用方，但仍需要后续按能力收窄为稳定契约。',
    };
  }

  if (TRANSITIONAL_INTERNAL_EXPORTS.has(exportPath)) {
    return {
      status: 'transitional-internal',
      reason: '当前为迁移期兼容入口，后续应由稳定 facade 或 repository/runtime contract 替代。',
    };
  }

  if (
    exportPath.includes('*') &&
    PUBLIC_API_BOUNDARY_POLICY.wildcardExportStatus === 'transitional-internal'
  ) {
    return {
      status: 'transitional-internal',
      reason: '通配导出只保留为迁移期兼容面，不允许作为新增外层依赖的默认入口。',
    };
  }

  return null;
}

export function summarizePublicApiExports(exportPaths: string[]) {
  const counts: Record<PublicApiStatus, number> = {
    'stable-public': 0,
    'provisional-public': 0,
    'transitional-internal': 0,
    'internal-only': 0,
    forbidden: 0,
  };

  for (const exportPath of exportPaths) {
    const classification = classifyPublicApiExport(exportPath);
    if (classification) {
      counts[classification.status] += 1;
    }
  }

  return counts;
}
