// LLM 提供方抽象:chat(messages, tools) 是决策循环唯一的模型交互面。
// OpenAI 兼容实现基于内置 fetch(零依赖);MockLlm 以脚本驱动测试,0 token 可进 CI(宪法 IV/VI)。

/** 工具定义(OpenAI function calling 协议的 tools 字段) */
export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  /** JSON 字符串——模型输出不可信任,执行前必须过 zod 校验 */
  arguments: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  /** assistant 消息携带的调用请求 */
  toolCalls?: ToolCall[];
  /** tool 消息标注对应的调用 id */
  toolCallId?: string;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatResult {
  content: string | null;
  toolCalls: ToolCall[];
  usage: ChatUsage;
}

export interface LlmProvider {
  chat(messages: ChatMessage[], tools: ToolDef[]): Promise<ChatResult>;
}

export interface OpenAiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 默认 0:检索任务要确定性(计划 6.2 对照实验同温度约束) */
  temperature?: number;
}

export function createOpenAiProvider(config: OpenAiConfig): LlmProvider {
  return {
    async chat(messages, tools) {
      const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          temperature: config.temperature ?? 0,
          messages,
          tools: tools.length > 0 ? tools : undefined,
        }),
      });
      if (!res.ok) {
        throw new Error(`LLM 请求失败: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as {
        choices: Array<{ message: { content: string | null; tool_calls?: ToolCall[] } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const message = body.choices[0]?.message;
      return {
        content: message?.content ?? null,
        toolCalls: message?.tool_calls ?? [],
        usage: {
          promptTokens: body.usage?.prompt_tokens ?? 0,
          completionTokens: body.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}

/** MockLlm:按脚本逐个弹出响应;脚本耗尽即抛错(测试设计缺陷的显式信号) */
export class MockLlm implements LlmProvider {
  private queue: Array<Partial<ChatResult>>;
  readonly calls: Array<{ messages: ChatMessage[]; tools: ToolDef[] }> = [];

  constructor(...script: Array<Partial<ChatResult>>) {
    this.queue = [...script];
  }

  async chat(messages: ChatMessage[], tools: ToolDef[]): Promise<ChatResult> {
    this.calls.push({ messages, tools });
    const next = this.queue.shift();
    if (next === undefined) {
      throw new Error("MockLlm 脚本已耗尽:测试脚本与循环步数不匹配");
    }
    return {
      content: next.content ?? null,
      toolCalls: next.toolCalls ?? [],
      usage: next.usage ?? { promptTokens: 10, completionTokens: 5 },
    };
  }
}
