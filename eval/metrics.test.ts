// 指标纯函数单测:构造已知命中序列断言(US2)。
import { describe, expect, it } from "vitest";
import { recallAtK, mrr, outcomeOf } from "./metrics.js";

describe("recallAtK", () => {
  it("全命中 / 部分命中 / 空集", () => {
    const allHit = [
      { hit: true, rank: 1 },
      { hit: true, rank: 2 },
    ];
    expect(recallAtK(allHit, 5)).toBe(1);
    const partial = [
      { hit: true, rank: 1 },
      { hit: false, rank: 0 },
    ];
    expect(recallAtK(partial, 5)).toBe(0.5);
    expect(recallAtK([], 5)).toBe(0);
  });

  it("rank 超出 K 不计入", () => {
    expect(recallAtK([{ hit: true, rank: 6 }], 5)).toBe(0);
    expect(recallAtK([{ hit: true, rank: 5 }], 5)).toBe(1);
  });
});

describe("mrr", () => {
  it("平均倒数排名:1/1 与 1/3", () => {
    expect(mrr([{ hit: true, rank: 1 }, { hit: true, rank: 3 }])).toBeCloseTo((1 + 1 / 3) / 2, 6);
    expect(mrr([{ hit: false, rank: 0 }])).toBe(0);
    expect(mrr([])).toBe(0);
  });
});

describe("outcomeOf", () => {
  it("按位置给出 1 起排名;无期望键返回未命中", () => {
    expect(outcomeOf(["a", "b", "c"], "b")).toEqual({ hit: true, rank: 2 });
    expect(outcomeOf(["a"], "b")).toEqual({ hit: false, rank: 0 });
    expect(outcomeOf(["a"], null)).toEqual({ hit: false, rank: 0 });
  });
});
