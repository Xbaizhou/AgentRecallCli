// 来源注册表:静态声明每个会话来源的描述符。新增来源 = 增加一个对象、不改任何分支(开闭原则,宪法 VII)。
import type { SessionSource, SessionSourceDescriptor } from "./types.js";

/**
 * 内置来源(3 个,依澄清结论):
 * - claude-cli / codex 默认开启(optionalSetting = null);
 * - workbuddy-cli 五项能力全 false——「能力开关表达产品边界」的只读来源实例(对照原仓库同款设计)。
 */
export const SESSION_SOURCE_REGISTRY: readonly SessionSourceDescriptor[] = [
  {
    id: "claude-cli",
    label: "Claude Code",
    format: "claude-jsonl",
    family: "claude",
    optionalSetting: null,
    relativeDir: "claude",
    filePattern: /\.jsonl$/,
    capabilities: { live: true, resume: true, migrate: true, sessionSync: true, openApp: false },
  },
  {
    id: "codex",
    label: "Codex CLI",
    format: "codex-jsonl",
    family: "codex",
    optionalSetting: null,
    relativeDir: "codex",
    filePattern: /^rollout-.*\.jsonl$/,
    capabilities: { live: true, resume: true, migrate: false, sessionSync: false, openApp: false },
  },
  {
    id: "workbuddy-cli",
    label: "WorkBuddy CLI",
    format: "workbuddy-jsonl",
    family: "workbuddy",
    optionalSetting: "sources.workbuddy.enabled",
    relativeDir: "workbuddy",
    filePattern: /\.jsonl$/,
    capabilities: { live: false, resume: false, migrate: false, sessionSync: false, openApp: false },
  },
];

/**
 * 解析启用来源。sources 未传 → 仅返回 optionalSetting === null 的「默认开启」项(FR-007);
 * 显式传入未知 ID 直接抛错而不是静默忽略——拼写错误应该在边界上炸掉,而不是产出空结果。
 */
export function getEnabledSources(sources?: SessionSource[]): readonly SessionSourceDescriptor[] {
  if (sources === undefined) {
    return SESSION_SOURCE_REGISTRY.filter((d) => d.optionalSetting === null);
  }
  const known = new Set(SESSION_SOURCE_REGISTRY.map((d) => d.id));
  const unknown = sources.filter((s) => !known.has(s));
  if (unknown.length > 0) {
    throw new Error(`未知的会话来源: ${unknown.join(", ")}`);
  }
  return SESSION_SOURCE_REGISTRY.filter((d) => sources.includes(d.id));
}

/**
 * 注册表不变量自检(FR-010):字段完整性、类型合法、ID 唯一、目录安全。
 * 接受可选的注入参数,让测试能用「改坏的描述符」验证自检有效(SC-004)。
 * 依赖注入的默认值在 T019(US4)实现;当前为占位签名。
 */
export function validateSessionSourceRegistry(
  _registry: readonly SessionSourceDescriptor[] = SESSION_SOURCE_REGISTRY,
): void {
  throw new Error("validateSessionSourceRegistry 尚未实现(计划于 T019 / US4 实现)");
}
