// 数据库封装测试:WAL、外键、只读并发、内存形态(database.test.ts 与源码同目录)。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createInMemoryStore, openDatabase } from "./database.js";

const dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("openDatabase(持久形态)", () => {
  it("启用 WAL 与外键,自动创建目录(US4/SC-005)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mini-recall-db-"));
    dirs.push(dir);
    const path = join(dir, "nested", "deep", "test.db"); // 目录不存在 → 应递归创建
    const db = openDatabase(path);
    expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.close();
  });

  it("写连接存在时只读连接可打开(FR-012,阶段 5 并发读前提)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mini-recall-ro-"));
    dirs.push(dir);
    const path = join(dir, "ro.db");
    const writer = openDatabase(path);
    writer.exec("CREATE TABLE t(x)");
    const reader = new (writer.constructor as new (p: string, o: object) => typeof writer)(
      path,
      { readOnly: true },
    );
    expect(reader.prepare("SELECT count(*) AS c FROM t").get()).toEqual({ c: 0 });
    reader.close();
    writer.close();
  });
});

describe("createInMemoryStore(内存形态)", () => {
  it("不落盘且外键开启(US4)", () => {
    const db = createInMemoryStore();
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("CREATE TABLE t(x)");
    db.close();
  });
});
