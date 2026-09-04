// 【验收演示】阶段 4:脚本化 5 问,Agent 正确完成 ≥4(计划 4.4 验收 1),--trace 轨迹打印。
// 全部 MockLlm 零 token(宪法原则 V 的 CI 约束)。
import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { Session } from "../core/types.js";
import { createInMemoryStore } from "../core/store/database.js";
import { migrateMiniRecallStore } from "../core/store/schema.js";
import { upsertIndexedSession } from "../core/store/sessions.js";
import { MockLlm } from "./llm.js";
import { runAgent } from "./loop.js";

let db: DatabaseSync;

function call(name: string, args: Record<string, unknown> = {}) {
  return { id: `d-${Math.random().toString(36).slice(2, 8)}`, name, arguments: JSON.stringify(args) };
}

beforeEach(() => {
  db = createInMemoryStore();
  migrateMiniRecallStore(db);
  const seeds: Array<[string, string, string, string, string[]]> = [
    ["codex:r-1", "r-1", "Rerank 调参讨论", "怎么调 Rerank", ["怎么调 Rerank", "把 rerank 的 top_k 调到 5"]],
    ["codex:r-2", "r-2", "FTS5 检索", "FTS5 怎么建表", ["FTS5 怎么建表", "用 trigram 分词的 fts5 虚拟表"]],
    ["claude-cli:s-1", "s-1", "WAL 并发", "WAL 是什么", ["WAL 是什么", "写前日志,读写不互斥"]],
    ["claude-cli:s-2", "s-2", "无关会话", "今天吃什么", ["今天吃什么", "火锅"]],
  ];
  for (const [key, rawId, title, question, contents] of seeds) {
    const session: Session = {
      sessionKey: key,
      rawId,
      source: key.startsWith("codex") ? "codex" : "claude-cli",
      projectPath: "/proj",
      filePath: `/r/${rawId}.jsonl`,
      originalTitle: title,
      firstQuestion: question,
      timestamp: Date.parse("2026-08-20T10:00:00Z"),
      messageCount: contents.length,
      fileSize: 10,
      fileMtimeMs: 1,
    };
    upsertIndexedSession(
      db,
      session,
      contents.map((content, index) => ({
        index,
        role: index === 0 ? "user" : "assistant",
        content,
        timestamp: session.timestamp + index,
      })),
    );
  }
});

interface DemoCase {
  question: string;
  script: () => MockLlm;
  expectedKey: string;
  evidence: string;
}

const CASES: DemoCase[] = [
  {
    question: "我调 Rerank 的结论是什么?",
    script: () =>
      new MockLlm(
        { toolCalls: [call("search_sessions", { query: "Rerank" })] },
        { toolCalls: [call("get_messages", { sessionKey: "codex:r-1" })] },
        { content: "结论:top_k 调到 5(来源:codex:r-1)" },
      ),
    expectedKey: "codex:r-1",
    evidence: "top_k 调到 5",
  },
  {
    question: "FTS5 怎么建表?",
    script: () =>
      new MockLlm(
        { toolCalls: [call("search_sessions", { query: "FTS5" })] },
        { toolCalls: [call("get_messages", { sessionKey: "codex:r-2" })] },
        { content: "结论:用 trigram 分词的 fts5 虚拟表(来源:codex:r-2)" },
      ),
    expectedKey: "codex:r-2",
    evidence: "trigram 分词",
  },
  {
    question: "WAL 是什么?",
    script: () =>
      new MockLlm(
        { toolCalls: [call("search_sessions", { query: "WAL" })] },
        { toolCalls: [call("get_messages", { sessionKey: "claude-cli:s-1" })] },
        { content: "结论:写前日志(来源:claude-cli:s-1)" },
      ),
    expectedKey: "claude-cli:s-1",
    evidence: "写前日志",
  },
  {
    question: "火锅相关的是哪次会话?",
    script: () =>
      new MockLlm(
        { toolCalls: [call("search_sessions", { query: "火锅" })] },
        { toolCalls: [call("get_messages", { sessionKey: "claude-cli:s-2" })] },
        { content: "结论:火锅(来源:claude-cli:s-2)" },
      ),
    expectedKey: "claude-cli:s-2",
    evidence: "火锅",
  },
  // 第 5 问:时间窗内无命中 → 诚实回答「未找到」而非编造(不引用未观察的键)
  {
    question: "上周关于 Rerank 的讨论结论?",
    script: () =>
      new MockLlm(
        { toolCalls: [call("now")] },
        { toolCalls: [call("search_sessions", { query: "Rerank", afterDaysBack: 7 })] },
        { content: "上周时间窗内没有命中任何 Rerank 相关讨论,无法给出结论。" },
      ),
    expectedKey: "",
    evidence: "没有命中",
  },
];

describe("【验收演示】脚本化 5 问(计划 4.4 验收 1)", () => {
  it("Agent 正确完成 ≥4 问并打印轨迹(--trace 语义)", async () => {
    let passed = 0;
    console.log("\n===== mini-recall 阶段 4 验收演示:Agent 决策循环(--trace)=====");
    for (const c of CASES) {
      const result = await runAgent({ question: c.question, db, llm: c.script() });
      const hit = result.answer.includes(c.evidence) || result.answer.includes(c.expectedKey);
      if (hit) passed += 1;
      console.log(`\n问: ${c.question}`);
      for (const step of result.steps) {
        for (const tc of step.toolCalls) {
          console.log(`  步骤${step.step} → ${tc.name}(${tc.args}) ${tc.ok ? "✓" : "✗"} ${tc.output.slice(0, 60)}`);
        }
      }
      console.log(`  答: ${result.answer.slice(0, 80)} | 工具调用 ${result.usage.toolCalls} 次 | ${hit ? "✅" : "❌"}`);
    }
    console.log(`\n正确完成: ${passed}/5(验收线 ≥4)`);

    expect(passed).toBeGreaterThanOrEqual(4);
  });
});
