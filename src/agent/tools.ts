// 工具注册表:阶段 3 查询能力的「面向模型的封装」。五元组 = name + description + JSON Schema + zod + execute。
// 模型输出不可信任:arguments 必须先过 zod 校验再执行——校验层是安全边界(计划 4.7)。
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import type { ToolDef } from "./llm.js";
import { searchSessions } from "../core/search.js";
import { getMessages } from "../core/store/messages.js";
import { SESSION_SOURCE_REGISTRY } from "../core/session-sources.js";
import { rewriteQuery } from "./rewrite.js";
import type { SearchFilters } from "../core/search.js";
import type { LlmProvider } from "./llm.js";

export interface ToolContext {
  db: DatabaseSync;
  /** rewrite_query 需要模型改写;其他工具不使用 */
  llm: LlmProvider;
}

export interface ToolResult {
  ok: boolean;
  /** 回喂模型的观察文本(已截断) */
  output: string;
}

export interface Tool<
  S extends z.ZodType = z.ZodType,
> {
  name: string;
  /** 给模型看:何时该用我 */
  description: string;
  /** 给模型看:参数 JSON Schema */
  parameters: Record<string, unknown>;
  /** 安全边界:与 parameters 语义一致,执行前校验 */
  schema: S;
  execute(args: z.infer<S>, ctx: ToolContext): Promise<ToolResult>;
}

/** 观察文本截断:防止长结果膨胀上下文(成本控制,计划 4.7) */
export function truncate(text: string, max = 1200): string {
  return text.length <= max ? text : `${text.slice(0, max)}…(已截断)`;
}

const SEARCH_PARAMS = {
  type: "object",
  properties: {
    query: { type: "string", description: "关键词(消息全文检索)" },
    source: { type: "string", description: "来源过滤,如 codex / claude-cli" },
    afterDaysBack: { type: "integer", description: "时间下界:距今多少天前" },
    limit: { type: "integer", description: "返回条数上限(默认 10)" },
  },
  required: [],
} as const;

const SEARCH_SCHEMA = z.object({
  query: z.string().optional(),
  source: z.string().optional(),
  afterDaysBack: z.number().int().min(0).max(3650).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const MESSAGES_PARAMS = {
  type: "object",
  properties: {
    sessionKey: { type: "string", description: "会话键,必须来自 search_sessions 的观察结果" },
    tail: { type: "integer", description: "取最后 N 条(默认 10)" },
  },
  required: ["sessionKey"],
} as const;

const MESSAGES_SCHEMA = z.object({
  sessionKey: z.string().min(1),
  tail: z.number().int().min(1).max(100).default(10),
});

const REWRITE_PARAMS = {
  type: "object",
  properties: {
    question: { type: "string", description: "用户的原始问题(改写为检索条件)" },
  },
  required: ["question"],
} as const;

const REWRITE_SCHEMA = z.object({ question: z.string().min(1) });

/** 工具集:内置 5 个;新增工具 = 追加一个五元组,不改循环(开闭原则) */
export function createAgentTools(): Array<Tool<any>> {
  return [
    {
      name: "now",
      description: "获取当前时间(ISO)。需要把「昨天/上周」等时间表述锚定为具体日期时调用。",
      parameters: { type: "object", properties: {}, required: [] },
      schema: z.object({}),
      async execute() {
        return { ok: true, output: new Date().toISOString() };
      },
    },
    {
      name: "list_sources",
      description: "列出全部会话来源及能力开关。需要确认有哪些来源可查时调用。",
      parameters: { type: "object", properties: {}, required: [] },
      schema: z.object({}),
      async execute() {
        return {
          ok: true,
          output: SESSION_SOURCE_REGISTRY.map(
            (d) => `${d.id}(${d.label}${d.optionalSetting ? ",需显式开启" : ""})`,
          ).join("; "),
        };
      },
    },
    {
      name: "search_sessions",
      description: "按条件检索历史会话,返回命中会话摘要(sessionKey/标题/时间/条数)。先改写条件再调用。",
      parameters: SEARCH_PARAMS,
      schema: SEARCH_SCHEMA,
      async execute(args, ctx) {
        const filters: SearchFilters = {
          query: args.query,
          source: args.source,
          limit: args.limit ?? 10,
        };
        if (args.afterDaysBack !== undefined) {
          filters.after = Date.now() - args.afterDaysBack * 24 * 60 * 60 * 1000;
        }
        const res = searchSessions(ctx.db, filters);
        if (res.items.length === 0) return { ok: true, output: "(无命中)" };
        return {
          ok: true,
          output: res.items
            .map(
              (it) =>
                `${it.sessionKey} | ${new Date(it.timestamp).toISOString().slice(0, 10)} | ${it.originalTitle} | ${it.messageCount}条${it.snippet ? ` | ${it.snippet}` : ""}`,
            )
            .join("\n"),
        };
      },
    },
    {
      name: "get_messages",
      description: "读取某会话最近的消息(需要 sessionKey,必须来自 search_sessions 的结果)。",
      parameters: MESSAGES_PARAMS,
      schema: MESSAGES_SCHEMA,
      async execute(args, ctx) {
        const messages = getMessages(ctx.db, args.sessionKey, args.tail);
        if (messages.length === 0) return { ok: true, output: `(该会话无消息)` };
        return {
          ok: true,
          output: messages.map((m) => `#${m.index} [${m.role}] ${m.content.slice(0, 160)}`).join("\n"),
        };
      },
    },
    {
      name: "rewrite_query",
      description: "把用户的自然语言问题改写为检索条件(词汇对齐、时间窗)。检索效果不佳时再次调用。",
      parameters: REWRITE_PARAMS,
      schema: REWRITE_SCHEMA,
      async execute(args, ctx) {
        const filters = await rewriteQuery(ctx.llm, args.question);
        return { ok: true, output: `改写结果: ${JSON.stringify(filters)}` };
      },
    },
  ];
}

/** 转为 OpenAI tools 字段 */
export function toToolDefs(tools: Array<Tool<any>>): ToolDef[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
