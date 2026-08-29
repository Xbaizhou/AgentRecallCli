// 全文检索测试:中文(两字/四字)、英文、转义、空串、无残留(US3/FR-006/FR-010/FR-011)。
import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { Session } from "../types.js";
import { createInMemoryStore } from "./database.js";
import { searchContent } from "./fts.js";
import { migrateMiniRecallStore } from "./schema.js";
import { upsertIndexedSession } from "./sessions.js";

let db: DatabaseSync;

beforeEach(() => {
  db = createInMemoryStore();
  migrateMiniRecallStore(db);
});

function seed(sessionKey: string, filePath: string, contents: string[]): void {
  const session: Session = {
    sessionKey,
    rawId: sessionKey.split(":")[1],
    source: "claude-cli",
    projectPath: "/p",
    filePath,
    originalTitle: "t",
    firstQuestion: contents[0] ?? "",
    timestamp: 1754035200000,
    messageCount: contents.length,
    fileSize: 1,
    fileMtimeMs: 1754035200000,
  };
  upsertIndexedSession(
    db,
    session,
    contents.map((content, index) => ({ index, role: "user", content, timestamp: 0 })),
  );
}

describe("searchContent", () => {
  beforeEach(() => {
    seed("claude-cli:a", "/r/claude/a.jsonl", ["FTS5 全文检索虚拟表模块"]);
    seed("claude-cli:b", "/r/claude/b.jsonl", ["增量索引用 size+mtime 判定"]);
  });

  it("四字中文词命中且片段带标记(US3 场景 1/SC-002)", () => {
    const hits = searchContent(db, "全文检索");
    expect(hits).toHaveLength(1);
    expect(hits[0].sessionKey).toBe("claude-cli:a");
    expect(hits[0].snippet).toContain("[全文检索]");
  });

  it("两字中文词经 LIKE 兜底命中(FR-010:两字及以上可命中)", () => {
    const hits = searchContent(db, "全文");
    expect(hits.map((h) => h.sessionKey)).toContain("claude-cli:a");
  });

  it("英文关键词命中(US3)", () => {
    const hits = searchContent(db, "size");
    expect(hits.map((h) => h.sessionKey)).toEqual(["claude-cli:b"]);
  });

  it("不存在的词返回空;空/空白关键词返回空不报错(FR-011)", () => {
    expect(searchContent(db, "不存在词组")).toEqual([]);
    expect(searchContent(db, "")).toEqual([]);
    expect(searchContent(db, "   ")).toEqual([]);
  });

  it("upsert 替换内容后旧关键词零命中(US3 场景 3:索引无残留)", () => {
    seed("claude-cli:a", "/r/claude/a.jsonl", ["现在是重排序模块"]);
    expect(searchContent(db, "全文检索")).toEqual([]);
    expect(searchContent(db, "重排序").map((h) => h.sessionKey)).toContain("claude-cli:a");
  });

  it("limit 生效", () => {
    seed("claude-cli:c", "/r/claude/c.jsonl", ["关键词命中一", "关键词命中二", "关键词命中三"]);
    expect(searchContent(db, "关键词命中", 2)).toHaveLength(2);
  });
});
