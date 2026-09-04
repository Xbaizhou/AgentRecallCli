// 评测 harness:同一数据集跑 A(直接检索)/ B(+改写)/ C(完整 Agent 循环)三模式,汇总指标(计划 6.2)。
// 全部确定性路径(MockLlm/温度 0 等价),重复运行结果稳定;真实 LLM 对照见 README。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { createInMemoryStore } from "../src/core/store/database.js";
import { migrateMiniRecallStore } from "../src/core/store/schema.js";
import { syncSessions } from "../src/core/indexer.js";
import { searchSessions } from "../src/core/search.js";
import { runAgent } from "../src/agent/loop.js";
import { MockLlm } from "../src/agent/llm.js";
import { recallAtK, mrr, outcomeOf, type HitOutcome } from "./metrics.js";

export interface EvalCase {
  id: string;
  category: "keyword" | "paraphrase" | "time" | "nohit";
  question: string;
  rewritten: string;
  afterMs?: number;
  beforeMs?: number;
  expectedSessionKey: string | null;
}

export function loadDataset(): { meta: Record<string, unknown>; cases: EvalCase[] } {
  const raw = JSON.parse(readFileSync(join(import.meta.dirname, "dataset.json"), "utf8")) as {
    meta: Record<string, unknown>;
    cases: EvalCase[];
  };
  return raw;
}

/** 评测库:内存库 + fixtures 全来源同步(workbuddy 需显式传入) */
export function buildEvalDb(): DatabaseSync {
  const db = createInMemoryStore();
  migrateMiniRecallStore(db);
  return db;
}

export async function syncEvalFixtures(db: DatabaseSync): Promise<void> {
  const fixturesDir = join(import.meta.dirname, "..", "fixtures");
  await syncSessions(db, {
    rootDir: fixturesDir,
    sources: ["claude-cli", "codex", "workbuddy-cli"],
  });
}

function call(name: string, args: Record<string, unknown> = {}) {
  return { id: `e-${Math.random().toString(36).slice(2, 8)}`, name, arguments: JSON.stringify(args) };
}

export interface CaseResult {
  id: string;
  orderedKeys: string[];
  outcome: HitOutcome;
  hasExpectation: boolean;
  latencyMs: number;
  toolCalls: number;
  tokens: number;
  honest: boolean;
}

export interface ModeMetrics {
  mode: "A" | "B" | "C";
  /** 指标只对「有期望键」的用例计算(无命中类单独统计诚实应答率) */
  recallAt5: number;
  mrr: number;
  avgToolCalls: number;
  avgTokens: number;
  avgLatencyMs: number;
  honestNoHit: number;
  perCase: CaseResult[];
}

function finalize(mode: ModeMetrics["mode"], perCase: CaseResult[]): ModeMetrics {
  const scored = perCase.filter((p) => p.hasExpectation);
  const n = perCase.length || 1;
  return {
    mode,
    recallAt5: recallAtK(scored.map((p) => p.outcome), 5),
    mrr: mrr(scored.map((p) => p.outcome)),
    avgToolCalls: perCase.reduce((a, p) => a + p.toolCalls, 0) / n,
    avgTokens: perCase.reduce((a, p) => a + p.tokens, 0) / n,
    avgLatencyMs: perCase.reduce((a, p) => a + p.latencyMs, 0) / n,
    honestNoHit: perCase.filter((p) => !p.hasExpectation).length === 0
      ? 1
      : perCase.filter((p) => !p.hasExpectation && p.honest).length / perCase.filter((p) => !p.hasExpectation).length,
    perCase,
  };
}

/** 模式 A:直接关键词检索(问题原句作为 query) */
export function runModeA(db: DatabaseSync, cases: EvalCase[]): ModeMetrics {
  const perCase: CaseResult[] = [];
  for (const c of cases) {
    const started = performance.now();
    const res = searchSessions(db, { query: c.question, after: c.afterMs, before: c.beforeMs, limit: 10 });
    const orderedKeys = res.items.map((it) => it.sessionKey);
    perCase.push({
      id: c.id,
      orderedKeys,
      outcome: outcomeOf(orderedKeys, c.expectedSessionKey),
      hasExpectation: c.expectedSessionKey !== null,
      latencyMs: performance.now() - started,
      toolCalls: 0,
      tokens: 0,
      honest: c.category === "nohit" ? orderedKeys.length === 0 : true,
    });
  }
  return finalize("A", perCase);
}

/** 模式 B:查询改写后检索(改写词由脚本化 LLM 输出,时间窗用数据集绝对值保证确定性) */
export async function runModeB(db: DatabaseSync, cases: EvalCase[]): Promise<ModeMetrics> {
  const perCase: CaseResult[] = [];
  for (const c of cases) {
    const started = performance.now();
    // 真实执行改写链路(MockLlm 按数据集改写词应答);zero-cost
    const llm = new MockLlm({ content: JSON.stringify({ query: c.rewritten }) });
    const rewriteRes = await llm.chat(
      [
        { role: "system", content: "改写器" },
        { role: "user", content: c.question },
      ],
      [],
    );
    const rewritten = (JSON.parse(rewriteRes.content ?? "{}") as { query?: string }).query ?? c.question;
    const res = searchSessions(db, { query: rewritten, after: c.afterMs, before: c.beforeMs, limit: 10 });
    const orderedKeys = res.items.map((it) => it.sessionKey);
    perCase.push({
      id: c.id,
      orderedKeys,
      outcome: outcomeOf(orderedKeys, c.expectedSessionKey),
      hasExpectation: c.expectedSessionKey !== null,
      latencyMs: performance.now() - started,
      toolCalls: 1,
      tokens: rewriteRes.usage.promptTokens + rewriteRes.usage.completionTokens,
      honest: c.category === "nohit" ? orderedKeys.length === 0 : true,
    });
  }
  return finalize("B", perCase);
}

/** 诚实应答文本:不含任何会话键,用于无命中 / 溯源校验重答 */
const HONEST_ANSWER = "观察结果中没有命中任何相关讨论,无法给出结论。";

/**
 * 把绝对时间下界换算成「距今多少天」(search_sessions 只接受相对天数)。
 * 向上取整,保证换算后的下界不晚于 afterMs——否则边界当天的会话会被切掉。
 * 必须在运行时算:数据集若硬编码天数,会随真实时间推移而漂移(时间依赖测试陷阱)。
 */
function daysBackFrom(afterMs: number | undefined): number | undefined {
  if (afterMs === undefined) return undefined;
  return Math.ceil((Date.now() - afterMs) / 86_400_000);
}

/** 模式 C:完整 Agent 决策循环(脚本化 检索→作答 / 无命中→诚实回答) */
export async function runModeC(db: DatabaseSync, cases: EvalCase[]): Promise<ModeMetrics> {
  const perCase: CaseResult[] = [];
  for (const c of cases) {
    const started = performance.now();
    const afterDaysBack = daysBackFrom(c.afterMs);
    const searchArgs = {
      query: c.rewritten,
      ...(afterDaysBack !== undefined ? { afterDaysBack } : {}),
    };
    const script =
      c.category === "nohit"
        ? new MockLlm({ toolCalls: [call("search_sessions", searchArgs)] }, { content: HONEST_ANSWER })
        : new MockLlm(
            { toolCalls: [call("search_sessions", searchArgs)] },
            { content: `结论见 ${c.expectedSessionKey}。` },
            // 第三条:检索未命中时,溯源校验会判「引用了未观察到的键」并要求重答。
            // 补上诚实重答,让未命中如实降级为记 miss,而不是把评测跑崩。
            { content: HONEST_ANSWER },
          );
    const result = await runAgent({ question: c.question, db, llm: script });
    const latencyMs = performance.now() - started;
    // 命中判定:最终答案引用了期望键(溯源校验保证只能引用观察到的键)
    const hit = c.expectedSessionKey !== null && result.answer.includes(c.expectedSessionKey);
    const orderedKeys = hit ? [c.expectedSessionKey as string] : [];
    const honest =
      c.category === "nohit"
        ? !/(?:claude-cli|codex|workbuddy-cli):[\w.-]+/.test(result.answer)
        : true;
    perCase.push({
      id: c.id,
      orderedKeys,
      outcome: outcomeOf(orderedKeys, c.expectedSessionKey),
      hasExpectation: c.expectedSessionKey !== null,
      latencyMs,
      toolCalls: result.usage.toolCalls,
      tokens: result.usage.promptTokens + result.usage.completionTokens,
      honest,
    });
  }
  return finalize("C", perCase);
}

export interface EvalReport {
  generatedAt: string;
  datasetSize: number;
  modes: ModeMetrics[];
}

export async function runEval(): Promise<EvalReport> {
  const { cases } = loadDataset();
  const db = buildEvalDb();
  await syncEvalFixtures(db);
  const modes = [runModeA(db, cases), await runModeB(db, cases), await runModeC(db, cases)];
  return { generatedAt: new Date().toISOString(), datasetSize: cases.length, modes };
}

/** Markdown 对比表(计划 6.2 样式) */
export function formatReportMd(report: EvalReport): string {
  const lines: string[] = [
    "# mini-recall 评测报告",
    "",
    `生成时间: ${report.generatedAt} | 数据集: ${report.datasetSize} 问(fixtures 合成会话,四类)`,
    "",
    "| 模式 | recall@5 | MRR | 平均工具调用 | 平均 token | 平均延迟 | 无命中诚实率 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  const label = { A: "A 直接检索", B: "B +查询改写", C: "C 完整 Agent" } as const;
  for (const m of report.modes) {
    lines.push(
      `| ${label[m.mode]} | ${(m.recallAt5 * 100).toFixed(1)}% | ${m.mrr.toFixed(3)} | ${m.avgToolCalls.toFixed(2)} | ${m.avgTokens.toFixed(1)} | ${m.avgLatencyMs.toFixed(1)}ms | ${(m.honestNoHit * 100).toFixed(0)}% |`,
    );
  }
  lines.push("", "注:数值为当次实测;C 模式延迟/成本显著更高,如实记录(诚实原则)。");
  return lines.join("\n");
}
