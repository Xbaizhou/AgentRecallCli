// ReAct 决策循环:推理 → 行动(调工具)→ 观察(结果入上下文)→ 再推理(计划 4.2②)。
// 停止条件三件套缺一不可:maxSteps、重复调用检测、连续失败熔断;另加幻觉键重答一次(澄清 4)。
import type { DatabaseSync } from "node:sqlite";
import type { ChatMessage, LlmProvider, ToolCall } from "./llm.js";
import { createAgentTools, toToolDefs, truncate, type Tool, type ToolContext } from "./tools.js";
import { buildSystemPrompt } from "./prompt.js";
import type { SearchFilters } from "../core/search.js";

export interface AgentStep {
  step: number;
  /** 本步模型文本(可能有思考/答案) */
  content: string | null;
  /** 本步的工具调用与观察摘要(--trace 语义) */
  toolCalls: Array<{ name: string; args: string; ok: boolean; output: string }>;
}

export interface AgentResult {
  answer: string;
  steps: AgentStep[];
  usage: { toolCalls: number; promptTokens: number; completionTokens: number };
  /** 非正常收尾的原因(maxSteps/熔断/幻觉重答),正常结束为 null */
  stopReason: "final" | "maxSteps" | "circuitBreaker" | null;
}

/** 重复调用检测键:工具名 + 参数稳定序列化(键排序) */
function callKey(call: ToolCall): string {
  let args: unknown;
  try {
    const parsed = JSON.parse(call.arguments) as Record<string, unknown>;
    const sorted = Object.keys(parsed).sort().reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = parsed[k];
      return acc;
    }, {});
    args = sorted;
  } catch {
    args = call.arguments;
  }
  return `${call.name}:${JSON.stringify(args)}`;
}

/** 从观察文本提取会话键(用于答案溯源校验) */
function extractSessionKeys(text: string): Set<string> {
  const keys = new Set<string>();
  const re = /(?:claude-cli|codex|workbuddy-cli):[\w.\-]+/g;
  for (const m of text.matchAll(re)) keys.add(m[0]);
  return keys;
}

export interface RunAgentOptions {
  question: string;
  db: DatabaseSync;
  llm: LlmProvider;
  maxSteps?: number;
  /** 注入检索/反思子例程(默认内置;评测 harness 可替换 B/C 模式) */
  search?: (filters: SearchFilters) => unknown;
}

const MAX_OBSERVATION_CHARS = 1200;
const MAX_CONSECUTIVE_FAILURES = 3;

export async function runAgent(options: RunAgentOptions): Promise<AgentResult> {
  const maxSteps = options.maxSteps ?? 8;
  const tools: Array<Tool<any>> = createAgentTools();
  const toolByName = new Map(tools.map((t) => [t.name, t]));
  const ctx: ToolContext = { db: options.db, llm: options.llm };

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(new Date().toISOString()) },
    { role: "user", content: options.question },
  ];

  const result: AgentResult = {
    answer: "",
    steps: [],
    usage: { toolCalls: 0, promptTokens: 0, completionTokens: 0 },
    stopReason: null,
  };
  const seenCalls = new Set<string>();
  const observedKeys = new Set<string>();
  let consecutiveFailures = 0;
  let hallucinationRetried = false;

  for (let step = 1; step <= maxSteps; step++) {
    const res = await options.llm.chat(messages, toToolDefs(tools));
    result.usage.promptTokens += res.usage.promptTokens;
    result.usage.completionTokens += res.usage.completionTokens;

    const record: AgentStep = { step, content: res.content, toolCalls: [] };
    result.steps.push(record);

    // 无工具调用 → 视为最终答案(ReAct 终止条件)
    if (res.toolCalls.length === 0) {
      const answer = res.content ?? "(空回答)";
      // 溯源校验:答案引用的会话键必须来自观察(澄清 4);重答一次
      const cited = extractSessionKeys(answer);
      const hallucinated = [...cited].filter((k) => !observedKeys.has(k));
      if (hallucinated.length > 0 && !hallucinationRetried) {
        hallucinationRetried = true;
        messages.push({ role: "assistant", content: answer });
        messages.push({
          role: "user",
          content: `你引用了观察结果中不存在的会话键: ${hallucinated.join(", ")}。请仅引用观察过的会话键重答一次。`,
        });
        record.toolCalls.push({ name: "(溯源校验)", args: "-", ok: false, output: `幻觉键: ${hallucinated.join(",")}` });
        continue;
      }
      result.answer = answer;
      result.stopReason = "final";
      return result;
    }

    // 重置连续失败计数当本步有成功调用时(逐调用维护)
    messages.push({ role: "assistant", content: res.content, toolCalls: res.toolCalls });

    for (const call of res.toolCalls) {
      result.usage.toolCalls += 1;
      const key = callKey(call);
      const tool = toolByName.get(call.name);
      let observation: string;
      let ok = false;

      if (seenCalls.has(key)) {
        // 重复调用拦截:拒绝执行并回喂(计划 4.2②)
        observation = "重复调用:相同工具与参数已执行过,请换条件或给出最终答案。";
      } else if (!tool) {
        observation = `未知工具「${call.name}」,可用: ${tools.map((t) => t.name).join(", ")}`;
      } else {
        seenCalls.add(key);
        try {
          const args = tool.schema.parse(JSON.parse(call.arguments || "{}"));
          const executed = await tool.execute(args, ctx);
          ok = executed.ok;
          observation = truncate(executed.output, MAX_OBSERVATION_CHARS);
          for (const k of extractSessionKeys(observation)) observedKeys.add(k);
        } catch (err) {
          // zod 校验失败 / 执行异常 → 工具失败,错误回喂模型(安全边界)
          observation = `工具执行失败: ${String(err)}`;
        }
      }

      consecutiveFailures = ok ? 0 : consecutiveFailures + 1;
      record.toolCalls.push({ name: call.name, args: call.arguments, ok, output: observation.slice(0, 80) });
      messages.push({ role: "tool", content: observation, toolCallId: call.id });

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        // 熔断:连续失败 ≥3,不再把预算耗在重试上(计划 4.2②)
        result.answer = `工具连续失败 ${consecutiveFailures} 次,已熔断退出。已知信息: ${observation.slice(0, 200)}`;
        result.stopReason = "circuitBreaker";
        return result;
      }
    }

    if (step === maxSteps) {
      // 步数上限:强制收尾并带上目前已知信息(计划 4.2②)
      result.answer = `已达步数上限(${maxSteps})。目前已知: ${[...observedKeys].slice(0, 5).join(", ") || "(无观察)"}`;
      result.stopReason = "maxSteps";
      return result;
    }
  }

  // 理论不可达(maxSteps 内必然返回);兜底保证非空 answer
  result.answer = "(循环异常终止)";
  result.stopReason = "maxSteps";
  return result;
}
