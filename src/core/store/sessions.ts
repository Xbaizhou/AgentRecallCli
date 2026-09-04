// sessions 表读写:幂等 upsert(先删后插防消息翻倍)+ 基础读 + 增量快照 + 删除。
import type { DatabaseSync } from "node:sqlite";
import type { Session, SessionMessage, SessionSource } from "../types.js";

export interface UpsertResult {
  /** true = 同键冲突,先到先得保留已有记录,本次未写入(研究 R7) */
  conflict: boolean;
}

const SESSION_COLS =
  "session_key, raw_id, source, project_path, file_path, original_title, first_question, timestamp, file_mtime_ms, file_size, message_count, indexed_at, content_indexed_mtime_ms, content_indexed_size";

/**
 * 幂等 upsert:会话行 ON CONFLICT 更新;消息先删后插(计划 2.6 坑点:直接重插会翻倍);
 * FTS 为 external content + 触发器,随删除/插入自动同步,无旧内容残留。
 * 键冲突(同 source:rawId、不同文件)按文件路径顺序先到先得,后到者跳过。
 */
export function upsertIndexedSession(
  db: DatabaseSync,
  session: Session,
  messages: SessionMessage[],
): UpsertResult {
  const existing = db
    .prepare("SELECT file_path FROM sessions WHERE session_key = ?")
    .get(session.sessionKey) as { file_path: string } | undefined;
  if (existing && existing.file_path !== session.filePath) {
    return { conflict: true };
  }

  const now = Date.now();
  db.prepare(
    `INSERT INTO sessions (${SESSION_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(session_key) DO UPDATE SET
       raw_id=excluded.raw_id, source=excluded.source, project_path=excluded.project_path,
       file_path=excluded.file_path, original_title=excluded.original_title,
       first_question=excluded.first_question, timestamp=excluded.timestamp,
       file_mtime_ms=excluded.file_mtime_ms, file_size=excluded.file_size,
       message_count=excluded.message_count, indexed_at=excluded.indexed_at,
       content_indexed_mtime_ms=excluded.content_indexed_mtime_ms,
       content_indexed_size=excluded.content_indexed_size`,
  ).run(
    session.sessionKey,
    session.rawId,
    session.source,
    session.projectPath,
    session.filePath,
    session.originalTitle,
    session.firstQuestion,
    session.timestamp,
    session.fileMtimeMs,
    session.fileSize,
    messages.length,
    now,
    // 快照与锚点一致:下次同步若文件未变即可 skipped(增量判定的核心)
    session.fileMtimeMs,
    session.fileSize,
  );

  db.prepare("DELETE FROM messages WHERE session_key = ?").run(session.sessionKey);
  const insert = db.prepare(
    "INSERT INTO messages (session_key, message_index, role, content, timestamp) VALUES (?,?,?,?,?)",
  );
  for (const m of messages) {
    insert.run(session.sessionKey, m.index, m.role, m.content, m.timestamp);
  }
  return { conflict: false };
}

function rowToSession(row: Record<string, unknown>): Session {
  return {
    sessionKey: row.session_key as string,
    rawId: row.raw_id as string,
    source: row.source as SessionSource,
    projectPath: row.project_path as string,
    filePath: row.file_path as string,
    originalTitle: row.original_title as string,
    firstQuestion: row.first_question as string,
    timestamp: row.timestamp as number,
    messageCount: row.message_count as number,
    fileSize: row.file_size as number,
    fileMtimeMs: row.file_mtime_ms as number,
  };
}

const SESSION_ROW =
  "session_key, raw_id, source, project_path, file_path, original_title, first_question, timestamp, file_mtime_ms, file_size, message_count";

export function getSession(db: DatabaseSync, sessionKey: string): Session | null {
  const row = db
    .prepare(`SELECT ${SESSION_ROW} FROM sessions WHERE session_key = ?`)
    .get(sessionKey) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

export function listSessions(
  db: DatabaseSync,
  opts: { limit?: number; offset?: number } = {},
): Session[] {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const rows = db
    .prepare(`SELECT ${SESSION_ROW} FROM sessions ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
    .all(limit, offset) as Array<Record<string, unknown>>;
  return rows.map(rowToSession);
}

/** 按路径索引的库内快照(增量同步在解析前据此判定跳过,并以文件路径做删除清理) */
export function listIndexedFileMeta(
  db: DatabaseSync,
  source: SessionSource,
): Array<{ sessionKey: string; filePath: string; size: number; mtimeMs: number }> {
  const rows = db
    .prepare(
      "SELECT session_key, file_path, content_indexed_size, content_indexed_mtime_ms FROM sessions WHERE source = ?",
    )
    .all(source) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    sessionKey: r.session_key as string,
    filePath: r.file_path as string,
    size: r.content_indexed_size as number,
    mtimeMs: r.content_indexed_mtime_ms as number,
  }));
}

/** 删除清理用:列出某来源在库内的全部 会话键 + 文件路径 */
export function listStoredPathsBySource(
  db: DatabaseSync,
  source: SessionSource,
): Array<{ sessionKey: string; filePath: string }> {
  const rows = db
    .prepare("SELECT session_key, file_path FROM sessions WHERE source = ?")
    .all(source) as Array<{ session_key: string; file_path: string }>;
  return rows.map((r) => ({ sessionKey: r.session_key, filePath: r.file_path }));
}

/** 删除会话:消息随外键级联,FTS 项随 AFTER DELETE 触发器清理 */
export function removeSession(db: DatabaseSync, sessionKey: string): void {
  db.prepare("DELETE FROM sessions WHERE session_key = ?").run(sessionKey);
}
