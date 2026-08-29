// FTS5 全文检索:trigram MATCH + 短词 LIKE 兜底,按 bm25 相关度排序。
// 为什么需要兜底:trigram 要求查询 ≥3 字符,两字中文词(如「全文」)必须走 LIKE 才能命中(研究 R1)。
import type { DatabaseSync } from "node:sqlite";
import type { SearchHit } from "../types.js";

export function searchContent(
  db: DatabaseSync,
  query: string,
  limit = 50,
): SearchHit[] {
  const keyword = query.trim();
  if (keyword === "") return []; // 空/空白关键词:返回空,不报错(spec FR-011)

  if (keyword.length >= 3) {
    // 双引号包裹为短语字面量:防 FTS5 语法注入,也保证 CJK 连续子串按相邻匹配
    const matchQuery = `"${keyword.replaceAll('"', '""')}"`;
    const rows = db
      .prepare(
        `SELECT m.session_key AS session_key,
                snippet(messages_fts, 0, '[', ']', '…', 12) AS snippet,
                bm25(messages_fts) AS rank
         FROM messages_fts
         JOIN messages m ON m.rowid = messages_fts.rowid
         WHERE messages_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(matchQuery, limit) as Array<{ session_key: string; snippet: string }>;
    return rows.map((r) => ({ sessionKey: r.session_key, snippet: r.snippet }));
  }

  // LIKE 兜底:%/_ 转义,ESCAPE 声明转义符;走全表扫描——短词查询语义优先,性能 trade-off 如实记录
  const like = `%${keyword.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const rows = db
    .prepare(
      `SELECT session_key,
              substr(content, 1, 40) AS snippet
       FROM messages
       WHERE content LIKE ? ESCAPE '\\'
       ORDER BY session_key, message_index
       LIMIT ?`,
    )
    .all(like, limit) as Array<{ session_key: string; snippet: string }>;
  return rows.map((r) => ({ sessionKey: r.session_key, snippet: r.snippet }));
}
