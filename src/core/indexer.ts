// 增量索引:扫描(仅 stat)→ 按路径对比库内快照 → 未变跳过、已变才解析入库。
// 这才是计划 2.2 的算法:跳过发生在「解析之前」,增量同步省掉的正是重新解析。
// indexer 自身不读文件内容——fs 访问全部经 loader 的 scanSourceFiles/parseScannedFile(宪法 VII)。
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  parseScannedFile,
  scanSourceFiles,
} from "./session-loader.js";
import { getEnabledSources } from "./session-sources.js";
import {
  getSession,
  listIndexedFileMeta,
  listStoredPathsBySource,
  removeSession,
  upsertIndexedSession,
} from "./store/sessions.js";
import type { IndexStatus, SourceLoadStats, SyncOptions } from "./types.js";

export async function syncSessions(
  db: DatabaseSync,
  options: SyncOptions,
): Promise<IndexStatus> {
  const status: IndexStatus = {
    indexed: 0,
    skipped: 0,
    removed: 0,
    conflicts: 0,
    total: 0,
    lastIndexedAt: 0,
    errors: [],
  };
  const rootDir = resolve(options.rootDir);

  // 1. 扫描:只 stat,不解析(增量判定的前提)
  const { files, errors } = await scanSourceFiles({
    rootDir,
    sources: options.sources,
  });
  status.errors.push(...errors);
  const currentPaths = new Set(files.map((f) => f.filePath));

  // 2. 库内快照按「文件路径」索引:路径是解析前唯一可靠的对应关系
  const storedByPath = new Map<string, { sessionKey: string; size: number; mtimeMs: number }>();
  for (const descriptor of getEnabledSources(options.sources)) {
    for (const row of listIndexedFileMeta(db, descriptor.id)) {
      storedByPath.set(row.filePath, {
        sessionKey: row.sessionKey,
        size: row.size,
        mtimeMs: row.mtimeMs,
      });
    }
  }

  // 3. 逐文件判定:未变 → 跳过(不解析);已变/新文件 → 解析后 upsert
  for (const scanned of files) {
    status.total += 1;
    const stored = storedByPath.get(scanned.filePath);
    const force = options.forceReindex?.(scanned.descriptor.id) ?? false;
    const unchanged =
      !force &&
      stored !== undefined &&
      stored.size === scanned.fileSize &&
      stored.mtimeMs === scanned.fileMtimeMs;
    if (unchanged) {
      // 绝大多数文件走这里:省掉的就是重新解析,增量同步的价值所在(SC-001)
      status.skipped += 1;
      continue;
    }
    try {
      const stats: SourceLoadStats = {
        source: scanned.descriptor.id,
        sessionCount: 0,
        messageCount: 0,
        skippedBadLines: 0,
      };
      const loaded = await parseScannedFile(scanned, stats);
      if (loaded === null) {
        status.errors.push(`${scanned.filePath}: 整体无法解析`);
        continue;
      }
      // 键冲突先到先得:同键已被「另一个文件」占用时跳过(文件按路径排序,先到者确定)
      const existing = getSession(db, loaded.session.sessionKey);
      if (existing && existing.filePath !== scanned.filePath) {
        status.conflicts += 1;
        continue;
      }
      upsertIndexedSession(db, loaded.session, loaded.messages);
      status.indexed += 1;
    } catch (err) {
      status.errors.push(`${scanned.filePath}: ${String(err)}`);
    }
  }

  // 4. 删除清理:库内有、当前 rootDir 下磁盘无 → 连同消息与 FTS 项移除。
  //    限定「位于当前 rootDir 之下」:换根目录同步时不会误删其他根的历史记录。
  for (const descriptor of getEnabledSources(options.sources)) {
    const sourcePrefix = resolve(rootDir, descriptor.relativeDir);
    for (const { sessionKey, filePath } of listStoredPathsBySource(db, descriptor.id)) {
      if (!filePath.startsWith(sourcePrefix)) continue;
      if (!currentPaths.has(filePath)) {
        removeSession(db, sessionKey);
        status.removed += 1;
      }
    }
  }

  status.lastIndexedAt = Date.now();
  return status;
}
