// 决策循环测试:正常轨迹、三类停止条件、幻觉重答(US1/US2/SC-002,全部 MockLlm 零 token)。
import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { Session } from "../core/types.js";
import { createInMemoryStore } from "../core/store/database.js";
import { migrateMiniRecallStore } from "../core/store/schema.js";
import { upsertIndexedSession } from "../core/store/sessions.js";
import { MockLlm } from "./llm.js";
import { runAgent } from "./loop.js";

let db: DatabaseSync;

beforeEach(() => {
  db = createInMemoryStore();
  migrateMiniRecallStore(db);
  const session: Session = {
    sessionKey: "codex:r-1",
    rawId: "r-1",
    source: "codex",
    projectPath: "/proj/codex",
    filePath: "/r/codex/r-1.jsonl",
    originalTitle: "Rerank 调参讨论",
    firstQuestion: "怎么调 Rerank",
    timestamp: Date.parse("2026-08-20T10:00:00Z"),
    messageCount: 2,
    fileSize: 10,
    fileMtimeMs: 1,
  };
  upsertIndexedSession(
    db,
    session,
    ["怎么调 Rerank", "把 rerank 的 top_k 调到 5"].map((content, index) => ({
      index,
      role: index === 0 ? "user" : "assistant",
      content,
      timestamp: session.timestamp + index,
    })),
  );
});

/** 工具调用便捷构造 */
function call(name: string, args: Record<string, unknown> = {}) {
  return { id: `c-${Math.random().toString(36).slice(2, 8)}`, name, arguments: JSON.stringify(args) };
}

describe("runAgent 正常轨迹(US1)", () => {
  it("now → search → get_messages → 最终答案,轨迹与用量齐备", async () => {
    const llm = new MockLlm(
      { toolCalls: [call("now")] },
      { toolCalls: [call("search_sessions", { query: "Rerank" })] },
      { toolCalls: [call("get_messages", { sessionKey: "codex:r-1" })] },
      { content: "在「Rerank 调参讨论」(codex:r-1)里:把 top_k 调到 5。" },
    );
    const result = await runAgent({ question: "上周我调 Rerank 的结论?", db, llm });
    expect(result.stopReason).toBe("final");
    expect(result.answer).toContain("top_k");
    expect(result.steps.filter((s) => s.toolCalls.length > 0).map((s) => s.toolCalls[0]!.name)).toEqual([
      "now",
      "search_sessions",
      "get_messages",
    ]);
    expect(result.usage.toolCalls).toBe(3);
    expect(result.usage.promptTokens).toBeGreaterThan(0);
  });

  it("无工具调用的内容即最终答案,立即终止", async () => {
    const llm = new MockLlm({ content: "直接回答" });
    const result = await runAgent({ question: "q", db, llm });
    expect(result.stopReason).toBe("final");
    expect(result.steps).toHaveLength(1);
  });
});

describe("停止条件三件套(US2/SC-002)", () => {
  it("重复调用:同工具同参数第二次被拒并回喂(不执行)", async () => {
    const llm = new MockLlm(
      { toolCalls: [call("search_sessions", { query: "Rerank" })] },
      // 同参数重复调用 → 被拦截后模型给最终答案
      { toolCalls: [call("search_sessions", { query: "Rerank" })] },
      { content: "已检索过:结论在 codex:r-1。" },
    );
    const result = await runAgent({ question: "q", db, llm });
    expect(result.stopReason).toBe("final");
    expect(result.steps[1].toolCalls[0].ok).toBe(false);
    expect(result.steps[1].toolCalls[0].output).toContain("重复调用");
  });

  it("maxSteps 超限:强制收尾(SC-002)", async () => {
    // 无限循环脚本:每步都调用一次不同参数的 search(绕开重复检测)
    let i = 0;
    const llm = new MockLlm();
    llm.chat = async () => ({ content: null, toolCalls: [call("search_sessions", { limit: 1, query: `q${i++}` })], usage: { promptTokens: 1, completionTokens: 1 } });
    const result = await runAgent({ question: "q", db, llm, maxSteps: 8 });
    expect(result.stopReason).toBe("maxSteps");
    expect(result.steps).toHaveLength(8);
    expect(result.answer).toContain("已达步数上限");
  });

  it("工具连续失败 ≥3 次熔断退出(SC-002)", async () => {
    // 非法参数(zod 校验失败)= 工具失败
    const llm = new MockLlm(
      { toolCalls: [call("get_messages", {})] },
      { toolCalls: [call("get_messages", {})] },
      { toolCalls: [call("get_messages", {})] },
    );
    const result = await runAgent({ question: "q", db, llm });
    expect(result.stopReason).toBe("circuitBreaker");
    expect(result.answer).toContain("连续失败");
  });

  it("未知工具计为失败并回喂可用工具列表", async () => {
    const llm = new MockLlm(
      { toolCalls: [call("no_such_tool")] },
      { content: "好的。" },
    );
    const result = await runAgent({ question: "q", db, llm });
    expect(result.steps[0].toolCalls[0].output).toContain("未知工具");
  });
});

describe("幻觉会话键重答(澄清 4/FR-007)", () => {
  it("答案引用不存在的键 → 重答一次,二次以新答案为准", async () => {
    const llm = new MockLlm(
      { content: "见 codex:fake-key。" },
      { content: "观察结果中没有该键;可回答:资料不足。" },
    );
    const result = await runAgent({ question: "q", db, llm });
    expect(result.stopReason).toBe("final");
    expect(result.answer).toContain("资料不足");
    expect(result.steps[0].toolCalls[0].name).toBe("(溯源校验)");
  });

  it("引用观察结果中出现过的键 → 直接通过", async () => {
    const llm = new MockLlm(
      { toolCalls: [call("search_sessions", { query: "Rerank" })] },
      { content: "结论见 codex:r-1。" },
    );
    const result = await runAgent({ question: "q", db, llm });
    expect(result.stopReason).toBe("final");
    expect(result.steps).toHaveLength(2);
  });
});
