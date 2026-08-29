// 格式适配器测试:三种 jsonl 格式的解析契约与时间戳归一边界(适配器是纯函数,测试不碰文件系统)。
import { describe, expect, it } from "vitest";
import { FORMAT_ADAPTERS, normalizeTimestampMs } from "./format-adapters.js";

const claude = FORMAT_ADAPTERS["claude-jsonl"];
const codex = FORMAT_ADAPTERS["codex-jsonl"];
const workbuddy = FORMAT_ADAPTERS["workbuddy-jsonl"];

describe("claude-jsonl 适配器(正常路径)", () => {
  it("解析字符串 content 与 ISO 时间戳", () => {
    const text = [
      '{"type":"user","sessionId":"sess-001","cwd":"/proj/demo","timestamp":"2026-08-01T10:00:00.000Z","message":{"role":"user","content":"FTS5 是什么?"}}',
      '{"type":"assistant","sessionId":"sess-001","cwd":"/proj/demo","timestamp":"2026-08-01T10:00:05.000Z","message":{"role":"assistant","content":"SQLite 的全文检索模块。"}}',
    ].join("\n");
    const parsed = claude(text, "/root/claude/normal-1.jsonl");
    expect(parsed).not.toBeNull();
    expect(parsed!.rawId).toBe("sess-001");
    expect(parsed!.projectPath).toBe("/proj/demo");
    expect(parsed!.originalTitle).toBe("normal-1");
    expect(parsed!.firstQuestion).toBe("FTS5 是什么?");
    expect(parsed!.timestamp).toBe(Date.parse("2026-08-01T10:00:00.000Z"));
    expect(parsed!.badLineCount).toBe(0);
    expect(parsed!.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(parsed!.messages.map((m) => m.index)).toEqual([0, 1]);
    expect(parsed!.messages[0].timestamp).toBe(Date.parse("2026-08-01T10:00:00.000Z"));
  });

  it("数组型 content 按 text 块拼接", () => {
    const text =
      '{"type":"user","sessionId":"s2","cwd":"/p","timestamp":1754035200000,"message":{"role":"user","content":[{"type":"text","text":"帮我理解"},{"type":"text","text":"增量索引"}]}}';
    const parsed = claude(text, "/root/claude/a.jsonl");
    expect(parsed!.messages[0].content).toBe("帮我理解增量索引");
  });

  it("summary 等非消息行被忽略且不计坏行", () => {
    const text = [
      '{"type":"summary","summary":"摘要"}',
      '{"type":"user","sessionId":"s3","cwd":"/p","timestamp":"2026-08-03T08:00:00.000Z","message":{"role":"user","content":"问题"}}',
    ].join("\n");
    const parsed = claude(text, "/root/claude/u.jsonl");
    expect(parsed!.messages).toHaveLength(1);
    expect(parsed!.badLineCount).toBe(0);
  });
});

describe("codex-jsonl 适配器(正常路径)", () => {
  it("session_meta 提取元数据,response_item 提取消息,毫秒时间戳原样保留", () => {
    const text = [
      '{"type":"session_meta","session_id":"roll-abc-111","cwd":"/proj/codex","timestamp":1754035200000}',
      '{"type":"response_item","payload":{"role":"user","content":"问题"},"timestamp":1754035205000}',
      '{"type":"response_item","payload":{"role":"assistant","content":"回答"},"timestamp":1754035210000}',
    ].join("\n");
    const parsed = codex(text, "/root/codex/rollout-1.jsonl");
    expect(parsed!.rawId).toBe("roll-abc-111");
    expect(parsed!.projectPath).toBe("/proj/codex");
    expect(parsed!.timestamp).toBe(1754035205000);
    expect(parsed!.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(parsed!.messages[0].timestamp).toBe(1754035205000);
    expect(parsed!.originalTitle).toBe("rollout-1");
  });
});

describe("workbuddy-jsonl 适配器(正常路径)", () => {
  it("秒级时间戳归一为毫秒,rawId 回退为文件名", () => {
    const text = [
      '{"ts":1754035200,"role":"user","text":"workbuddy 的第一个问题"}',
      '{"ts":1754035206,"role":"assistant","text":"workbuddy 的第一个回答"}',
    ].join("\n");
    const parsed = workbuddy(text, "/root/workbuddy/session-a.jsonl");
    expect(parsed!.rawId).toBe("session-a");
    expect(parsed!.messages[0].content).toBe("workbuddy 的第一个问题");
    expect(parsed!.messages[0].timestamp).toBe(1754035200000);
    expect(parsed!.messages[1].timestamp).toBe(1754035206000);
    expect(parsed!.firstQuestion).toBe("workbuddy 的第一个问题");
  });
});

describe("normalizeTimestampMs(归一边界,研究 R1)", () => {
  it("数值秒(< 10^12)乘以 1000", () => {
    expect(normalizeTimestampMs(1754035200)).toBe(1754035200000);
  });
  it("数值毫秒(≥ 10^12)原样保留", () => {
    expect(normalizeTimestampMs(1754035200000)).toBe(1754035200000);
  });
  it("纯数字字符串按数值规则归一", () => {
    expect(normalizeTimestampMs("1754035200")).toBe(1754035200000);
  });
  it("ISO 8601 字符串走 Date.parse", () => {
    expect(normalizeTimestampMs("2026-08-01T10:00:00.000Z")).toBe(
      Date.parse("2026-08-01T10:00:00.000Z"),
    );
  });
  it("非法输入返回 0(元数据缺失不丢消息)", () => {
    expect(normalizeTimestampMs("abc")).toBe(0);
    expect(normalizeTimestampMs(null)).toBe(0);
    expect(normalizeTimestampMs(undefined)).toBe(0);
    expect(normalizeTimestampMs(true)).toBe(0);
  });
});
