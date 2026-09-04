// 增量索引测试:二次全跳、改 1 重索引 1、删除清理、forceReindex、错误隔离、键冲突(SC-001/SC-002/SC-006)。
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir, removeTempDir } from "../test-utils/temp.js";
import type { DatabaseSync } from "node:sqlite";
import { createInMemoryStore } from "./store/database.js";
import { migrateMiniRecallStore } from "./store/schema.js";
import { getSession } from "./store/sessions.js";
import { searchContent } from "./store/fts.js";
import { syncSessions } from "./indexer.js";
import { FORMAT_ADAPTERS } from "./format-adapters.js";

const CODEX_LINE =
  '{"type":"session_meta","session_id":"roll-1","cwd":"/c","timestamp":1754035200000}\n' +
  '{"type":"response_item","payload":{"role":"user","content":"增量索引的问题"},"timestamp":1754035201000}\n';

const tmpRoots: string[] = [];
const dbs: DatabaseSync[] = [];

afterEach(async () => {
  for (const d of tmpRoots.splice(0)) await removeTempDir(d);
  for (const d of dbs.splice(0)) d.close();
});

/** 每个文件独立 session_id(roll-XXX),文件名保持 rollout-* 以匹配 codex 文件模式 */
async function makeFixtureRoot(fileCount: number): Promise<string> {
  const root = await makeTempDir("idx-");
  tmpRoots.push(root);
  await mkdir(join(root, "codex"), { recursive: true });
  for (let i = 0; i < fileCount; i++) {
    const padded = String(i).padStart(3, "0");
    await writeFile(
      join(root, "codex", `rollout-${padded}.jsonl`),
      CODEX_LINE.replaceAll("roll-1", `roll-${padded}`),
      "utf8",
    );
  }
  return root;
}

function makeDb(): DatabaseSync {
  const db = createInMemoryStore();
  migrateMiniRecallStore(db);
  dbs.push(db);
  return db;
}

describe("syncSessions 增量正确性(US2)", () => {
  it("首次全量入库;二次同步全跳过(SC-001)", async () => {
    const root = await makeFixtureRoot(3);
    const db = makeDb();
    const first = await syncSessions(db, { rootDir: root });
    expect(first).toMatchObject({ indexed: 3, skipped: 0, removed: 0, total: 3 });
    const second = await syncSessions(db, { rootDir: root });
    expect(second).toMatchObject({ indexed: 0, skipped: 3, removed: 0, total: 3 });
  });

  it("追加改动 1 个文件:仅它被重索引,其余跳过(US2 场景 3)", async () => {
    const root = await makeFixtureRoot(3);
    const db = makeDb();
    await syncSessions(db, { rootDir: root });
    await writeFile(
      join(root, "codex", "rollout-000.jsonl"),
      CODEX_LINE + '{"type":"response_item","payload":{"role":"assistant","content":"追加的回答"},"timestamp":1754035202000}\n',
      "utf8",
    );
    const third = await syncSessions(db, { rootDir: root });
    expect(third).toMatchObject({ indexed: 1, skipped: 2 });
    // 新内容可检索:FTS 随 upsert 更新
    expect(searchContent(db, "追加的回答").length).toBe(1);
  });

  it("删除 1 个文件:库内记录连同消息与索引清理,removed=1(SC-002 边界)", async () => {
    const root = await makeFixtureRoot(3);
    const db = makeDb();
    await syncSessions(db, { rootDir: root });
    await rm(join(root, "codex", "rollout-001.jsonl"));
    const status = await syncSessions(db, { rootDir: root });
    expect(status.removed).toBe(1);
    expect(getSession(db, "codex:roll-001")).toBeNull();
    expect(searchContent(db, "增量索引的问题").length).toBe(2); // 3→2
  });

  it("forceReindex 命中来源:无视快照全部重建(US2 场景 5/FR-008)", async () => {
    const root = await makeFixtureRoot(2);
    const db = makeDb();
    await syncSessions(db, { rootDir: root });
    const forced = await syncSessions(db, {
      rootDir: root,
      forceReindex: (source) => source === "codex",
    });
    expect(forced).toMatchObject({ indexed: 2, skipped: 0 });
  });

  it("适配器抛错:计入 errors 不中断整批(US4/FR-007)", async () => {
    const root = await makeFixtureRoot(2);
    const db = makeDb();
    const original = FORMAT_ADAPTERS["codex-jsonl"];
    FORMAT_ADAPTERS["codex-jsonl"] = () => {
      throw new Error("合成异常");
    };
    try {
      const status = await syncSessions(db, { rootDir: root, sources: ["codex"] });
      expect(status.indexed).toBe(0);
      expect(status.errors.length).toBe(2);
      expect(status.errors[0]).toContain("合成异常");
    } finally {
      FORMAT_ADAPTERS["codex-jsonl"] = original;
    }
  });

  it("同键不同文件:后到者计 conflicts,先到者保留(边界:键冲突)", async () => {
    const root = await makeFixtureRoot(1);
    // rollout-dup.jsonl 携带与 rollout-000 相同的 session_id(roll-000)→ 同键、不同文件
    await writeFile(
      join(root, "codex", "rollout-dup.jsonl"),
      CODEX_LINE.replaceAll("roll-1", "roll-000"),
      "utf8",
    );
    const db = makeDb();
    const status = await syncSessions(db, { rootDir: root, sources: ["codex"] });
    expect(status.conflicts).toBe(1);
    expect(status.indexed).toBe(1);
    expect(status.total).toBe(2);
  });
});

describe("性能数据采集(SC-004/SC-006,实测值供 PROJECT-RECAP 引用)", () => {
  it("全量 vs 增量同步耗时(100 文件)", async () => {
    const root = await makeFixtureRoot(100);
    const db = makeDb();
    const fullStart = performance.now();
    await syncSessions(db, { rootDir: root });
    const fullMs = performance.now() - fullStart;

    const incStart = performance.now();
    const second = await syncSessions(db, { rootDir: root });
    const incMs = performance.now() - incStart;
    expect(second.skipped).toBe(100);

    console.log(`[性能] 全量同步(100 文件): ${fullMs.toFixed(1)}ms | 增量同步: ${incMs.toFixed(1)}ms | 提速 ${(fullMs / Math.max(incMs, 0.01)).toFixed(0)}x`);
    expect(incMs).toBeLessThan(fullMs);
  });

  it("FTS5 vs 逐行 LIKE(万条消息,SC-004)", () => {
    // 裸内存库(不跑迁移):本用例自建最小 messages + FTS5 结构做性能对照
    const db = createInMemoryStore();
    dbs.push(db);
    // 与 schema.ts 相同的 external content + 触发器组合,保证插入自动进全文索引
    db.exec(`
      CREATE TABLE messages (session_key TEXT, message_index INTEGER, role TEXT, content TEXT, timestamp INTEGER);
      CREATE VIRTUAL TABLE messages_fts USING fts5(content, content='messages', content_rowid='rowid', tokenize='trigram');
      CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
    `);
    const insert = db.prepare("INSERT INTO messages (session_key, message_index, role, content, timestamp) VALUES ('s', ?, 'user', ?, 0)");
    const total = 10000;
    for (let i = 0; i < total; i++) {
      insert.run(i, i % 100 === 0 ? "FTS5 全文检索目标词在这里" : `普通消息内容 ${i}`);
    }

    const ftsStart = performance.now();
    const ftsRows = db
      .prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?")
      .all('"全文检索目标词"') as unknown[];
    const ftsMs = performance.now() - ftsStart;

    const likeStart = performance.now();
    const likeRows = db
      .prepare("SELECT rowid FROM messages WHERE content LIKE '%全文检索目标词%'")
      .all() as unknown[];
    const likeMs = performance.now() - likeStart;

    console.log(`[性能] 万条消息 FTS5: ${ftsMs.toFixed(1)}ms(${ftsRows.length} 命中) | LIKE: ${likeMs.toFixed(1)}ms(${likeRows.length} 命中)`);
    expect(ftsRows.length).toBe(100);
    expect(likeRows.length).toBe(100);
    expect(ftsMs).toBeLessThanOrEqual(likeMs);
  });
});

describe("平铺模式同步(真实来源布局)", () => {
  it("sync flat:rootDir 即来源目录树根,真实 codex 格式入库且可检索", async () => {
    const root = await makeFixtureRoot(0);
    // 真实布局:日期子目录 + 真实格式 rollout(合成等价样本,宪法 VI)
    await mkdir(join(root, "2026", "07", "29"), { recursive: true });
    await writeFile(
      join(root, "2026", "07", "29", "rollout-real-1.jsonl"),
      '{"timestamp":"2026-07-28T18:20:24.584Z","type":"session_meta","payload":{"session_id":"real-sess-1","id":"real-sess-1","cwd":"C:\\\\proj\\\\demo"}}\n' +
        '{"timestamp":"2026-07-28T18:20:25.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"真实格式的增量索引问题"}]}}\n' +
        '{"timestamp":"2026-07-28T18:20:26.000Z","type":"response_item","payload":{"type":"reasoning","content":[]}}\n',
      "utf8",
    );
    const db = makeDb();
    const first = await syncSessions(db, { rootDir: root, sources: ["codex"], flat: true });
    expect(first).toMatchObject({ indexed: 1, skipped: 0, errors: [] });

    const session = getSession(db, "codex:real-sess-1");
    expect(session).not.toBeNull();
    expect(session!.projectPath).toBe("C:\\proj\\demo");
    // reasoning 行不入库:消息数 = 1
    expect(session!.messageCount).toBe(1);
    expect(searchContent(db, "真实格式的增量索引").length).toBe(1);

    // 二次同步全跳过:增量判定在平铺模式下照常生效
    const second = await syncSessions(db, { rootDir: root, sources: ["codex"], flat: true });
    expect(second).toMatchObject({ indexed: 0, skipped: 1 });
  });
});

describe("【验收演示】阶段 2 全链路(T009)", () => {
  it("入库 → 增量 → 删除清理 → 中英文检索", async () => {
    const root = await makeFixtureRoot(4);
    const db = makeDb();

    const first = await syncSessions(db, { rootDir: root });
    const second = await syncSessions(db, { rootDir: root });
    await writeFile(
      join(root, "codex", "rollout-000.jsonl"),
      CODEX_LINE + '{"type":"response_item","payload":{"role":"assistant","content":"含全文检索关键词的新回答"},"timestamp":1754035209000}\n',
      "utf8",
    );
    const third = await syncSessions(db, { rootDir: root });
    await rm(join(root, "codex", "rollout-003.jsonl"));
    const fourth = await syncSessions(db, { rootDir: root });
    const hits = searchContent(db, "全文检索");

    console.log("\n===== mini-recall 阶段 2 验收演示:增量索引 + FTS5 =====");
    console.log(`首次同步: indexed=${first.indexed}, skipped=${first.skipped}`);
    console.log(`二次同步: indexed=${second.indexed}, skipped=${second.skipped}   ← 增量判定生效`);
    console.log(`改动后:   indexed=${third.indexed}, skipped=${third.skipped}   ← 只重索引 1 个`);
    console.log(`删除后:   removed=${fourth.removed}                        ← 库内记录已清理`);
    console.log(`检索「全文检索」: ${JSON.stringify(hits)}`);
    console.log(`库内会话数: ${(db.prepare("SELECT count(*) AS c FROM sessions").get() as { c: number }).c}`);

    expect(first).toMatchObject({ indexed: 4 });
    expect(second).toMatchObject({ indexed: 0, skipped: 4 });
    expect(third).toMatchObject({ indexed: 1, skipped: 3 });
    expect(fourth.removed).toBe(1);
    expect(hits.length).toBe(1);
  });
});
