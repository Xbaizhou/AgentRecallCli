// CLI 调度测试:渲染、非法参数字段级拒绝、quit、未知命令(US3/US4)。
import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { Session } from "./core/types.js";
import { createInMemoryStore } from "./core/store/database.js";
import { migrateMiniRecallStore } from "./core/store/schema.js";
import { upsertIndexedSession } from "./core/store/sessions.js";
import { dispatchLine, parseLine } from "./cli.js";

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
    originalTitle: "codex 会话",
    firstQuestion: "全文检索怎么用",
    timestamp: Date.parse("2026-08-02T10:00:00Z"),
    messageCount: 2,
    fileSize: 10,
    fileMtimeMs: 1,
  };
  upsertIndexedSession(
    db,
    session,
    ["全文检索怎么用", "先建 trigram 分词的 FTS5 表"].map((content, index) => ({
      index,
      role: index === 0 ? "user" : "assistant",
      content,
      timestamp: session.timestamp + index,
    })),
  );
});

describe("parseLine", () => {
  it("支持 --key value 与 --key=value 与位置参数", () => {
    expect(parseLine("search --query RAG --limit 5")).toEqual({
      name: "search",
      flags: { query: "RAG", limit: "5" },
      positionals: [],
    });
    expect(parseLine("messages codex:r-1 --tail=3")).toEqual({
      name: "messages",
      flags: { tail: "3" },
      positionals: ["codex:r-1"],
    });
  });
});

describe("dispatchLine", () => {
  it("search 渲染命中数与 tookMs(US4)", () => {
    const lines = dispatchLine(db, "search --query 全文检索")!;
    expect(lines[0]).toMatch(/命中 1 条.*显示 1 条/);
    expect(lines.join("\n")).toContain("codex:r-1");
  });

  it("messages 支持 tail 且保持顺序(US2)", () => {
    const lines = dispatchLine(db, "messages codex:r-1 --tail 1")!;
    expect(lines.join("\n")).toContain("先建 trigram 分词的 FTS5 表");
    expect(lines.join("\n")).not.toContain("全文检索怎么用");
  });

  it("stats 渲染分布(US2)", () => {
    const lines = dispatchLine(db, "stats")!;
    expect(lines.join("\n")).toContain("codex=1");
  });

  it("非法参数被字段级拒绝并继续(US3/SC-003)", () => {
    const badLimit = dispatchLine(db, "search --limit -1")!;
    expect(badLimit.join("\n")).toContain("limit");
    const unknownField = dispatchLine(db, "search --nonsense 1")!;
    expect(unknownField.join("\n")).toContain("参数校验失败");
    const missing = dispatchLine(db, "messages")!;
    expect(missing.join("\n")).toContain("sessionKey");
  });

  it("quit/exit 返回 null;未知命令给提示;空输入给帮助(US4/FR-007)", () => {
    expect(dispatchLine(db, "quit")).toBeNull();
    expect(dispatchLine(db, "exit")).toBeNull();
    expect(dispatchLine(db, "frobnicate")!.join("")).toContain("未知命令");
    expect(dispatchLine(db, "")!.length).toBeGreaterThan(1);
  });
});
