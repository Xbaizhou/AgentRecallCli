// 冒烟测试:验证测试管线与 TypeScript 编译链路已接通(T002)
import { describe, expect, it } from "vitest";

describe("冒烟测试", () => {
  it("测试管线已接通", () => {
    expect(true).toBe(true);
  });
});
