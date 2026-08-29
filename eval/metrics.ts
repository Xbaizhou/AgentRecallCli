// 评测指标:纯函数,可独立单测(计划 6.1 metrics.ts)。
export interface HitOutcome {
  /** 期望会话键是否出现在前 K 命中 */
  hit: boolean;
  /** 命中排名(1 起);未命中为 0 */
  rank: number;
}

/** recall@k:前 K 内命中期望键的比例 */
export function recallAtK(outcomes: HitOutcome[], k = 5): number {
  if (outcomes.length === 0) return 0;
  const hits = outcomes.filter((o) => o.rank > 0 && o.rank <= k).length;
  return hits / outcomes.length;
}

/** MRR:平均倒数排名(未命中贡献 0) */
export function mrr(outcomes: HitOutcome[]): number {
  if (outcomes.length === 0) return 0;
  const sum = outcomes.reduce((acc, o) => acc + (o.rank > 0 ? 1 / o.rank : 0), 0);
  return sum / outcomes.length;
}

/** 从有序命中键序列计算单例 outcome */
export function outcomeOf(orderedKeys: string[], expected: string | null): HitOutcome {
  if (expected === null) return { hit: false, rank: 0 };
  const idx = orderedKeys.indexOf(expected);
  return idx === -1 ? { hit: false, rank: 0 } : { hit: true, rank: idx + 1 };
}
