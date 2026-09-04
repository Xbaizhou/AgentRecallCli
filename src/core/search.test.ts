// 查询服务测试:两路求交、分页 total、排序退化、统计(US1/US2/SC-001/SC-002)。
import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { Session } from "./types.js";
import { createInMemoryStore } from "./store/database.js";
import { migrateMiniRecallStore } from "./store/schema.js";
import { upsertIndexedSession } from "./store/sessions.js";
import { searchSessions, sessionStats } from "./search.js";

let db: DatabaseSync;

function makeSession(overrides: Partial<Session>): Session {
  return {
    sessionKey: "claude-cli:x",
    rawId: "x",
    source: "claude-cli",
    projectPath: "/proj/demo",
    filePath: "/r/claude/x.jsonl",
    originalTitle: "t",
    firstQuestion: "q",
    timestamp: Date.parse("2026-08-01T10:00:00Z"),
    messageCount: 1,
    fileSize: 10,
    fileMtimeMs: 1,
    ...overrides,
  };
}

function seed(contents: string[], overrides: Partial<Session>): void {
  const session = makeSession(overrides);
  upsertIndexedSession(
    db,
    session,
    contents.map((content, index) => ({ index, role: "user", content, timestamp: session.timestamp })),
  );
}

beforeEach(() => {
  db = createInMemoryStore();
  migrateMiniRecallStore(db);
  seed(["FTS5 是什么", "全文检索模块"], { sessionKey: "claude-cli:s-1", rawId: "s-1", filePath: "/r/claude/s-1.jsonl", originalTitle: "FTS5 讨论", firstQuestion: "FTS5 是什么", timestamp: Date.parse("2026-08-01T10:00:00Z") });
  seed(["全文检索怎么用"], { sessionKey: "codex:r-1", rawId: "r-1", source: "codex", projectPath: "/proj/codex", filePath: "/r/codex/r-1.jsonl", originalTitle: "codex 会话", firstQuestion: "全文检索怎么用", timestamp: Date.parse("2026-08-02T10:00:00Z") });
  seed(["今天天气不错"], { sessionKey: "claude-cli:s-2", rawId: "s-2", filePath: "/r/claude/s-2.jsonl", originalTitle: "无关会话", firstQuestion: "今天天气", timestamp: Date.parse("2026-08-03T10:00:00Z") });
});

describe("searchSessions", () => {
  it("关键词 + 来源过滤两路求交(SC-001)", () => {
    // 「怎么用」只命中 codex 会话;再加 claude-cli 过滤 → 两路交集为 0
    const both = searchSessions(db, { query: "怎么用", source: "codex" });
    expect(both.total).toBe(1);
    expect(both.items[0].sessionKey).toBe("codex:r-1");
    expect(both.items[0].snippet).toBeDefined();

    const none = searchSessions(db, { query: "怎么用", source: "claude-cli" });
    expect(none.total).toBe(0); // 关键词路命中 1 条,但来源过滤后交集为空
  });

  it("四字中文关键词命中 claude 会话(修正上面的直觉断言)", () => {
    const hits = searchSessions(db, { query: "全文检索" });
    expect(hits.total).toBe(2); // s-1 与 r-1 都含该词
  });

  it("时间倒序默认排序;relevance 按 bm25(US1)", () => {
    const byTime = searchSessions(db, {});
    expect(byTime.items[0].sessionKey).toBe("claude-cli:s-2"); // 最新
    const byRel = searchSessions(db, { query: "全文检索", sort: "relevance" });
    expect(byRel.items.length).toBe(2);
  });

  it("分页:total 与 items 解耦;offset 超界 items 空而 total 正确(SC-002)", () => {
    const page = searchSessions(db, { limit: 1, offset: 1 });
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(1);
    const beyond = searchSessions(db, { limit: 1, offset: 99 });
    expect(beyond.items).toHaveLength(0);
    expect(beyond.total).toBe(3);
  });

  it("after/before 时间窗过滤(US1)", () => {
    const windowed = searchSessions(db, {
      after: Date.parse("2026-08-02T00:00:00Z"),
      before: Date.parse("2026-08-02T23:59:59Z"),
    });
    expect(windowed.total).toBe(1);
    expect(windowed.items[0].sessionKey).toBe("codex:r-1");
  });

  it("project 前缀过滤", () => {
    const proj = searchSessions(db, { project: "/proj/codex" });
    expect(proj.total).toBe(1);
    expect(proj.items[0].sessionKey).toBe("codex:r-1");
  });

  it("tookMs 被采集(SC-005 基线来源)", () => {
    const res = searchSessions(db, { query: "全文检索" });
    expect(res.tookMs).toBeGreaterThanOrEqual(0);
  });
});

describe("sessionStats", () => {
  it("按来源与按日分布(US2)", () => {
    const stats = sessionStats(db);
    expect(stats.perSource).toEqual([
      { source: "claude-cli", count: 2 },
      { source: "codex", count: 1 },
    ]);
    expect(stats.perDay).toHaveLength(3); // 08-01 / 08-02 / 08-03
    expect(stats.perDay[0]).toEqual({ day: "2026-08-01", count: 1 });
  });
});
