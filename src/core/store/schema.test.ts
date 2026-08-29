// 迁移测试:幂等是核心验收(SC-004)——连跑两次表结构等价、登记不重复、触发器齐备。
import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createInMemoryStore } from "./database.js";
import { addColumnIfMissing, migrateMiniRecallStore } from "./schema.js";

function objects(db: DatabaseSync, type: string): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name").all(type) as Array<{ name: string }>).map((r) => r.name);
}

describe("migrateMiniRecallStore", () => {
  it("建齐三表 + FTS5 虚拟表 + 两个触发器", () => {
    const db = createInMemoryStore();
    migrateMiniRecallStore(db);
    const tables = objects(db, "table");
    expect(tables).toContain("sessions");
    expect(tables).toContain("messages");
    expect(tables).toContain("data_migrations");
    expect(objects(db, "table")).toContain("messages_fts");
    const triggers = objects(db, "trigger");
    expect(triggers).toContain("messages_ai");
    expect(triggers).toContain("messages_ad");
    db.close();
  });

  it("重复执行幂等:结构不变、登记不重复(SC-004)", () => {
    const db = createInMemoryStore();
    migrateMiniRecallStore(db);
    const snapshot1 = JSON.stringify({
      tables: objects(db, "table"),
      triggers: objects(db, "trigger"),
      migrations: db.prepare("SELECT name FROM data_migrations").all(),
    });
    migrateMiniRecallStore(db);
    const snapshot2 = JSON.stringify({
      tables: objects(db, "table"),
      triggers: objects(db, "trigger"),
      migrations: db.prepare("SELECT name FROM data_migrations").all(),
    });
    expect(snapshot2).toBe(snapshot1);
    db.close();
  });

  it("addColumnIfMissing 缺列才补,重复调用安全(FR-013)", () => {
    const db = createInMemoryStore();
    db.exec("CREATE TABLE demo(x INTEGER)");
    addColumnIfMissing(db, "demo", "y", "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(db, "demo", "y", "TEXT NOT NULL DEFAULT ''"); // 第二次应为 no-op
    const cols = db.prepare("PRAGMA table_info(demo)").all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toEqual(["x", "y"]);
    db.close();
  });
});
