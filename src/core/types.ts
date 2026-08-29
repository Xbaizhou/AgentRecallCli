// 领域类型唯一出处:会话、消息、来源描述符、加载选项与统计(阶段 1 内核的类型契约)。
// 字段语义与校验规则见 specs/001-phase1-session-core/data-model.md 与 contracts/core-interfaces.md。

/** 会话来源 ID:一来源一 ID,精确决定解析格式与目录约定 */
export type SessionSource = "claude-cli" | "codex" | "workbuddy-cli";

/** 来源族:同族来源(如 claude 族)共享族行为(合并统计、live 监听等) */
export type SessionSourceFamily = "claude" | "codex" | "workbuddy";

/** 解析格式:决定走哪个格式适配器 */
export type SessionFormat = "claude-jsonl" | "codex-jsonl" | "workbuddy-jsonl";

/** 五项能力开关:上层按声明式能力决定行为,替代 if (source === "...") 散落判断 */
export interface SessionSourceCapabilities {
  /** 是否支持「正在运行」的会话 */
  live: boolean;
  /** 是否支持续聊 */
  resume: boolean;
  /** 是否支持把会话迁移到别的 Agent */
  migrate: boolean;
  /** 是否支持 hook 同步 */
  sessionSync: boolean;
  /** 是否支持「打开对应 App」 */
  openApp: boolean;
}

/** 来源描述符:注册表的一行,静态声明来源的全部事实 */
export interface SessionSourceDescriptor {
  id: SessionSource;
  /** UI 显示名 */
  label: string;
  format: SessionFormat;
  family: SessionSourceFamily;
  /** null = 默认开启;否则为需要用户显式开启的设置键名 */
  optionalSetting: string | null;
  /** 根目录下的相对目录(加载器遍历此处) */
  relativeDir: string;
  /** 文件名匹配模式(加载器按它过滤文件) */
  filePattern: RegExp;
  capabilities: SessionSourceCapabilities;
}

/** 会话:一次 Agent 会话的元数据 */
export interface Session {
  /** 业务标识 = `${source}:${rawId}`;阶段 2 存储层以它为主键(先到先得) */
  sessionKey: string;
  rawId: string;
  source: SessionSource;
  projectPath: string;
  filePath: string;
  originalTitle: string;
  firstQuestion: string;
  /** 会话时间,归一后的毫秒 */
  timestamp: number;
  messageCount: number;
  /** 文件字节数:增量判定锚点之一(阶段 2;由唯一 fs 模块 loader 提供) */
  fileSize: number;
  /** 文件修改时间毫秒:增量判定锚点之二 */
  fileMtimeMs: number;
}

/** 会话消息:最小字段集 = 角色/内容/时间(毫秒) */
export interface SessionMessage {
  /** 文件内序号,从 0 递增 */
  index: number;
  role: string;
  content: string;
  timestamp: number;
}

/** 已加载会话 = 会话元数据 + 消息列表;加载器的产出单元、阶段 2 索引器的输入单元 */
export interface LoadedSession {
  session: Session;
  messages: SessionMessage[];
}

/** 单来源加载统计:三类计数必须显式,禁止静默丢弃(FR-006) */
export interface SourceLoadStats {
  source: SessionSource;
  sessionCount: number;
  messageCount: number;
  /** 坏行数(JSON 解析失败)+ 适配器返回 null 的文件数(1/文件) */
  skippedBadLines: number;
}

/** 加载统计:每个启用来源一条(注册表顺序,无文件也计 0) */
export interface LoadStats {
  perSource: SourceLoadStats[];
  /** 单文件读取/解析异常(路径 + 消息);出现时不中断整批(阶段 2 FR-007) */
  errors: string[];
}

/** 加载选项:sources 未传时默认仅启用 optionalSetting === null 的来源(澄清结论) */
export interface LoadOptions {
  rootDir: string;
  sources?: SessionSource[];
}

/** 加载结果:sessions 按文件路径字典序,保证相同输入结果完全一致(SC-006) */
export interface LoadResult {
  sessions: LoadedSession[];
  stats: LoadStats;
}

/** 适配器产出:会话元数据(扁平字段)+ 消息 + 坏行计数 */
export interface ParsedFile {
  rawId: string;
  projectPath: string;
  originalTitle: string;
  firstQuestion: string;
  /** 会话时间 = 第一条消息的归一毫秒;无消息则 0 */
  timestamp: number;
  messages: SessionMessage[];
  badLineCount: number;
}

/** 同步统计:全部计数显式输出,禁止静默丢弃(FR-006) */
export interface IndexStatus {
  /** 本次重新入库的会话数(文件已变或 forceReindex 命中) */
  indexed: number;
  /** 快照未变被跳过的会话数(未重新解析) */
  skipped: number;
  /** 磁盘文件已删除而被清理的库内记录数 */
  removed: number;
  /** 同键冲突被「先到先得」跳过的会话数 */
  conflicts: number;
  total: number;
  lastIndexedAt: number;
  /** 单文件异常(路径 + 消息);出现时不中断整批 */
  errors: string[];
}

/** 同步选项:forceReindex 命中的来源无视快照判定强制重建(增量漏检的兜底通道) */
export interface SyncOptions {
  rootDir: string;
  sources?: SessionSource[];
  forceReindex?: (source: SessionSource) => boolean;
}

/** 全文检索命中:会话键 + 带标记的上下文片段(bm25 相关度排序) */
export interface SearchHit {
  sessionKey: string;
  snippet: string;
}
