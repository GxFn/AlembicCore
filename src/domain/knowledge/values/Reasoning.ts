/** Reasoning — 推理值对象 */
interface ReasoningProps {
  whyStandard?: string;
  sources?: string[];
  confidence?: number;
  qualitySignals?: Record<string, number>;
  alternatives?: string[];
  evidenceRefs?: string[];
  styleAdvisories?: string[];
  styleWaiver?: { codes: string[]; justification: string };
}

export class Reasoning {
  alternatives: string[];
  confidence: number;
  qualitySignals: Record<string, number>;
  sources: string[];
  whyStandard: string;
  evidenceRefs: string[];
  styleAdvisories: string[];
  styleWaiver?: { codes: string[]; justification: string };
  constructor(props: ReasoningProps = {}) {
    /** 为什么遵循标准 */
    this.whyStandard = props.whyStandard ?? '';
    /** 来源列表 */
    this.sources = props.sources || [];
    /** 置信度 0-1 */
    this.confidence = props.confidence ?? 0.7;
    /** 质量信号 */
    this.qualitySignals = props.qualitySignals ?? {};
    /** 备选方案 */
    this.alternatives = props.alternatives || [];
    // 挖掘产出升级 M1 收尾（2026-07-04）：值对象构造器是提交侧扩展字段的真剥离点——
    // KnowledgeEntry 用 Reasoning.from() 重建 reasoning，未挑选的键在 toJSON 持久化时丢失
    // （run-9/10 取证：styleAdvisories attach 全部未落库；styleWaiver 同理从未持久化）。
    /** 证据台账引用（E-x id）——事实面采集溯源 */
    this.evidenceRefs = props.evidenceRefs || [];
    /** 门禁分层：非阻断软风格违规记录，Dashboard 人工复核入口 */
    this.styleAdvisories = props.styleAdvisories || [];
    /** 软规则一次申辩：放行时的违规码与理由 */
    this.styleWaiver = props.styleWaiver;
  }

  /** 从任意输入构造 Reasoning */
  static from(input: unknown): Reasoning {
    if (input instanceof Reasoning) {
      return input;
    }
    if (!input) {
      return new Reasoning();
    }
    if (typeof input === 'string') {
      try {
        input = JSON.parse(input);
      } catch {
        return new Reasoning();
      }
    }
    return new Reasoning(input as ReasoningProps);
  }

  /** 验证推理信息的完整性 */
  isValid() {
    return !!(
      this.whyStandard?.trim() &&
      Array.isArray(this.sources) &&
      this.sources.length > 0 &&
      typeof this.confidence === 'number' &&
      this.confidence >= 0 &&
      this.confidence <= 1
    );
  }

  /** 转换为 JSON */
  toJSON() {
    return {
      whyStandard: this.whyStandard,
      sources: this.sources,
      confidence: this.confidence,
      qualitySignals: this.qualitySignals,
      alternatives: this.alternatives,
      // 扩展字段仅在非空时输出——既有条目/快照的 JSON 形状保持字节不变（零回归）
      ...(this.evidenceRefs.length > 0 ? { evidenceRefs: this.evidenceRefs } : {}),
      ...(this.styleAdvisories.length > 0 ? { styleAdvisories: this.styleAdvisories } : {}),
      ...(this.styleWaiver ? { styleWaiver: this.styleWaiver } : {}),
    };
  }

  /** 从 wire format 创建 */
  static fromJSON(data: unknown): Reasoning {
    return new Reasoning(data as ReasoningProps);
  }
}

export default Reasoning;
