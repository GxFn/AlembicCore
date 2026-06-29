/**
 * examples/index.ts — SECTION 6 (P0 default stub).
 *
 * `example(language)` returns one gate-passing worked recipe candidate per language. P0 ships a
 * single deterministic default so guidance has a real ✅/❌ example to inline; the full
 * EXAMPLE_TEMPLATES down-move (from MissionBriefingSupport.ts) is P3 and intentionally out of scope
 * here. The default is built to clear stage-1 (English imperative clauses + ✅/❌ contrast) and to
 * carry a concrete sourceRef + ≥200-char markdown, so it is an honest worked example, not an
 * anti-example.
 */
import type { RecipeAuthoringViolation } from '../../../../types/recipeAuthoringSpec.js';

/** A worked, gate-passing recipe candidate for one language. */
export interface WorkedExample {
  language: string;
  /** a recipe candidate shaped like a real submit item. */
  candidate: Record<string, unknown>;
  /** P0 provenance note (default stub until the P3 EXAMPLE_TEMPLATES down-move). */
  note: string;
  /** optional pre-computed violations when the host validates the example (filled by consumers). */
  violations?: RecipeAuthoringViolation[];
}

/** The P0 default worked example — a TypeScript recipe that passes the stage-1 content gate. */
const DEFAULT_EXAMPLE: WorkedExample = {
  language: 'typescript',
  candidate: {
    title: 'OrderRepository 软删除约定',
    trigger: '@order-soft-delete',
    kind: 'rule',
    doClause: 'Use repository.softDelete() so deleted_at is set instead of removing the row.',
    dontClause: 'Do not call db.delete() directly on the orders table.',
    whenClause: 'When removing an order through any service path.',
    coreCode: 'await orderRepository.softDelete(orderId);',
    description: '订单删除统一走软删除，保留审计痕迹。',
    sourceRefs: ['src/repository/order/OrderRepository.ts:42-58'],
    content: {
      markdown: [
        '# OrderRepository 软删除约定',
        '',
        '本项目所有订单删除都走 `OrderRepository.softDelete()`，把 `deleted_at` 置为当前时间，',
        '而不是物理删除行，以保留审计与对账所需的历史数据 (来源: OrderRepository.ts:42-58)。',
        '',
        '✅ 正确: `await orderRepository.softDelete(orderId)` — 设置 deleted_at，行仍可追溯。',
        '❌ 禁止: `await db.delete(orders).where(eq(orders.id, orderId))` — 物理删除，破坏审计链。',
      ].join('\n'),
      rationale: '软删除保留审计痕迹并支持对账回溯，物理删除会破坏历史数据完整性。',
    },
    reasoning: {
      sources: ['OrderRepository.ts'],
      whyStandard: '订单是核心审计对象，必须保留删除痕迹。',
      confidence: 0.85,
    },
  },
  note: 'P0 default worked example (stub). Full multi-language EXAMPLE_TEMPLATES down-move is P3.',
};

/**
 * Returns the worked example for the requested language. P0 always resolves to the single default;
 * a real per-language template table arrives with the P3 EXAMPLE_TEMPLATES down-move.
 */
export function example(language = 'typescript'): WorkedExample {
  return { ...DEFAULT_EXAMPLE, language: language || DEFAULT_EXAMPLE.language };
}
