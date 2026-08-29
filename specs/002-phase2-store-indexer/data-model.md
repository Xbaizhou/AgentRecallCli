# 领域模型:阶段 2 存储

> 类型追加进 src/core/types.ts(唯一出处);表结构与接口签名见 contracts/store-interfaces.md。

## 表结构

```sql
sessions(session_key TEXT PRIMARY KEY, raw_id, source, project_path, file_path,
         original_title, first_question, timestamp,
         file_mtime_ms REAL, file_size INTEGER,          -- 增量判定锚点(loader 提供)
         message_count INTEGER DEFAULT 0,
         indexed_at INTEGER DEFAULT 0,
         content_indexed_mtime_ms REAL DEFAULT 0,        -- 上次内容索引快照
         content_indexed_size INTEGER DEFAULT 0)
messages(session_key, message_index, role, content, timestamp,
         PRIMARY KEY(session_key, message_index),
         FOREIGN KEY(session_key) REFERENCES sessions ON DELETE CASCADE)
messages_fts  -- FTS5 external content on messages.content, tokenize='trigram'
              -- 触发器:AFTER INSERT/DELETE 自动维护
data_migrations(name TEXT PRIMARY KEY, applied_at INTEGER)  -- 一次性迁移登记
```

## 类型追加(types.ts)

```ts
interface Session { ...fileSize: number; fileMtimeMs: number; }   // loader stat 提供
interface IndexStatus { indexed: number; skipped: number; removed: number;
                        conflicts: number; total: number; lastIndexedAt: number; errors: string[]; }
interface SearchHit { sessionKey: string; snippet: string; }
interface SyncOptions { rootDir: string; sources?: SessionSource[];
                        forceReindex?: (source: SessionSource) => boolean; }
```

## 关键语义

- **增量判定**:`快照相等(size+mtime) → skipped`;否则重解析 + 更新快照;forceReindex 命中来源 → 无视快照。
- **upsert 幂等**:`INSERT ... ON CONFLICT(session_key) DO UPDATE` + `DELETE FROM messages WHERE session_key=?` 后重插(FTS 触发器随之更新,无残留)。
- **删除清理**:按来源枚举库内 file_path,位于当前 rootDir 下但磁盘已不存在 → 删会话行(消息级联、FTS 触发器清理),计 removed。
- **键冲突**:同来源同 session_key 后到者跳过,计 conflicts(先到先得,文件按路径排序保证确定性)。
- **错误隔离**:单文件异常入 errors[],不中断整批。

## 状态迁移

```text
未索引 --首次同步--> 已索引(快照=锚点)
已索引 --文件未变--> skipped(快照不动)
已索引 --文件已变/forceReindex--> 重新 upsert(快照更新)
已索引 --文件删除--> removed(整行消失)
```
