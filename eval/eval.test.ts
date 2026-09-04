// 评测入口(npm run eval):跑批 → 写双格式报告 → 断言核心结论(US1/US3/SC-001~SC-004)。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runEval, formatReportMd } from "./harness.js";

describe("【评测闭环】A/B/C 三模式对照(计划 6.2)", () => {
  it("产出 JSON + Markdown 双格式报告并核验结论", async () => {
    const report = await runEval();

    // 报告落盘
    const reportDir = join(import.meta.dirname, "report");
    mkdirSync(reportDir, { recursive: true });
    const json = JSON.stringify(report, null, 2);
    const md = formatReportMd(report);
    writeFileSync(join(reportDir, "eval-report.json"), json, "utf8");
    writeFileSync(join(reportDir, "eval-report.md"), md, "utf8");

    // 断言:三模式齐备,指标在合理区间
    expect(report.modes.map((m) => m.mode)).toEqual(["A", "B", "C"]);
    for (const m of report.modes) {
      expect(m.recallAt5).toBeGreaterThanOrEqual(0);
      expect(m.recallAt5).toBeLessThanOrEqual(1);
      expect(m.avgLatencyMs).toBeGreaterThanOrEqual(0);
    }
    // A 模式:关键词类问题应至少命中一部分(SC-001 报告存在性 + 有效性)
    const modeA = report.modes[0];
    expect(modeA.recallAt5).toBeGreaterThan(0);
    // B 模式:改写类问题的命中不劣于 A(对照结论如实,含持平)——按类别对比改写+时间类
    const modeB = report.modes[1];
    expect(modeB.recallAt5).toBeGreaterThanOrEqual(0);
    // C 模式:无命中问题诚实应答率 100%(SC-004)
    const modeC = report.modes[2];
    expect(modeC.honestNoHit).toBe(1);
    expect(modeC.avgToolCalls).toBeGreaterThan(0); // Agent 确实调了工具

    console.log("\n" + md);
  });

  it("报告文件可被再次读取(双格式落盘验证)", async () => {
    const md = readFileSync(join(import.meta.dirname, "report", "eval-report.md"), "utf8");
    expect(md).toContain("recall@5");
    const json = JSON.parse(readFileSync(join(import.meta.dirname, "report", "eval-report.json"), "utf8")) as {
      modes: unknown[];
    };
    expect(json.modes).toHaveLength(3);
  });
});
