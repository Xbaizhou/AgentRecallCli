// 查询改写:把自然语言问题投影到检索系统的查询空间(词汇对齐 + 时间窗解析,计划 4.2③)。
// 模型输出经 zod safeParse;失败降级为 {query: 原句}——记日志不崩溃(计划 4.6 坑点)。
import { z } from "zod";
import type { LlmProvider } from "./llm.js";
import type { SearchFilters } from "../core/search.js";

const REWRITE_OUTPUT = z.object({
  query: z.string().optional(),
  source: z.string().optional(),
  /** 时间下界:距今多少天(「上周」≈ 7) */
  afterDaysBack: z.number().int().min(0).max(3650).optional(),
});

const SYSTEM = `你是检索条件改写器。把用户问题改写为 JSON 检索条件,字段:
- query:检索关键词(对齐系统内术语,如「重排」→「Rerank」)
- source:来源(claude-cli / codex / workbuddy-cli),仅当问题明确限定时给出
- afterDaysBack:时间下界距今天数(「上周」→ 7,「最近三天」→ 3)
只输出 JSON,不要多余文本。无法确定的时间不要编造。`;

/** 改写入口:成功返回结构化条件;任何失败降级为 {query: 原句} */
export async function rewriteQuery(llm: LlmProvider, question: string): Promise<SearchFilters> {
  try {
    const res = await llm.chat(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: question },
      ],
      [],
    );
    const jsonText = (res.content ?? "").trim().replace(/^```(?:json)?/m, "").replace(/```$/m, "").trim();
    const parsed = REWRITE_OUTPUT.safeParse(JSON.parse(jsonText));
    if (!parsed.success) {
      return { query: question };
    }
    const filters: SearchFilters = { limit: 10 };
    filters.query = parsed.data.query ?? question;
    if (parsed.data.source) filters.source = parsed.data.source;
    if (parsed.data.afterDaysBack !== undefined) {
      filters.after = Date.now() - parsed.data.afterDaysBack * 24 * 60 * 60 * 1000;
    }
    return filters;
  } catch {
    // 降级策略:原句关键词直查——比崩溃好,比编造条件诚实
    return { query: question };
  }
}
