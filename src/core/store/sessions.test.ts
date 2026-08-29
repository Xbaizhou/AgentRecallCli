// sessions 读写测试:幂等 upsert(不翻倍)、键冲突先到先得、快照读写、级联删除(US1/SC-003)。
import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { Session, SessionMessage } from "../types.js";
import { createInMemoryStore } from "./database.js";
import { searchContent } from "./fts.js";
import { migrateMiniRecallStore } from "./schema.js";
import {
  getSession,
  listIndexedFileMeta,
  listSessions,
  listStoredPathsBySource,
  removeSession,
  upsertIndexedSession,
} from "./sessions.js";

let db: DatabaseSync;

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionKey: "claude-cli:s-1",
    rawId: "s-1",
    source: "claude-cli",
    projectPath: "/proj/demo",
    filePath: "/root/claude/a.jsonl",
    originalTitle: "a",
    firstQuestion: "第一个问题",
    timestamp: 1754035200000,
    messageCount: 2,
    fileSize: 100,
    fileMtimeMs: 1754035200000,
    ...overrides,
  };
}

function makeMessages(contents: string[]): SessionMessage[] {
  return contents.map((content, index) => ({
    index,
    role: index % 2 === 0 ? "user" : "assistant",
    content,
    timestamp: 1754035200000 + index * 1000,
  }));
}

beforeEach(() => {
  db = createInMemoryStore();
  migrateMiniRecallStore(db);
});

describe("upsertIndexedSession", () => {
  it("写入后可按键取回,字段与锚点一致(US1 场景 1)", () => {
    const session = makeSession();
    upsertIndexedSession(db, session, makeMessages(["问", "答"]));
    const got = getSession(db, session.sessionKey)!;
    expect(got.sessionKey).toBe(session.sessionKey);
    expect(got.firstQuestion).toBe("第一个问题");
    expect(got.messageCount).toBe(2);
    expect(got.fileSize).toBe(100);
    expect(got.fileMtimeMs).toBe(session.fileMtimeMs);
    expect(listIndexedFileMeta(db, "claude-cli")).toEqual([
      {
        sessionKey: session.sessionKey,
        filePath: session.filePath,
        size: session.fileSize,
        mtimeMs: session.fileMtimeMs,
      },
    ]);
  });

  it("内容更新后重复 upsert:消息不翻倍、快照更新、索引无旧内容残留(US1 场景 2/SC-003)", () => {
    const session = makeSession();
    upsertIndexedSession(db, session, makeMessages(["旧内容一", "旧内容二"]));
    const updated = makeSession({ fileSize: 200, fileMtimeMs: 1754035300000, messageCount: 3 });
    upsertIndexedSession(db, updated, makeMessages(["新内容一", "新内容二", "新内容三"]));
    const count = db.prepare("SELECT count(*) AS c FROM messages WHERE session_key = ?").get(session.sessionKey) as { c: number };
    expect(count.c).toBe(3);
    // 快照随重写更新为最新锚点:增量同步据此在下次跳过
    const meta = listIndexedFileMeta(db, "claude-cli").find((m) => m.sessionKey === session.sessionKey)!;
    expect(meta).toEqual({
      sessionKey: session.sessionKey,
      filePath: session.filePath,
      size: 200,
      mtimeMs: 1754035300000,
    });
    // 全文索引无旧内容残留:旧独有词不再命中,新词命中(触发器随先删后插自动同步)
    expect(searchContent(db, "新内容").length).toBeGreaterThan(0);
    expect(searchContent(db, "旧内容").length).toBe(0);
  });

  it("同键不同文件:先到先得,后到者 conflict 跳过(边界:键冲突)", () => {
    const first = makeSession({ filePath: "/root/claude/a.jsonl" });
    const second = makeSession({ filePath: "/root/claude/b.jsonl", firstQuestion: "另一个文件" });
    expect(upsertIndexedSession(db, first, makeMessages(["问"]))).toEqual({ conflict: false });
    expect(upsertIndexedSession(db, second, makeMessages(["另一个文件"]))).toEqual({ conflict: true });
    const got = getSession(db, first.sessionKey)!;
    expect(got.filePath).toBe("/root/claude/a.jsonl");
    expect(got.firstQuestion).toBe("第一个问题");
  });

  it("同键同文件重复写入不算冲突(增量同步的正常路径)", () => {
    const session = makeSession();
    expect(upsertIndexedSession(db, session, makeMessages(["问"]))).toEqual({ conflict: false });
    expect(upsertIndexedSession(db, session, makeMessages(["问"]))).toEqual({ conflict: false });
  });
});

describe("listSessions / listStoredPathsBySource / removeSession", () => {
  it("列表按时间倒序、支持 limit", () => {
    upsertIndexedSession(db, makeSession({ sessionKey: "claude-cli:old", timestamp: 1000 }), makeMessages(["a"]));
    upsertIndexedSession(db, makeSession({ sessionKey: "claude-cli:new", timestamp: 2000 }), makeMessages(["b"]));
    const listed = listSessions(db, { limit: 1 });
    expect(listed).toHaveLength(1);
    expect(listed[0].sessionKey).toBe("claude-cli:new");
  });

  it("按来源列路径用于删除清理;removeSession 级联删消息", () => {
    upsertIndexedSession(db, makeSession(), makeMessages(["问", "答"]));
    expect(listStoredPathsBySource(db, "claude-cli")).toEqual([
      { sessionKey: "claude-cli:s-1", filePath: "/root/claude/a.jsonl" },
    ]);
    removeSession(db, "claude-cli:s-1");
    expect(getSession(db, "claude-cli:s-1")).toBeNull();
    const count = db.prepare("SELECT count(*) AS c FROM messages WHERE session_key = ?").get("claude-cli:s-1") as { c: number };
    expect(count.c).toBe(0);
  });
});
