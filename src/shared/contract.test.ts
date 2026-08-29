// 契约层测试:默认值生效、非法值字段级拒绝、未知字段拒绝(US3/SC-003)。
import { describe, expect, it } from "vitest";
import { MESSAGES_CMD, SEARCH_CMD } from "./commands.js";

describe("SEARCH_CMD.parse", () => {
  it("空对象应用全部默认值(limit=50, offset=0, sort=time)", () => {
    expect(SEARCH_CMD.parse({})).toEqual({
      limit: 50,
      offset: 0,
      sort: "time",
    });
  });

  it("合法参数通过并保留可选字段", () => {
    const args = SEARCH_CMD.parse({ query: "RAG", source: "codex", limit: 10, sort: "relevance" });
    expect(args.limit).toBe(10);
    expect(args.sort).toBe("relevance");
    expect(args.query).toBe("RAG");
  });

  it("limit=-1 被字段级拒绝(SC-003)", () => {
    try {
      SEARCH_CMD.parse({ limit: -1 });
      expect.unreachable("应当抛出 ZodError");
    } catch (err) {
      const issues = (err as { issues: Array<{ path: (string | number)[]; code: string }> }).issues;
      expect(issues[0].path).toEqual(["limit"]);
    }
  });

  it("未知字段被 strictObject 拒绝(澄清 2)", () => {
    expect(() => SEARCH_CMD.parse({ nonsense: 1 })).toThrow();
  });

  it("sort 非法枚举被拒绝", () => {
    expect(() => SEARCH_CMD.parse({ sort: "random" })).toThrow();
  });
});

describe("MESSAGES_CMD.parse", () => {
  it("缺 sessionKey 拒绝;tail 默认 20", () => {
    expect(() => MESSAGES_CMD.parse({})).toThrow();
    expect(MESSAGES_CMD.parse({ sessionKey: "codex:r-1" }).tail).toBe(20);
  });

  it("tail 超上界拒绝", () => {
    expect(() => MESSAGES_CMD.parse({ sessionKey: "k", tail: 501 })).toThrow();
  });
});
