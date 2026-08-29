// 会话加载器测试:目录遍历、组装与统计契约。文件系统一律 mkdtemp 临时目录,绝不触碰真实会话目录(宪法 VI)。
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FORMAT_ADAPTERS } from "./format-adapters.js";
import { loadSessions } from "./session-loader.js";

const tmpRoots: string[] = [];

async function makeTmpRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mini-recall-"));
  tmpRoots.push(dir);
  return dir;
}

// 测试结束后清理临时目录(WAL 约定同样适用于 tmp:用完即收)
afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  for (const dir of tmpRoots.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

const CLAUDE_LINE =
  '{"type":"user","sessionId":"s-1","cwd":"/p","timestamp":"2026-08-01T10:00:00.000Z","message":{"role":"user","content":"问题"}}';

describe("loadSessions:加载、组装与统计(US1)", () => {
  it("遍历多来源目录并组装 LoadedSession 与统计", async () => {
    const root = await makeTmpRoot();
    await mkdir(join(root, "claude"), { recursive: true });
    await mkdir(join(root, "codex"), { recursive: true });
    await writeFile(join(root, "claude", "a.jsonl"), CLAUDE_LINE, "utf8");
    await writeFile(
      join(root, "codex", "rollout-x.jsonl"),
      '{"type":"session_meta","session_id":"roll-1","cwd":"/c","timestamp":1754035200000}\n',
      "utf8",
    );

    const { sessions, stats } = await loadSessions({ rootDir: root });
    expect(sessions).toHaveLength(2);
    const claudeSession = sessions.find((s) => s.session.source === "claude-cli")!;
    expect(claudeSession.session.sessionKey).toBe("claude-cli:s-1");
    expect(claudeSession.session.messageCount).toBe(1);
    expect(claudeSession.messages[0].content).toBe("问题");

    expect(stats.perSource.map((s) => s.source)).toEqual(["claude-cli", "codex"]);
    const claudeStats = stats.perSource.find((s) => s.source === "claude-cli")!;
    expect(claudeStats).toEqual({ source: "claude-cli", sessionCount: 1, messageCount: 1, skippedBadLines: 0 });
  });

  it("无文件的启用来源统计计 0,目录不存在不抛错", async () => {
    const root = await makeTmpRoot();
    const { sessions, stats } = await loadSessions({ rootDir: root });
    expect(sessions).toHaveLength(0);
    expect(stats.perSource.map((s) => s.source)).toEqual(["claude-cli", "codex"]);
    expect(stats.perSource.every((s) => s.sessionCount === 0 && s.messageCount === 0 && s.skippedBadLines === 0)).toBe(true);
  });

  it("相同输入两次加载结果完全一致(确定性,SC-006)", async () => {
    const root = await makeTmpRoot();
    await mkdir(join(root, "claude"), { recursive: true });
    await writeFile(join(root, "claude", "a.jsonl"), CLAUDE_LINE, "utf8");
    const first = await loadSessions({ rootDir: root });
    const second = await loadSessions({ rootDir: root });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("递归遍历子目录,并按 filePattern 过滤文件", async () => {
    const root = await makeTmpRoot();
    await mkdir(join(root, "codex", "2026", "08", "01"), { recursive: true });
    await writeFile(join(root, "codex", "2026", "08", "01", "rollout-deep.jsonl"), CLAUDE_LINE, "utf8");
    await writeFile(join(root, "codex", "2026", "08", "01", "not-a-rollout.jsonl"), CLAUDE_LINE, "utf8");
    const { sessions } = await loadSessions({ rootDir: root, sources: ["codex"] });
    // codex 的 filePattern 只认 rollout-*.jsonl:深层目录能找到,不匹配的文件被排除
    expect(sessions).toHaveLength(1);
    expect(sessions[0].session.filePath).toContain("rollout-deep.jsonl");
  });
});

describe("loadSessions:容错贯通(US2,FR-005/FR-012)", () => {
  it("单个文件损坏不拖垮整体,坏行计入来源统计(SC-001/SC-002)", async () => {
    const root = await makeTmpRoot();
    await mkdir(join(root, "claude"), { recursive: true });
    await writeFile(join(root, "claude", "good.jsonl"), CLAUDE_LINE, "utf8");
    await writeFile(
      join(root, "claude", "broken.jsonl"),
      CLAUDE_LINE + '\n{"type":"assistant","sessionId":"s-1","cwd":"/p","timestamp":"2026',
      "utf8",
    );
    const { sessions, stats } = await loadSessions({ rootDir: root, sources: ["claude-cli"] });
    expect(sessions).toHaveLength(2); // 好文件正常产出,坏文件前半也产出
    const claudeStats = stats.perSource[0];
    expect(claudeStats.sessionCount).toBe(2);
    expect(claudeStats.messageCount).toBe(2);
    expect(claudeStats.skippedBadLines).toBe(1); // 半行被计数,不静默
  });

  it("适配器返回 null → skippedBadLines + 1/文件(研究 R7 防御分支)", async () => {
    const root = await makeTmpRoot();
    await mkdir(join(root, "claude"), { recursive: true });
    await writeFile(join(root, "claude", "x.jsonl"), CLAUDE_LINE, "utf8");
    const original = FORMAT_ADAPTERS["claude-jsonl"];
    FORMAT_ADAPTERS["claude-jsonl"] = () => null; // 临时替换以触达 null 分支
    try {
      const { sessions, stats } = await loadSessions({ rootDir: root, sources: ["claude-cli"] });
      expect(sessions).toHaveLength(0);
      expect(stats.perSource[0].skippedBadLines).toBe(1);
    } finally {
      FORMAT_ADAPTERS["claude-jsonl"] = original; // 恢复,避免污染其他用例
    }
  });

  it("重复会话标识:不覆盖不合并,以文件为单位各自产出(FR-012)", async () => {
    const root = await makeTmpRoot();
    await mkdir(join(root, "claude", "part1"), { recursive: true });
    await mkdir(join(root, "claude", "part2"), { recursive: true });
    await writeFile(join(root, "claude", "part1", "a.jsonl"), CLAUDE_LINE, "utf8");
    await writeFile(join(root, "claude", "part2", "b.jsonl"), CLAUDE_LINE, "utf8");
    const { sessions } = await loadSessions({ rootDir: root, sources: ["claude-cli"] });
    expect(sessions).toHaveLength(2);
    expect(sessions[0].session.sessionKey).toBe("claude-cli:s-1");
    expect(sessions[1].session.sessionKey).toBe("claude-cli:s-1");
  });
});

describe("loadSessions:按来源过滤(US3,FR-007/SC-005)", () => {
  it("显式指定单一来源:其他来源文件解析率 0(SC-005)", async () => {
    const root = await makeTmpRoot();
    await mkdir(join(root, "claude"), { recursive: true });
    await mkdir(join(root, "codex"), { recursive: true });
    await writeFile(join(root, "claude", "a.jsonl"), CLAUDE_LINE, "utf8");
    await writeFile(
      join(root, "codex", "rollout-x.jsonl"),
      '{"type":"session_meta","session_id":"roll-1","cwd":"/c","timestamp":1754035200000}\n',
      "utf8",
    );
    const { sessions, stats } = await loadSessions({ rootDir: root, sources: ["claude-cli"] });
    expect(sessions.every((s) => s.session.source === "claude-cli")).toBe(true);
    expect(stats.perSource.map((s) => s.source)).toEqual(["claude-cli"]);
  });

  it("不传 sources:默认仅加载 optionalSetting=null 的来源,workbuddy 不出现", async () => {
    const root = await makeTmpRoot();
    await mkdir(join(root, "workbuddy"), { recursive: true });
    await writeFile(
      join(root, "workbuddy", "s.jsonl"),
      '{"ts":1754035200,"role":"user","text":"问题"}\n',
      "utf8",
    );
    const { sessions } = await loadSessions({ rootDir: root });
    expect(sessions).toHaveLength(0); // workbuddy 需显式开启,默认不被触碰
  });

  it("显式开启 workbuddy 后可加载(能力开关表达产品边界)", async () => {
    const root = await makeTmpRoot();
    await mkdir(join(root, "workbuddy"), { recursive: true });
    await writeFile(
      join(root, "workbuddy", "s.jsonl"),
      '{"ts":1754035200,"role":"user","text":"问题"}\n',
      "utf8",
    );
    const { sessions } = await loadSessions({ rootDir: root, sources: ["workbuddy-cli"] });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].session.source).toBe("workbuddy-cli");
  });

  it("传入未知来源 ID 直接抛错,不静默忽略(契约 §2)", async () => {
    const root = await makeTmpRoot();
    await expect(
      loadSessions({ rootDir: root, sources: ["no-such-source" as never] }),
    ).rejects.toThrow(/未知的会话来源/);
  });
});

describe("性能基线(计划性能目标:100 文件 < 1 秒,防退化;converge T023)", () => {
  it("100 个合成文件全量解析在 1 秒内", async () => {
    const root = await makeTmpRoot();
    await mkdir(join(root, "claude"), { recursive: true });
    for (let i = 0; i < 100; i++) {
      await writeFile(join(root, "claude", `perf-${String(i).padStart(3, "0")}.jsonl`), CLAUDE_LINE, "utf8");
    }
    const started = performance.now();
    const { sessions } = await loadSessions({ rootDir: root, sources: ["claude-cli"] });
    const elapsed = performance.now() - started;
    expect(sessions).toHaveLength(100);
    expect(elapsed).toBeLessThan(1000);
  });
});

describe("【验收演示】fixtures → LoadedSession[] 统计(计划 1.4,任务 T011)", () => {
  // 只读加载仓库内合成 fixtures,打印统计表。断言保持宽松(会话数>0),
  // 精确计数断言由上方 mkdtemp 用例负责——后续阶段补充 fixtures 不会破坏演示。
  it("加载仓库 fixtures 并输出每个来源的会话数/消息数/坏行数", async () => {
    const fixturesDir = join(import.meta.dirname, "..", "..", "fixtures");
    const { sessions, stats } = await loadSessions({ rootDir: fixturesDir });

    expect(sessions.length).toBeGreaterThan(0);
    expect(stats.perSource.map((s) => s.source)).toEqual(["claude-cli", "codex"]);
    expect(stats.perSource.find((s) => s.source === "claude-cli")!.sessionCount).toBeGreaterThan(0);
    expect(stats.perSource.find((s) => s.source === "codex")!.sessionCount).toBeGreaterThan(0);

    console.log("\n===== mini-recall 阶段 1 验收演示:fixtures → LoadedSession[] =====");
    console.log("来源            会话数   消息数   坏行数");
    for (const s of stats.perSource) {
      console.log(
        `${s.source.padEnd(14)} ${String(s.sessionCount).padStart(5)} ${String(s.messageCount).padStart(8)} ${String(s.skippedBadLines).padStart(6)}`,
      );
    }
    console.log(`合计会话: ${sessions.length}\n`);
  });
});
