# 接口契约:阶段 2 存储

> 类型出处 src/core/types.ts;阶段 3 查询服务与阶段 5 MCP 只依赖这些签名。

## store/database.ts

```ts
export const DEFAULT_DB_PATH: string;                 // ~/.mini-recall/mini-recall.db
export function openDatabase(path?: string): DatabaseSync;   // 建目录 + WAL + foreign_keys=ON
export function createInMemoryStore(): DatabaseSync;         // :memory: + foreign_keys=ON(测试用)
```

## store/schema.ts

```ts
export function migrateMiniRecallStore(db: DatabaseSync): void;  // 幂等,可重复执行
export function addColumnIfMissing(db: DatabaseSync, table: string, column: string, ddl: string): void;
```

## store/sessions.ts

```ts
export interface UpsertResult { conflict: boolean }   // 同键冲突(先到先得)时 conflict=true 且不写入
export function upsertIndexedSession(db, session: Session, messages: SessionMessage[]): UpsertResult;
export function getSession(db, sessionKey: string): Session | null;
export function listSessions(db, opts?: { limit?: number; offset?: number }): Session[];
export function getIndexedMeta(db, sessionKey: string): { content_indexed_mtime_ms: number; content_indexed_size: number } | null;
export function listStoredPathsBySource(db, source: SessionSource): Array<{ sessionKey: string; filePath: string }>;
export function removeSession(db, sessionKey: string): void;   // 级联消息 + FTS 触发器清理
```

## store/messages.ts

```ts
export function getMessages(db, sessionKey: string, tail?: number): SessionMessage[];  // tail: 取最后 N 条
```

## store/fts.ts

```ts
export function searchContent(db, query: string, limit?: number): SearchHit[];
// 语义:trim 后空串 → [];长度 ≥ 3 → FTS5 trigram MATCH(引号转义包裹);
//      长度 < 3 → LIKE 兜底(%/_ 转义);按 bm25 相关度排序。
```

## indexer.ts

```ts
export function syncSessions(db: DatabaseSync, options: SyncOptions): Promise<IndexStatus>;
// 流程:loadSessions(rootDir, sources) → 逐会话:forceReindex 命中或快照不等 → upsert(indexed++)
//      键冲突 → conflicts++;快照相等 → skipped++;随后按来源做删除清理(removed++),
//      最后 total = indexed+skipped+conflicts,errors 收集单文件异常,lastIndexedAt = Date.now()。
```

## 错误与容错语义

| 场景 | 行为 |
| --- | --- |
| 单文件读取/解析异常 | errors 记「文件路径 + 消息」,继续 |
| 库目录不存在 | openDatabase 递归创建 |
| 迁移重复执行 | 幂等(不存在才建/缺列才补/登记不重复) |
| FTS 查询空串 | 返回 [] |
| 删除的文件不在当前 rootDir 下 | 不清理(无法核验,防误删) |
