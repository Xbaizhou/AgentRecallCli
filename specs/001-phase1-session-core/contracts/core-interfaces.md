# 接口契约:阶段 1 领域内核

> 本特性对外暴露的是 **TypeScript 接口层契约**(library 型项目)。阶段 2(索引器)、阶段 3(查询/契约层)、阶段 4(Agent 工具)都以此为依赖面,签名字段一旦被下游引用即冻结,变更需走修订。
> 类型唯一出处:`src/core/types.ts`(Zod 契约层属阶段 3,本阶段不引入)。

## 1. 类型契约(`src/core/types.ts`)

```ts
export type SessionSource = "claude-cli" | "codex" | "workbuddy-cli";
export type SessionSourceFamily = "claude" | "codex" | "workbuddy";
export type SessionFormat = "claude-jsonl" | "codex-jsonl" | "workbuddy-jsonl";

export interface SessionSourceCapabilities {
  live: boolean; resume: boolean; migrate: boolean;
  sessionSync: boolean; openApp: boolean;
}

export interface SessionSourceDescriptor {
  id: SessionSource;
  label: string;
  format: SessionFormat;
  family: SessionSourceFamily;
  optionalSetting: string | null;   // null = 默认开启
  relativeDir: string;              // rootDir 下的相对目录
  filePattern: RegExp;              // 文件名匹配
  capabilities: SessionSourceCapabilities;
}

export interface Session {
  sessionKey: string; rawId: string; source: SessionSource;
  projectPath: string; filePath: string;
  originalTitle: string; firstQuestion: string;
  timestamp: number;                // 毫秒
  messageCount: number;
}

export interface SessionMessage {
  index: number; role: string; content: string; timestamp: number; // 毫秒
}

export interface LoadedSession { session: Session; messages: SessionMessage[]; }

export interface SourceLoadStats {
  source: SessionSource; sessionCount: number;
  messageCount: number; skippedBadLines: number;
}
export interface LoadStats { perSource: SourceLoadStats[]; }

export interface LoadOptions { rootDir: string; sources?: SessionSource[]; }
export interface LoadResult { sessions: LoadedSession[]; stats: LoadStats; }

export interface ParsedFile {
  rawId: string; projectPath: string; originalTitle: string;
  firstQuestion: string; timestamp: number;         // 毫秒
  messages: SessionMessage[]; badLineCount: number;
}
```

## 2. 注册表契约(`src/core/session-sources.ts`)

```ts
export const SESSION_SOURCE_REGISTRY: readonly SessionSourceDescriptor[];
// 内置 3 项:claude-cli / codex(默认开启)、workbuddy-cli(需显式开启)

export function getEnabledSources(sources?: SessionSource[]): readonly SessionSourceDescriptor[];
// sources 未传 → 仅返回 optionalSetting === null 的描述符(注册表顺序);
// 传入未知来源 ID → 抛错(防御拼写错误,不静默忽略)。

export function validateSessionSourceRegistry(): void;
// 不变量自检:字段完整性 + 类型合法 + ID 唯一;违规抛 Error 并列出「来源 + 字段 + 问题」。
```

## 3. 适配器契约(`src/core/format-adapters.ts`)

```ts
export type FormatAdapter = (text: string, filePath: string) => ParsedFile | null;

export const FORMAT_ADAPTERS: Record<SessionFormat, FormatAdapter>;
// 纯函数:不碰 fs、不做遍历、不依赖全局可变状态;
// 输入合法 utf-8 文本(含空)永不返回 null;null 仅表示「整体无法解析」。

export function normalizeTimestampMs(value: unknown): number;
// 归一规则见 data-model;边界测试锁定。
```

## 4. 加载器契约(`src/core/session-loader.ts`)

```ts
export async function loadSessions(options: LoadOptions): Promise<LoadResult>;
// 唯一允许访问文件系统的模块(宪法 VII)。
// 行为:
//   1. getEnabledSources(options.sources) 取启用来源(注册表顺序);
//   2. 逐来源遍历 <rootDir>/<relativeDir>(递归,withFileTypes),filePattern 过滤;
//   3. 每文件:readFile(utf8) → FORMAT_ADAPTERS[format](text, path);
//      null → skippedBadLines += 1;否则组装 LoadedSession 并累计统计;
//   4. sessions 按文件路径字典序;stats 含全部启用来源(无文件计 0);
//   5. 目录不存在 → 该来源计 0,不抛错;相同输入结果完全一致(确定性)。
```

## 5. 错误与容错语义(契约级)

| 场景 | 契约行为 |
| --- | --- |
| 单行 JSON.parse 失败 | 跳过该行,`badLineCount += 1`,继续 |
| 空行 / 纯空白行 | 跳过,**不计**坏行 |
| 合法 JSON 但非消息行(unknown type) | 忽略,不计坏行 |
| BOM 开头 | 剥离后正常解析 |
| 空文件 | 产出 0 消息会话,计入统计 |
| 整文件全坏 | 产出 0 消息会话,`badLineCount === 总行数` |
| 来源目录不存在 | 该来源统计计 0,不抛错 |
| 未知来源 ID(显式传入) | 抛错(不静默) |
| 重复会话标识 | 不覆盖不合并,按文件各自产出 |
