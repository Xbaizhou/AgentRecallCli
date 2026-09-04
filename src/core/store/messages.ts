// messages 表读取:按会话取消息,支持 tail(取最后 N 条,供阶段 3/4 的「看最近对话」)。
import type { DatabaseSync } from "node:sqlite";
import type { SessionMessage } from "../types.js";

export function getMessages(
  db: DatabaseSync,
  sessionKey: string,
  tail?: number,
): SessionMessage[] {
  if (tail !== undefined && tail > 0) {
    // 子查询倒序取尾段,再正序输出:保证 index 单调递增的原始顺序
    const rows = db
      .prepare(
        `SELECT message_index, role, content, timestamp FROM (
           SELECT * FROM messages WHERE session_key = ? ORDER BY message_index DESC LIMIT ?
         ) ORDER BY message_index ASC`,
      )
      .all(sessionKey, tail) as Array<Record<string, unknown>>;
    return rows.map(rowToMessage);
  }
  const rows = db
    .prepare(
      "SELECT message_index, role, content, timestamp FROM messages WHERE session_key = ? ORDER BY message_index ASC",
    )
    .all(sessionKey) as Array<Record<string, unknown>>;
  return rows.map(rowToMessage);
}

function rowToMessage(row: Record<string, unknown>): SessionMessage {
  return {
    index: row.message_index as number,
    role: row.role as string,
    content: row.content as string,
    timestamp: row.timestamp as number,
  };
}
