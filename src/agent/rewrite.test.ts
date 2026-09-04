// 改写与反思测试:成功路径 + 降级路径(US3/SC-003,全部 MockLlm 零 token)。
import { describe, expect, it } from "vitest";
import { MockLlm } from "./llm.js";
import { rewriteQuery } from "./rewrite.js";
import { reflect } from "./reflect.js";

describe("rewriteQuery", () => {
  it("合法 JSON 输出 → 结构化条件(含时间窗换算)", async () => {
    const llm = new MockLlm({
      content: '{"query":"Rerank","source":"codex","afterDaysBack":7}',
    });
    const before = Date.now();
    const filters = await rewriteQuery(llm, "上周我在哪个会话里调过重排?");
    const after = Date.now();
    expect(filters.query).toBe("Rerank");
    expect(filters.source).toBe("codex");
    // after ≈ now - 7 天(允许 1 秒误差)
    expect(filters.after).toBeGreaterThanOrEqual(before - 7 * 86400000 - 1000);
    expect(filters.after).toBeLessThanOrEqual(after - 7 * 86400000 + 1000);
  });

  it("非法 JSON → 降级为原句关键词,不崩溃(计划 4.6)", async () => {
    const llm = new MockLlm({ content: "这不是 JSON" });
    const filters = await rewriteQuery(llm, "上周查过 Rerank 吗");
    expect(filters).toEqual({ query: "上周查过 Rerank 吗" });
  });

  it("字段不符合 schema → 同样降级", async () => {
    const llm = new MockLlm({ content: '{"q":"拼错字段"}' });
    const filters = await rewriteQuery(llm, "问题");
    expect(filters.query).toBe("问题");
  });

  it("chat 抛异常 → 降级不崩溃", async () => {
    const llm = new MockLlm();
    llm.chat = async () => {
      throw new Error("网络错误");
    };
    const filters = await rewriteQuery(llm, "问题");
    expect(filters.query).toBe("问题");
  });
});

describe("reflect", () => {
  it("sufficient / insufficient 两种判定(US3)", async () => {
    const sufficient = new MockLlm({ content: '{"verdict":"sufficient","reason":"覆盖实体与时间窗"}' });
    expect(await reflect(sufficient, "q", [])).toEqual({
      verdict: "sufficient",
      reason: "覆盖实体与时间窗",
    });
    const insufficient = new MockLlm({
      content: '{"verdict":"insufficient","reason":"缺时间窗,建议 afterDaysBack=7 重查"}',
    });
    expect(await reflect(insufficient, "q", [])).toEqual({
      verdict: "insufficient",
      reason: "缺时间窗,建议 afterDaysBack=7 重查",
    });
  });

  it("JSON 合法但字段不符合 schema → 默认 sufficient + 降级原因(澄清 3)", async () => {
    const llm = new MockLlm({ content: '{"verdict":"bad"}' });
    const verdict = await reflect(llm, "q", []);
    expect(verdict.verdict).toBe("sufficient");
    expect(verdict.reason).toContain("解析失败");
  });
});
