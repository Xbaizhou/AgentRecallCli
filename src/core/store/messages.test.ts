// messages 读取测试:全量与 tail 语义(US1/FR-005)。
import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { Session } from "../types.js";
import { createInMemoryStore } from "./database.js";
import { migrateMiniRecallStore } from "./schema.js";
import { getMessages } from "./messages.js";
import { upsertIndexedSession } from "./sessions.js";

let db: DatabaseSync;

beforeEach(() => {
  db = createInMemoryStore();
  migrateMiniRecallStore(db);
});

function makeSession(): Session {
  return {
    sessionKey: "codex:r-1",
    rawId: "r-1",
    source: "codex",
    projectPath: "/c",
    filePath: "/root/codex/rollout-1.jsonl",
    originalTitle: "rollout-1",
    firstQuestion: "q1",
    timestamp: 1754035200000,
    messageCount: 3,
    fileSize: 10,
    fileMtimeMs: 1754035200000,
  };
}

beforeEach(() => {
  upsertIndexedSession(
    db,
    makeSession(),
    ["q1", "a1", "q2"].map((content, index) => ({
      index,
      role: index % 2 === 0 ? "user" : "assistant",
      content,
      timestamp: 1754035200000 + index,
    })),
  );
});

describe("getMessages", () => {
  it("全量按 message_index 正序返回", () => {
    const all = getMessages(db, "codex:r-1");
    expect(all.map((m) => m.content)).toEqual(["q1", "a1", "q2"]);
    expect(all.map((m) => m.index)).toEqual([0, 1, 2]);
  });

  it("tail 取最后 N 条且保持原始顺序(供「看最近对话」)", () => {
    expect(getMessages(db, "codex:r-1", 2).map((m) => m.content)).toEqual(["a1", "q2"]);
    expect(getMessages(db, "codex:r-1", 99).map((m) => m.content)).toEqual(["q1", "a1", "q2"]);
  });

  it("不存在的会话返回空数组", () => {
    expect(getMessages(db, "no:such")).toEqual([]);
  });
});
