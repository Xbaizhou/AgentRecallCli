// MCP 工具注册:复用阶段 4 工具五元组(name/description/parameters),只暴露只读四件套。
// rewrite_query 依赖 LLM,不属于零依赖 server 的职责(澄清 3)。tools/call 走同一 zod 校验。
import type { DatabaseSync } from "node:sqlite";
import { createAgentTools, type Tool, type ToolContext } from "../agent/tools.js";
import type { LlmProvider } from "../agent/llm.js";

export interface McpToolDesc {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** MCP 对外只读工具名单 */
export const MCP_TOOL_NAMES = ["search_sessions", "get_messages", "list_sources", "now"] as const;

/** server 无 LLM:rewrite 等依赖模型的工具不会被暴露,此桩只为满足 ToolContext 类型 */
const llmStub: LlmProvider = {
  chat: async () => {
    throw new Error("MCP server 不提供 LLM 能力");
  },
};

function readonlyTools(): Array<Tool<any>> {
  return createAgentTools().filter((t) => (MCP_TOOL_NAMES as readonly string[]).includes(t.name));
}

export function mcpToolList(): McpToolDesc[] {
  return readonlyTools().map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.parameters,
  }));
}

export interface McpCallResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/** 统一调用入口:未知工具/非法参数 → isError content(不崩进程,由宿主模型看到错误文本) */
export async function callTool(db: DatabaseSync, name: string, args: unknown): Promise<McpCallResult> {
  const tool = readonlyTools().find((t) => t.name === name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `未知工具「${name}」,可用: ${MCP_TOOL_NAMES.join(", ")}` }],
      isError: true,
    };
  }
  try {
    const parsed = tool.schema.parse(args ?? {});
    const ctx: ToolContext = { db, llm: llmStub };
    const result = await tool.execute(parsed, ctx);
    return {
      content: [{ type: "text", text: result.output }],
      isError: !result.ok,
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `工具参数或执行错误: ${String(err)}` }],
      isError: true,
    };
  }
}
