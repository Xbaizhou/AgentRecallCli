// 幂等迁移:不存在才建、缺列才补、一次性迁移登记在 data_migrations 不重复执行(计划 2.2 无编号自描述式)。
// FTS5 用 external content + 触发器:upsert 的先删后插自动带动索引更新,无手动双写漂移。
import type { DatabaseSync } from "node:sqlite";

/** 缺列才补:PRAGMA table_info 探测,可对旧结构库无破坏升级 */
export function addColumnIfMissing(
  db: DatabaseSync,
  table: string,
  column: string,
  ddl: string,
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

export function migrateMiniRecallStore(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_key TEXT PRIMARY KEY,
      raw_id TEXT NOT NULL,
      source TEXT NOT NULL,
      project_path TEXT NOT NULL,
      file_path TEXT NOT NULL,
      original_title TEXT NOT NULL,
      first_question TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      file_mtime_ms REAL NOT NULL DEFAULT 0,
      file_size INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      indexed_at INTEGER NOT NULL DEFAULT 0,
      content_indexed_mtime_ms REAL NOT NULL DEFAULT 0,
      content_indexed_size INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS messages (
      session_key TEXT NOT NULL,
      message_index INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      PRIMARY KEY (session_key, message_index),
      FOREIGN KEY (session_key) REFERENCES sessions(session_key) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS data_migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  // trigram 分词:unicode61 把连续 CJK 视为单 token,中文查询必然不命中(计划 2.6 的坑,研究 R1);
  // trigram 让 ≥3 字符中英文子串可命中,短词由 fts.searchContent 的 LIKE 兜底。
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      content='messages',
      content_rowid='rowid',
      tokenize='trigram'
    );
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    END;
  `);

  // 一次性迁移登记:已执行的不重复(当前无历史迁移,登记基线条目便于将来演进)
  db.prepare(
    "INSERT OR IGNORE INTO data_migrations (name, applied_at) VALUES ('0001_baseline', ?)",
  ).run(Date.now());
}
