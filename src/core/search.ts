// 查询服务:检索语义(过滤/排序/分页/统计)——与存储层的持久化语义分离(计划 3.7)。
// 关键词(FTS5 倒排)与结构化条件(SQL)两路在内存求交:候选集量级可控,换取实现直观与排序统一(研究 R1)。
import type { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";

export interface SearchFilters {
  query?: string;
  source?: string;
  /** 项目路径前缀 */
  project?: string;
  /** 毫秒,闭区间 */
  after?: number;
  before?: number;
  limit?: number;
  offset?: number;
  sort?: "time" | "relevance";
}

export interface SessionSummary {
  sessionKey: string;
  source: string;
  projectPath: string;
  filePath: string;
  originalTitle: string;
  firstQuestion: string;
  timestamp: number;
  messageCount: number;
  /** 关键词命中时提供带标记的片段 */
  snippet?: string;
}

export interface SearchResponse {
  items: SessionSummary[];
  /** 过滤后全量计数——与 limit 解耦(计划 3.6 坑点:total 用独立统计) */
  total: number;
  tookMs: number;
}

interface SessionRow {
  session_key: string;
  source: string;
  project_path: string;
  file_path: string;
  original_title: string;
  first_question: string;
  timestamp: number;
  message_count: number;
}

/** 关键词候选:每键取最小 bm25(最相关),并保留首条命中片段用于渲染 */
function ftsCandidates(
  db: DatabaseSync,
  query: string,
): { keys: Set<string>; bestRank: Map<string, number>; snippet: Map<string, string> } {
  const matchQuery = `"${query.replaceAll('"', '""')}"`;
  // bm25 是 FTS5 辅助函数,不能包进 SQL 聚合——逐行取回后在此聚合(每键取最小 rank)
  const rows = db
    .prepare(
      `SELECT m.session_key AS session_key, bm25(messages_fts) AS rank,
              snippet(messages_fts, 0, '[', ']', '…', 12) AS snippet
       FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid
       WHERE messages_fts MATCH ?`,
    )
    .all(matchQuery) as Array<{ session_key: string; rank: number; snippet: string }>;

  const keys = new Set<string>();
  const bestRank = new Map<string, number>();
  const snippet = new Map<string, string>();
  for (const r of rows) {
    keys.add(r.session_key);
    const prev = bestRank.get(r.session_key);
    if (prev === undefined || r.rank < prev) {
      bestRank.set(r.session_key, r.rank);
      snippet.set(r.session_key, r.snippet); // 最相关行的片段
    }
  }
  return { keys, bestRank, snippet };
}

export function searchSessions(db: DatabaseSync, filters: SearchFilters): SearchResponse {
  const started = performance.now();
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  const sort = filters.sort ?? "time";
  const keyword = filters.query?.trim() || undefined;

  // 结构化条件走 SQL
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (filters.source) {
    where.push("source = ?");
    params.push(filters.source);
  }
  if (filters.project) {
    where.push("project_path LIKE ? ESCAPE '\\'");
    params.push(`${filters.project.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
  }
  if (filters.after !== undefined) {
    where.push("timestamp >= ?");
    params.push(filters.after);
  }
  if (filters.before !== undefined) {
    where.push("timestamp <= ?");
    params.push(filters.before);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT session_key, source, project_path, file_path, original_title, first_question, timestamp, message_count FROM sessions ${whereSql}`)
    .all(...params) as unknown as SessionRow[];

  // 关键词路走 FTS,两路求交
  let candidates = rows;
  let bestRank: Map<string, number> | undefined;
  let snippets: Map<string, string> | undefined;
  if (keyword !== undefined) {
    const fts = ftsCandidates(db, keyword);
    candidates = rows.filter((r) => fts.keys.has(r.session_key));
    bestRank = fts.bestRank;
    snippets = fts.snippet;
  }

  // 排序:relevance 按 bm25 升序(越小越相关);无关键词时退化为时间倒序(澄清 3)
  const sorted = [...candidates];
  if (sort === "relevance" && bestRank) {
    sorted.sort((a, b) => (bestRank.get(a.session_key) ?? 0) - (bestRank.get(b.session_key) ?? 0));
  } else {
    sorted.sort((a, b) => b.timestamp - a.timestamp);
  }

  const items: SessionSummary[] = sorted.slice(offset, offset + limit).map((r) => ({
    sessionKey: r.session_key,
    source: r.source,
    projectPath: r.project_path,
    filePath: r.file_path,
    originalTitle: r.original_title,
    firstQuestion: r.first_question,
    timestamp: r.timestamp,
    messageCount: r.message_count,
    snippet: snippets?.get(r.session_key),
  }));

  return { items, total: sorted.length, tookMs: performance.now() - started };
}

export interface SessionStats {
  perSource: Array<{ source: string; count: number }>;
  /** 按日(本地 YYYY-MM-DD)的会话数分布 */
  perDay: Array<{ day: string; count: number }>;
  tookMs: number;
}

export function sessionStats(db: DatabaseSync): SessionStats {
  const started = performance.now();
  const perSource = db
    .prepare("SELECT source, count(*) AS count FROM sessions GROUP BY source ORDER BY source")
    .all() as Array<{ source: string; count: number }>;
  // 毫秒时间戳转秒给 strftime:按本地日分组(会话时间是 UTC 毫秒,取本地日便于阅读)
  const perDay = db
    .prepare(
      "SELECT date(timestamp / 1000, 'unixepoch', 'localtime') AS day, count(*) AS count FROM sessions GROUP BY day ORDER BY day",
    )
    .all() as Array<{ day: string; count: number }>;
  return { perSource, perDay, tookMs: performance.now() - started };
}
