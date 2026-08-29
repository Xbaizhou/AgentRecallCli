// 会话加载器:目录扫描 + 适配器调度 + 组装 + 统计。本模块是全项目唯一允许访问文件系统的地方(宪法 VII)。
// 两段式 API 是增量索引的前提(计划 2.2):scanSourceFiles 只 stat 不解析,syncSessions 据此跳过未变文件;
// parseScannedFile 才真正读文件。loadSessions = 扫描 + 全量解析(阶段 1 语义,保持不变)。
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { FORMAT_ADAPTERS } from "./format-adapters.js";
import { getEnabledSources } from "./session-sources.js";
import type {
  LoadedSession,
  LoadOptions,
  LoadResult,
  Session,
  SessionSourceDescriptor,
  SessionSource,
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

/** 扫描产物:文件元数据 + 所属来源描述符(尚未解析) */
export interface ScannedFile {
  descriptor: SessionSourceDescriptor;
  filePath: string;
  fileSize: number;
  fileMtimeMs: number;
}

/** 扫描阶段错误(路径 + 消息):stat 失败等;不中断其余文件 */
export interface ScanResult {
  files: ScannedFile[];
  errors: string[];
}

/** 只 stat、不读内容:增量同步据此在解析前判定跳过 */
export async function scanSourceFiles(options: {
  rootDir: string;
  sources?: SessionSource[];
}): Promise<ScanResult> {
  const rootDir = resolve(options.rootDir);
  const files: ScannedFile[] = [];
  const errors: string[] = [];
  for (const descriptor of getEnabledSources(options.sources)) {
    const paths = await collectFiles(join(rootDir, descriptor.relativeDir), descriptor.filePattern);
    for (const filePath of paths) {
      try {
        const st = await stat(filePath);
        files.push({
          descriptor,
          filePath,
          fileSize: st.size,
          fileMtimeMs: st.mtimeMs,
        });
      } catch (err) {
        errors.push(`${filePath}: ${String(err)}`);
      }
    }
  }
  return { files, errors };
}

/** 组装单个文件:读文本 → 适配器解析 → LoadedSession;null 视为整体无法解析(研究 R7) */
export async function parseScannedFile(
  scanned: ScannedFile,
  stats: SourceLoadStats,
): Promise<LoadedSession | null> {
  const filePath = scanned.filePath;
  const text = await readFile(filePath, "utf8");
  const parsed = FORMAT_ADAPTERS[scanned.descriptor.format](text, filePath);
  if (parsed === null) {
    // 契约约定 null = 整体无法解析;合法 utf-8 文本(含空文件)不会走到这里
    stats.skippedBadLines += 1;
    return null;
  }
  const session: Session = {
    sessionKey: `${scanned.descriptor.id}:${parsed.rawId}`,
    rawId: parsed.rawId,
    source: scanned.descriptor.id,
    projectPath: parsed.projectPath,
    filePath,
    originalTitle: parsed.originalTitle,
    firstQuestion: parsed.firstQuestion,
    timestamp: parsed.timestamp,
    messageCount: parsed.messages.length,
    // 增量判定锚点(阶段 2):来自扫描阶段的 stat,保持 loader 是唯一 fs 模块
    fileSize: scanned.fileSize,
    fileMtimeMs: scanned.fileMtimeMs,
  };
  stats.sessionCount += 1;
  stats.messageCount += parsed.messages.length;
  stats.skippedBadLines += parsed.badLineCount;
  return { session, messages: parsed.messages };
}

/**
 * 加载入口(阶段 1 语义):全部文件解析为 LoadedSession[]。
 * 对相同输入输出完全一致:来源顺序来自注册表,文件顺序来自排序(SC-006)。
 */
export async function loadSessions(options: LoadOptions): Promise<LoadResult> {
  const sessions: LoadedSession[] = [];
  const perSource: SourceLoadStats[] = [];
  const allErrors: string[] = [];

  const { files, errors } = await scanSourceFiles({
    rootDir: options.rootDir,
    sources: options.sources,
  });
  allErrors.push(...errors);

  for (const descriptor of getEnabledSources(options.sources)) {
    // 每个启用来源都产出一行统计(无文件计 0),保证统计完整性(SC-003)
    const stats: SourceLoadStats = {
      source: descriptor.id,
      sessionCount: 0,
      messageCount: 0,
      skippedBadLines: 0,
    };
    for (const scanned of files) {
      if (scanned.descriptor.id !== descriptor.id) continue;
      try {
        const loaded = await parseScannedFile(scanned, stats);
        if (loaded !== null) sessions.push(loaded);
      } catch (err) {
        // 单文件异常显式计入错误列表,不中断整批(阶段 2 FR-007)
        allErrors.push(`${scanned.filePath}: ${String(err)}`);
      }
    }
    perSource.push(stats);
  }

  // 会话按文件路径全局字典序(契约 §4):跨来源也是稳定顺序,进一步保证 SC-006
  sessions.sort((a, b) => (a.session.filePath < b.session.filePath ? -1 : a.session.filePath > b.session.filePath ? 1 : 0));

  return { sessions, stats: { perSource, errors: allErrors } };
}
