// db 指针:主程序把真实库路径写入 ~/.mini-recall/db-path,进程外 server 读指针定位——
// 不 import 应用代码、不需要应用配置(计划 5.2,原版 ~/.agent-recall/db-path 同款设计)。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export function pointerPath(home = homedir()): string {
  return join(home, ".mini-recall", "db-path");
}

/** 主程序调用:库路径落盘(目录不存在则建) */
export function writeDbPointer(dbPath: string, home = homedir()): void {
  const path = pointerPath(home);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${dbPath}\n`, "utf8");
}

/** server 调用:读指针;不存在返回 null(调用方必须报可诊断错误,而非静默空结果) */
export function readDbPointer(home = homedir()): string | null {
  try {
    const text = readFileSync(pointerPath(home), "utf8").trim();
    return text === "" ? null : text;
  } catch {
    return null;
  }
}

/** 解析 server 的库路径:环境变量 > 指针文件 > null */
export function resolveDbPath(env = process.env, home = homedir()): string | null {
  return env.MINI_RECALL_DB ?? readDbPointer(home);
}
