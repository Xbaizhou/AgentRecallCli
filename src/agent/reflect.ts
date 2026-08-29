// 结果反思:显式评估「检索结果是否足以回答」并给出改进方向——与盲目重试的区别就在这里(计划 4.2④)。
import { z } from "zod";
import type { LlmProvider } from "./llm.js";
import type { SessionSummary } from "../core/search.js";

const REFLECT_OUTPUT = z.object({
  verdict: z.enum(["sufficient", "insufficient"]),
  reason: z.string().min(1),
});

const SYSTEM = `你是检索结果评估器。判断给定结果是否足以回答问题,输出 JSON:
- verdict: "sufficient"(结果覆盖问题的时间范围、包含问题中的实体/技术词)或 "insufficient"
- reason: 一句话理由;insufficient 时必须给出具体改进方向(改时间过滤/换关键词/拆子问题)
只输出 JSON。`;

export interface ReflectVerdict {
  verdict: "sufficient" | "insufficient";
  reason: string;
}

/** 反思入口:解析失败按「足以回答」降级(有 maxSteps 兜底,避免死循环)——澄清 3 */
export async function reflect(
  llm: LlmProvider,
  question: string,
  results: SessionSummary[],
): Promise<ReflectVerdict> {
  try {
    const res = await llm.chat(
      [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `问题: ${question}\n检索结果(${results.length} 条):\n${results
            .map((r) => `- ${r.sessionKey} ${r.originalTitle} ${r.firstQuestion}`)
            .join("\n")}`,
        },
      ],
      [],
    );
    const parsed = REFLECT_OUTPUT.safeParse(JSON.parse((res.content ?? "").trim()));
    if (!parsed.success) {
      return { verdict: "sufficient", reason: "反思输出解析失败,按足以回答处理(maxSteps 兜底)" };
    }
    return parsed.data;
  } catch {
    return { verdict: "sufficient", reason: "反思调用失败,按足以回答处理(maxSteps 兜底)" };
  }
}
