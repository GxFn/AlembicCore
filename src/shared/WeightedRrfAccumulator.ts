interface RankEvidence {
  rank: number;
  score: number | undefined;
  contribution: number;
}

interface FusedEntry<T, Key> {
  id: Key;
  total: number;
  dense?: RankEvidence;
  sparse?: RankEvidence;
  /** 由调用者选择；累加器不解释 payload，也不决定两路数据的优先级。 */
  payload?: T;
}

/**
 * 两个旧混合检索入口共用的内部排名累加器，不进入公共 barrel。
 * id 策略、参数默认值和 wire 投影留在调用者；这里没有存储/召回/校验职责。
 */
export class WeightedRrfAccumulator<T, Key = string> {
  readonly #entries = new Map<Key, FusedEntry<T, Key>>();

  constructor(
    private readonly k: number,
    private readonly alpha: number
  ) {}

  add(
    id: Key,
    lane: 'dense' | 'sparse',
    originalIndex: number,
    score: number | undefined,
    initial: 'zero' | 'contribution' = 'zero'
  ): FusedEntry<T, Key> {
    const weight = lane === 'dense' ? this.alpha : 1 - this.alpha;
    // 保留乘法/除法及加法的原有顺序，也保留被跳过 id 所占的原始名次。
    const contribution = weight * (1 / (this.k + originalIndex + 1));
    const existing = this.#entries.get(id);
    // HNSW 的首个 sparse 项直接以贡献初始化；从 0 相加会改变旧入口允许的 -0。
    const entry: FusedEntry<T, Key> = existing ?? {
      id,
      total: initial === 'contribution' ? contribution : 0,
    };
    if (existing || initial === 'zero') {
      entry.total += contribution;
    }
    // 重复 id 的 total 累加所有出现；单路证据按旧契约只保留最后一次。
    entry[lane] = { rank: originalIndex + 1, score, contribution };
    this.#entries.set(id, entry);
    return entry;
  }

  ranked(topK: number): FusedEntry<T, Key>[] {
    // Map 首次插入次序 + 稳定 sort 保持同分顺序；不另加 id 排序或过滤零权重条目。
    return [...this.#entries.values()].sort((a, b) => b.total - a.total).slice(0, topK);
  }
}
