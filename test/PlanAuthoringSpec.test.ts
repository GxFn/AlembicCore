import { describe, expect, it } from 'vitest';
import {
  PLAN_SCALE_RULES,
  renderPlanPersonaDescription,
  renderPlanScaleChecklistEn,
  renderPlanScaleMethodZh,
} from '../src/service/planIntent/plan-authoring-spec.js';

/**
 * PlanAuthoringSpec 钉子(S2,2026-07-02 统一重构)。
 *
 * plan 决策指导单源：主体 persona 与宿主 checklist 共用 PLAN_SCALE_RULES。
 * 本文件钉住:①规则数值(改动即显式决策);②persona 关键段落(与 P-1 手写文本
 * 语义等价的守护——完整字节等价在切换时已一次性验证);③两皮规则一致性。
 */
describe('PlanAuthoringSpec', () => {
  it('pins the scale rule numbers (changing them is an explicit product decision)', () => {
    expect(PLAN_SCALE_RULES).toEqual({
      strongStrengthMin: 60,
      strongRange: { min: 6, max: 10 },
      mediumStrengthMin: 20,
      mediumRange: { min: 4, max: 6 },
      weakFloor: 3,
      perDimensionFloor: 3,
    });
  });

  it('renders the persona with density-driven sizing, hard constraints, and a self-consistent example', () => {
    const persona = renderPlanPersonaDescription();
    expect(persona).toContain('dimensionEvidenceDensity');
    expect(persona).toContain('strength 高（≥60）');
    expect(persona).toContain('预算 6-10 条');
    expect(persona).toContain('不低于 dimensions 数量 × 3');
    expect(persona).toContain('"totalRecipeBudget": 40');
    // 示例自洽:40 = 10+8+7+5+5+5(防锚定的核心——示例数字必须与 dimensionBudgets 和一致)
    const example = persona.slice(persona.indexOf('"dimensionBudgets"'));
    const budgetsBlock = example.slice(0, example.indexOf('}') + 1);
    const budgets = [...budgetsBlock.matchAll(/": (\d+)/g)].map((m) => Number(m[1]));
    expect(budgets).toHaveLength(6);
    expect(budgets.reduce((a, b) => a + b, 0)).toBe(40);
  });

  it('keeps host checklist and persona on the same rule numbers', () => {
    const checklist = renderPlanScaleChecklistEn().join('\n');
    const method = renderPlanScaleMethodZh().join('\n');
    for (const anchor of ['60', '6-10', '20-59', '4-6']) {
      expect(checklist).toContain(anchor);
      expect(method).toContain(anchor);
    }
    expect(checklist).toContain('dimensionEvidenceDensity');
  });
});
