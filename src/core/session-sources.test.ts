// 来源注册表测试:不变量自检(US4,FR-010/SC-004)。注册表抽象必须「自检查」——改坏任一字段,测试先红。
import { describe, expect, it } from "vitest";
import { SESSION_SOURCE_REGISTRY, validateSessionSourceRegistry } from "./session-sources.js";
import type { SessionSourceCapabilities, SessionSourceDescriptor } from "./types.js";

/** 以合法描述符为模板构造「改坏」的变体:只动目标字段,其余保持合法 */
function broken(mutate: (d: SessionSourceDescriptor) => void): SessionSourceDescriptor[] {
  const clone = structuredClone(
    SESSION_SOURCE_REGISTRY.map((d) => ({ ...d, capabilities: { ...d.capabilities } })),
  ) as SessionSourceDescriptor[];
  mutate(clone[0]);
  return clone;
}

const ALL_FALSE: SessionSourceCapabilities = {
  live: false,
  resume: false,
  migrate: false,
  sessionSync: false,
  openApp: false,
};

describe("validateSessionSourceRegistry(US4)", () => {
  it("合法注册表通过校验且 ID 无重复", () => {
    expect(() => validateSessionSourceRegistry(SESSION_SOURCE_REGISTRY)).not.toThrow();
    const ids = SESSION_SOURCE_REGISTRY.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("缺 id / 空 id → 报错并指明字段", () => {
    expect(() =>
      validateSessionSourceRegistry(broken((d) => ((d as unknown as { id: string }).id = ""))),
    ).toThrow(/id/);
  });

  it("缺 label / 空 label → 报错", () => {
    expect(() =>
      validateSessionSourceRegistry(broken((d) => ((d as unknown as { label: string }).label = ""))),
    ).toThrow(/label/);
  });

  it("未知 format(没有对应适配器)→ 报错", () => {
    expect(() =>
      validateSessionSourceRegistry(
        broken((d) => ((d as unknown as { format: string }).format = "no-such-format")),
      ),
    ).toThrow(/format/);
  });

  it("relativeDir 含 ..(路径逃逸)→ 报错", () => {
    expect(() =>
      validateSessionSourceRegistry(
        broken((d) => ((d as unknown as { relativeDir: string }).relativeDir = "../escape")),
      ),
    ).toThrow(/relativeDir/);
  });

  it("filePattern 非正则 → 报错", () => {
    expect(() =>
      validateSessionSourceRegistry(
        broken((d) => ((d as unknown as { filePattern: unknown }).filePattern = "*.jsonl")),
      ),
    ).toThrow(/filePattern/);
  });

  it("capabilities 缺键或非布尔 → 报错", () => {
    expect(() =>
      validateSessionSourceRegistry(
        broken((d) => ((d.capabilities as unknown as Record<string, unknown>).live = "yes")),
      ),
    ).toThrow(/capabilities/);
    const missing = broken((d) => {
      delete (d.capabilities as unknown as Record<string, unknown>).openApp;
    });
    expect(() => validateSessionSourceRegistry(missing)).toThrow(/capabilities/);
    void ALL_FALSE;
  });

  it("ID 重复 → 报错并指明来源", () => {
    const duplicated = [
      ...SESSION_SOURCE_REGISTRY,
      { ...SESSION_SOURCE_REGISTRY[0], label: "副本" },
    ];
    expect(() => validateSessionSourceRegistry(duplicated)).toThrow(/claude-cli/);
  });
});
