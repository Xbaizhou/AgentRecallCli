// 来源注册表:静态声明每个会话来源的描述符。新增来源 = 增加一个对象、不改任何分支(开闭原则,宪法 VII)。
import { FORMAT_ADAPTERS } from "./format-adapters.js";
import type { SessionSource, SessionSourceCapabilities, SessionSourceDescriptor } from "./types.js";

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
 * 接受可选注入参数,让测试能用「改坏的描述符」验证自检有效(SC-004);
 * 一次性收集全部问题再抛错——一次看到所有坏点,而不是修一个才暴露下一个。
 * format 的合法性以「FORMAT_ADAPTERS 中存在对应适配器」为准:注册表与适配器表互为约束。
 */
export function validateSessionSourceRegistry(
  registry: readonly SessionSourceDescriptor[] = SESSION_SOURCE_REGISTRY,
): void {
  const problems: string[] = [];
  const seenIds = new Set<string>();

  for (const d of registry) {
    // 经 unknown 视图读取:校验函数的职责就是守住「类型上不可能、运行时却可能」的坏数据(注入测试)
    const raw = d as unknown as Record<string, unknown>;
    const id = typeof raw.id === "string" && raw.id !== "" ? raw.id : "<id 非法>";
    const mark = (field: string, issue: string) => problems.push(`${id}.${field}: ${issue}`);

    if (typeof raw.id !== "string" || raw.id === "") mark("id", "必须为非空字符串");
    else if (seenIds.has(raw.id)) mark("id", "重复(与先前来源冲突)");
    if (typeof raw.id === "string" && raw.id !== "") seenIds.add(raw.id);

    if (typeof raw.label !== "string" || raw.label === "") mark("label", "必须为非空字符串");

    const knownFormats = new Set(Object.keys(FORMAT_ADAPTERS));
    if (typeof raw.format !== "string" || !knownFormats.has(raw.format)) {
      mark("format", `必须是 ${[...knownFormats].join(" / ")} 之一(需有对应适配器)`);
    }

    if (typeof raw.family !== "string" || raw.family === "") mark("family", "必须为非空字符串");

    if (raw.optionalSetting !== null && (typeof raw.optionalSetting !== "string" || raw.optionalSetting === "")) {
      mark("optionalSetting", "必须为 null(默认开启)或非空设置键名");
    }

    if (typeof raw.relativeDir !== "string" || raw.relativeDir === "") {
      mark("relativeDir", "必须为非空字符串");
    } else if (/^([a-zA-Z]:)?[\\/]/.test(raw.relativeDir) || raw.relativeDir.split(/[\\/]/).includes("..")) {
      // 目录约定限定在 rootDir 之内:绝对路径或 .. 逃逸都属于注册表数据错误
      mark("relativeDir", "必须为 rootDir 下的相对目录(禁止绝对路径与 ..)");
    }

    if (!(raw.filePattern instanceof RegExp)) mark("filePattern", "必须为 RegExp 实例");

    const caps = (raw.capabilities ?? {}) as Record<string, unknown>;
    const required: Array<keyof SessionSourceCapabilities> = [
      "live",
      "resume",
      "migrate",
      "sessionSync",
      "openApp",
    ];
    for (const key of required) {
      if (typeof caps[key] !== "boolean") mark("capabilities", `缺少布尔能力开关 ${key}`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`来源注册表不变量校验失败:\n- ${problems.join("\n- ")}`);
  }
}
