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

export const STABLE_PUBLIC_EXPORTS = new Set<string>(['.']);
STABLE_PUBLIC_EXPORTS.add('./daemon');
STABLE_PUBLIC_EXPORTS.add('./database');
STABLE_PUBLIC_EXPORTS.add('./dimensions');
STABLE_PUBLIC_EXPORTS.add('./events');
STABLE_PUBLIC_EXPORTS.add('./io');
STABLE_PUBLIC_EXPORTS.add('./knowledge');
STABLE_PUBLIC_EXPORTS.add('./logging');
STABLE_PUBLIC_EXPORTS.add('./repositories');
STABLE_PUBLIC_EXPORTS.add('./workspace');

export const PROVISIONAL_PUBLIC_EXPORTS = new Set<string>([
  './config',
  './core',
  './core/analysis',
  './core/ast',
  './core/capability',
  './core/discovery',
  './core/enhancement',
  './domain',
  './domain/knowledge/values',
  './infrastructure',
  './infrastructure/config',
  './infrastructure/event',
  './infrastructure/io',
  './infrastructure/logging',
  './infrastructure/report',
  './infrastructure/signal',
  './infrastructure/vector',
  './service',
  './service/bootstrap',
  './service/candidate',
  './service/evolution',
  './service/guard',
  './service/knowledge',
  './service/panorama',
  './service/quality',
  './service/recipe',
  './service/search',
  './service/vector',
  './shared',
  './types',
  './workflows',
  './workflows/cold-start',
  './workflows/knowledge-rescan',
  './workflows/shared',
  './workflows/capabilities/execution/external',
  './workflows/capabilities/persistence',
  './workflows/capabilities/planning/dimensions',
  './workflows/capabilities/planning/knowledge',
  './workflows/capabilities/presentation',
  './workflows/capabilities/project-intelligence',
]);

export const TRANSITIONAL_INTERNAL_EXPORTS = new Set<string>([
  './domain/dimension',
  './domain/knowledge',
  './infrastructure/database',
  './infrastructure/database/drizzle',
  './repository',
  './repository/base',
  './repository/bootstrap',
  './repository/code',
  './repository/evolution',
  './repository/guard',
  './repository/knowledge',
  './repository/memory',
  './repository/search',
  './repository/session',
  './repository/sourceref',
  './repository/sync',
  './repository/token',
  './workflows/capabilities',
]);

export function classifyPublicApiExport(exportPath: string): PublicApiClassification | null {
  if (STABLE_PUBLIC_EXPORTS.has(exportPath)) {
    return {
      status: 'stable-public',
      reason: '根入口是当前唯一长期稳定公开入口。',
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

  if (exportPath.includes('*')) {
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
