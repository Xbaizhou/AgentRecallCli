// 会话加载器:目录遍历 + 适配器调度 + 组装 + 统计。本模块是全项目唯一允许访问文件系统的地方(宪法 VII)。
// 格式解析全部委托纯函数适配器;这里只做「找文件、读文件、组装、计数」。
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { FORMAT_ADAPTERS } from "./format-adapters.js";
import { getEnabledSources } from "./session-sources.js";
import type {
  LoadedSession,
  LoadOptions,
  LoadResult,
  Session,
  SessionSourceDescriptor,
  SourceLoadStats,
} from "./types.js";

/** 递归收集匹配 filePattern 的文件,按完整路径排序保证确定性(研究 R10) */
async function collectFiles(dir: string, filePattern: RegExp): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // 目录不存在(来源从未产生过数据)→ 计 0 而不是抛错(契约 §4)
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full, filePattern)));
    } else if (entry.isFile() && filePattern.test(entry.name)) {
      files.push(full);
    }
  }
  return files.sort();
}

/** 组装单个文件:读文本 → 适配器解析 → LoadedSession;null 视为 1 个坏文件计入统计(研究 R7) */
async function loadFile(
  descriptor: SessionSourceDescriptor,
  filePath: string,
  stats: SourceLoadStats,
): Promise<LoadedSession | null> {
  const text = await readFile(filePath, "utf8");
  const parsed = FORMAT_ADAPTERS[descriptor.format](text, filePath);
  if (parsed === null) {
    // 契约约定 null = 整体无法解析;合法 utf-8 文本(含空文件)不会走到这里
    stats.skippedBadLines += 1;
    return null;
  }
  const session: Session = {
    sessionKey: `${descriptor.id}:${parsed.rawId}`,
    rawId: parsed.rawId,
    source: descriptor.id,
    projectPath: parsed.projectPath,
    filePath,
    originalTitle: parsed.originalTitle,
    firstQuestion: parsed.firstQuestion,
    timestamp: parsed.timestamp,
    messageCount: parsed.messages.length,
  };
  stats.sessionCount += 1;
  stats.messageCount += parsed.messages.length;
  stats.skippedBadLines += parsed.badLineCount;
  return { session, messages: parsed.messages };
}

/**
 * 加载入口:启用来源(注册表顺序)→ 逐来源遍历 <rootDir>/<relativeDir> → 组装与统计。
 * 对相同输入输出完全一致:来源顺序来自注册表,文件顺序来自排序(SC-006)。
 */
export async function loadSessions(options: LoadOptions): Promise<LoadResult> {
  const descriptors = getEnabledSources(options.sources);
  const rootDir = resolve(options.rootDir);
  const sessions: LoadedSession[] = [];
  const perSource: SourceLoadStats[] = [];

  for (const descriptor of descriptors) {
    // 每个启用来源都产出一行统计(无文件计 0),保证统计完整性(SC-003)
    const stats: SourceLoadStats = {
      source: descriptor.id,
      sessionCount: 0,
      messageCount: 0,
      skippedBadLines: 0,
    };
    const files = await collectFiles(join(rootDir, descriptor.relativeDir), descriptor.filePattern);
    for (const filePath of files) {
      const loaded = await loadFile(descriptor, filePath, stats);
      if (loaded !== null) sessions.push(loaded);
    }
    perSource.push(stats);
  }

  // 会话按文件路径全局字典序(契约 §4):跨来源也是稳定顺序,进一步保证 SC-006
  sessions.sort((a, b) => (a.session.filePath < b.session.filePath ? -1 : a.session.filePath > b.session.filePath ? 1 : 0));

  return { sessions, stats: { perSource } };
}
