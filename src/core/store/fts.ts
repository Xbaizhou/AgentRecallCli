// FTS5 全文检索:trigram MATCH + 短词 LIKE 兜底,按 bm25 相关度排序。
// 为什么需要兜底:trigram 要求查询 ≥3 字符,两字中文词(如「全文」)必须走 LIKE 才能命中(研究 R1)。
// 关键词语义的唯一出处是 ftsQuery——searchContent 与 searchSessions 都从这里走,避免两处分流不一致。
import type { DatabaseSync } from "node:sqlite";
import type { SearchHit } from "../types.js";

export interface FtsQueryResult {
  /** 命中的会话键集合 */
  keys: Set<string>;
  /** 每键最小 bm25(最相关);LIKE 路径恒为 0(无相关度,按会话键稳定序) */
  bestRank: Map<string, number>;
  /** 每键的展示片段(最相关行) */
  snippet: Map<string, string>;
}

export function ftsQuery(db: DatabaseSync, rawQuery: string, maxHits = 10000): FtsQueryResult {
  const keyword = rawQuery.trim();
  const keys = new Set<string>();
  const bestRank = new Map<string, number>();
  const snippet = new Map<string, string>();
  if (keyword === "") return { keys, bestRank, snippet };

  if (keyword.length >= 3) {
    // 双引号包裹为短语字面量:防 FTS5 语法注入,也保证 CJK 连续子串按相邻匹配。
    // bm25 是 FTS5 辅助函数,不能包进 SQL 聚合——逐行取回后在此聚合(每键取最小 rank)。
    const matchQuery = `"${keyword.replaceAll('"', '""')}"`;
    const rows = db
      .prepare(
        `SELECT m.session_key AS session_key, bm25(messages_fts) AS rank,
                snippet(messages_fts, 0, '[', ']', '…', 12) AS snippet
         FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid
         WHERE messages_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(matchQuery, maxHits) as Array<{ session_key: string; rank: number; snippet: string }>;
    for (const r of rows) {
      keys.add(r.session_key);
      const prev = bestRank.get(r.session_key);
      if (prev === undefined || r.rank < prev) {
        bestRank.set(r.session_key, r.rank);
        snippet.set(r.session_key, r.snippet);
      }
    }
    return { keys, bestRank, snippet };
  }

  // LIKE 兜底(%/_ 转义,ESCAPE 声明转义符):短词查询语义优先,全表扫描的性能 trade-off 如实记录
  const like = `%${keyword.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const rows = db
    .prepare(
      `SELECT session_key, substr(content, 1, 40) AS snippet
       FROM messages
       WHERE content LIKE ? ESCAPE '\\'
       ORDER BY session_key, message_index
       LIMIT ?`,
    )
    .all(like, maxHits) as Array<{ session_key: string; snippet: string }>;
  for (const r of rows) {
    keys.add(r.session_key);
    if (!bestRank.has(r.session_key)) bestRank.set(r.session_key, 0);
    if (!snippet.has(r.session_key)) snippet.set(r.session_key, r.snippet);
  }
  return { keys, bestRank, snippet };
}

export function searchContent(db: DatabaseSync, query: string, limit = 50): SearchHit[] {
  const q = ftsQuery(db, query);
  return [...q.keys].slice(0, limit).map((sessionKey) => ({
    sessionKey,
    snippet: q.snippet.get(sessionKey) ?? "",
  }));
}
