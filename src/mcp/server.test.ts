// MCP server 测试:handleRpc 三连、错误码、isError content、db-pointer roundtrip(US1/US3)。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { Session } from "../core/types.js";
import { createInMemoryStore, openDatabase } from "../core/store/database.js";
import { migrateMiniRecallStore } from "../core/store/schema.js";
import { upsertIndexedSession } from "../core/store/sessions.js";
import { handleRpc, openReadonlyDb } from "./server.js";
import { readDbPointer, resolveDbPath, writeDbPointer } from "./db-pointer.js";

let db: DatabaseSync;
const homes: string[] = [];

beforeEach(() => {
  db = createInMemoryStore();
  migrateMiniRecallStore(db);
  const session: Session = {
    sessionKey: "codex:r-1",
    rawId: "r-1",
    source: "codex",
    projectPath: "/proj/codex",
    filePath: "/r/codex/r-1.jsonl",
    originalTitle: "Rerank 调参",
    firstQuestion: "全文检索怎么用",
    timestamp: Date.parse("2026-08-20T10:00:00Z"),
    messageCount: 1,
    fileSize: 10,
    fileMtimeMs: 1,
  };
  upsertIndexedSession(
    db,
    session,
    [{ index: 0, role: "user", content: "全文检索怎么用", timestamp: 1 }],
  );
});

afterEach(async () => {
  for (const h of homes.splice(0)) await rm(h, { recursive: true, force: true });
});

describe("handleRpc(US1/SC-001)", () => {
  it("initialize 握手返回协议版本与能力", async () => {
    const res = JSON.parse(
      (await handleRpc(db, { jsonrpc: "2.0", id: 1, method: "initialize" }))!,
    );
    expect(res.result.protocolVersion).toBe("2024-11-05");
    expect(res.result.serverInfo.name).toBe("mini-recall");
  });

  it("tools/list 暴露只读四件套(澄清 3)", async () => {
    const res = JSON.parse((await handleRpc(db, { jsonrpc: "2.0", id: 2, method: "tools/list" }))!);
    const names = res.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(["get_messages", "list_sources", "now", "search_sessions"]);
    expect(res.result.tools[0].inputSchema).toBeDefined();
  });

  it("tools/call 命中种子数据并返回文本 content(SC-002)", async () => {
    const res = JSON.parse(
      (await handleRpc(db, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "search_sessions", arguments: { query: "全文检索" } },
      }))!,
    );
    expect(res.result.isError).not.toBe(true);
    expect(res.result.content[0].text).toContain("codex:r-1");
  });

  it("未知工具与非法参数 → isError content(不崩进程)", async () => {
    const unknown = JSON.parse(
      (await handleRpc(db, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "no_such", arguments: {} },
      }))!,
    );
    expect(unknown.result.isError).toBe(true);
    const badArgs = JSON.parse(
      (await handleRpc(db, {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "get_messages", arguments: {} },
      }))!,
    );
    expect(badArgs.result.isError).toBe(true);
  });

  it("未知方法 → -32601;通知不应答;ping 应答(边界)", async () => {
    const errRes = JSON.parse((await handleRpc(db, { jsonrpc: "2.0", id: 6, method: "bogus" }))!);
    expect(errRes.error.code).toBe(-32601);
    expect(await handleRpc(db, { jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(await handleRpc(db, { jsonrpc: "2.0", id: 7, method: "ping" })).toBe('{"jsonrpc":"2.0","id":7,"result":{}}');
  });
});

describe("openReadonlyDb(US3/SC-004)", () => {
  it("只读打开现有库并可查询(写连接存在时不阻塞,WAL 并发)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-ro-"));
    homes.push(dir);
    const path = join(dir, "t.db");
    // 主程序侧:读写连接(建表+迁移)
    const writer = openDatabase(path);
    migrateMiniRecallStore(writer);
    // server 侧:同一文件只读打开——写连接存活期间可并发查询(SC-004)
    const reader = openReadonlyDb({ MINI_RECALL_DB: path });
    expect(
      reader.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get(),
    ).toBeDefined();
    reader.close();
    writer.close();
  });

  it("指针缺失时报可诊断错误(边界)", () => {
    expect(() => openReadonlyDb({})).toThrow(/找不到数据库路径/);
  });
});

describe("db-pointer", () => {
  it("write/read roundtrip;MINI_RECALL_DB 覆盖指针(T001)", async () => {
    const home = await mkdtemp(join(tmpdir(), "mcp-home-"));
    homes.push(home);
    expect(readDbPointer(home)).toBeNull();
    writeDbPointer("/some/db.sqlite", home);
    expect(readDbPointer(home)).toBe("/some/db.sqlite");
    expect(resolveDbPath({ MINI_RECALL_DB: "/override.db" }, home)).toBe("/override.db");
    expect(resolveDbPath({}, home)).toBe("/some/db.sqlite");
    void writeFile;
  });
});
