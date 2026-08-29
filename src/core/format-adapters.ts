// 格式适配器:按来源格式把 jsonl 文本解析为领域对象。纯函数——不碰文件系统、不做目录遍历(宪法 VII)。
// 目录遍历的分工在 session-loader;两者分开,格式横向增长、目录约定纵向变化互不影响。
import { basename } from "node:path";
import type { ParsedFile, SessionFormat, SessionMessage } from "./types.js";

export type FormatAdapter = (text: string, filePath: string) => ParsedFile | null;

type UnknownRecord = Record<string, unknown>;

const isRecord = (v: unknown): v is UnknownRecord =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * 时间戳归一(研究 R1):统一毫秒。数值/数字串 < 10^12 视为秒 ×1000(10^12 阈值可区分
 * 秒级 10^9 与毫秒级 10^12,对会话数据足够);ISO 字符串走 Date.parse;非法输入返回 0——
 * 元数据缺失不该丢掉整条消息,所以不判坏行。
 */
export function normalizeTimestampMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const n = Number(value);
    if (value.trim() !== "" && Number.isFinite(n)) {
      return n < 1e12 ? n * 1000 : n;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

/** BOM 剥离:Windows 编辑器常给文件头加 U+FEFF,不清掉第一行 JSON.parse 必失败(计划 1.6 坑点) */
function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

/** 逐行解析结果:ok=false 即坏行 */
type ParsedLine = { ok: true; value: unknown } | { ok: false };

/**
 * 逐行解析:坏行的定义只与「能否 JSON.parse」相关(研究 R3)。
 * 半行损坏(Agent 写到一半崩溃)→ 计坏行跳过;空行 → 跳过但不计;其余交给调用方按语义处理。
 */
function parseJsonLines(text: string): ParsedLine[] {
  return text.split(/\r?\n/).flatMap((line): ParsedLine[] => {
    const trimmed = line.trim();
    if (trimmed === "") return [];
    try {
      return [{ ok: true, value: JSON.parse(trimmed) as unknown }];
    } catch {
      return [{ ok: false }];
    }
  });
}

/** 文件名(去扩展名):rawId 的回退值,也是 originalTitle 的简化来源(研究 R6) */
function titleFromPath(filePath: string): string {
  return basename(filePath, ".jsonl");
}

/** 第一条 user 消息即 firstQuestion;没有 user 消息(如纯系统会话)则为空串 */
function firstUserQuestion(messages: SessionMessage[]): string {
  return messages.find((m) => m.role === "user")?.content ?? "";
}

/** 组装 ParsedFile:rawId 回退文件名;会话时间取第一条消息(无消息则 0) */
function buildParsedFile(input: {
  rawId: string | null;
  projectPath: string;
  filePath: string;
  messages: SessionMessage[];
  badLineCount: number;
}): ParsedFile {
  const title = titleFromPath(input.filePath);
  return {
    rawId: input.rawId ?? title,
    projectPath: input.projectPath,
    originalTitle: title,
    firstQuestion: firstUserQuestion(input.messages),
    timestamp: input.messages[0]?.timestamp ?? 0,
    messages: input.messages,
    badLineCount: input.badLineCount,
  };
}

/** claude 的 message.content 兼容字符串与 [{type:"text",text}] 数组两种形态 */
function claudeContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        isRecord(block) && typeof block.text === "string" ? block.text : "",
      )
      .join("");
  }
  return "";
}

const claudeAdapter: FormatAdapter = (text, filePath) => {
  const messages: SessionMessage[] = [];
  let badLineCount = 0;
  let rawId: string | null = null;
  let projectPath = "";
  for (const line of parseJsonLines(stripBom(text))) {
    if (!line.ok) {
      badLineCount += 1;
      continue;
    }
    const rec = line.value;
    if (!isRecord(rec)) continue; // 合法 JSON 但非对象:忽略,不计坏行
    // sessionId / cwd 从首个携带它们的行提取(真实文件每行都带,取首见即可)
    if (rawId === null && typeof rec.sessionId === "string") rawId = rec.sessionId;
    if (projectPath === "" && typeof rec.cwd === "string") projectPath = rec.cwd;
    if (rec.type !== "user" && rec.type !== "assistant") continue; // summary 等行:合法但非消息
    const message = isRecord(rec.message) ? rec.message : null;
    if (!message) continue;
    messages.push({
      index: messages.length,
      role: typeof message.role === "string" ? message.role : String(rec.type),
      content: claudeContentToText(message.content),
      timestamp: normalizeTimestampMs(rec.timestamp),
    });
  }
  return buildParsedFile({ rawId, projectPath, filePath, messages, badLineCount });
};

const codexAdapter: FormatAdapter = (text, filePath) => {
  const messages: SessionMessage[] = [];
  let badLineCount = 0;
  let rawId: string | null = null;
  let projectPath = "";
  for (const line of parseJsonLines(stripBom(text))) {
    if (!line.ok) {
      badLineCount += 1;
      continue;
    }
    const rec = line.value;
    if (!isRecord(rec)) continue;
    if (rec.type === "session_meta") {
      if (rawId === null && typeof rec.session_id === "string") rawId = rec.session_id;
      if (projectPath === "" && typeof rec.cwd === "string") projectPath = rec.cwd;
      continue; // meta 行只供元数据,不是消息
    }
    if (rec.type !== "response_item") continue;
    const payload = isRecord(rec.payload) ? rec.payload : null;
    if (!payload) continue;
    messages.push({
      index: messages.length,
      role: typeof payload.role === "string" ? payload.role : "",
      content: typeof payload.content === "string" ? payload.content : "",
      timestamp: normalizeTimestampMs(rec.timestamp),
    });
  }
  return buildParsedFile({ rawId, projectPath, filePath, messages, badLineCount });
};

const workbuddyAdapter: FormatAdapter = (text, filePath) => {
  const messages: SessionMessage[] = [];
  let badLineCount = 0;
  for (const line of parseJsonLines(stripBom(text))) {
    if (!line.ok) {
      badLineCount += 1;
      continue;
    }
    const rec = line.value;
    // workbuddy 是最简格式:每行即一条消息;缺 role/text 的行视为非消息行忽略
    if (!isRecord(rec) || typeof rec.role !== "string" || typeof rec.text !== "string") continue;
    messages.push({
      index: messages.length,
      role: rec.role,
      content: rec.text,
      timestamp: normalizeTimestampMs(rec.ts),
    });
  }
  // workbuddy 文件内无 rawId 字段,统一回退文件名(研究 R6)
  return buildParsedFile({ rawId: null, projectPath: "", filePath, messages, badLineCount });
};

/** 按格式取适配器的唯一入口;新增格式 = types.ts 加枚举 + 这里加一项,无分支扩散 */
export const FORMAT_ADAPTERS: Record<SessionFormat, FormatAdapter> = {
  "claude-jsonl": claudeAdapter,
  "codex-jsonl": codexAdapter,
  "workbuddy-jsonl": workbuddyAdapter,
};
