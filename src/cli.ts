// CLI「渲染层」:与原版 App.tsx→preload→ipcMain 同位——收集输入 → 契约校验 → 调 core → 渲染输出。
// dispatchLine 是纯逻辑(可测);main() 只包一层 readline 薄壳(研究 R3)。core 不感知本模块(宪法 VII)。
import { createInterface } from "node:readline/promises";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase, DEFAULT_DB_PATH } from "./core/store/database.js";
import { migrateMiniRecallStore } from "./core/store/schema.js";
import { searchSessions, sessionStats } from "./core/search.js";
import { getMessages } from "./core/store/messages.js";
import { MESSAGES_CMD, SEARCH_CMD, STATS_CMD } from "./shared/commands.js";
import { syncSessions } from "./core/indexer.js";
import { writeDbPointer } from "./mcp/db-pointer.js";
import type { ZodError } from "zod";

/** 词法切分:`--key value` / `--key=value` / 位置参数;数值字符串转 number */
export function parseLine(line: string): {
  name: string;
  flags: Record<string, string | boolean>;
  positionals: string[];
} {
  const tokens = line.trim().split(/\s+/).filter((t) => t !== "");
  const name = tokens.shift() ?? "";
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq > 0) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        const next = tokens[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[token.slice(2)] = next;
          i++;
        } else {
          flags[token.slice(2)] = true;
        }
      }
    } else {
      positionals.push(token);
    }
  }
  return { name, flags, positionals };
}

/** 值转换:number 样式字符串转数字,ISO 日期转毫秒(契约要 number) */
function coerce(value: string | boolean | undefined): string | number | boolean | undefined {
  if (typeof value === "boolean" || value === undefined) return value;
  if (/^-?\d+$/.test(value) || /^-?\d+\.\d+$/.test(value)) return Number(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(`${value}T00:00:00`);
  return value;
}

function zodErrorLines(err: ZodError): string[] {
  return ["参数校验失败:", ...err.issues.map((i) => `  字段 [${i.path.join(".")}] ${i.code} ${"message" in i ? i.message : ""}`.trimEnd())];
}

/**
 * 命令调度:返回要渲染的行;null = 退出(quit/exit)。
 * 每条命令都先过契约 parse——非法参数在这里被字段级拦下,core 不接收脏数据。
 */
export function dispatchLine(db: DatabaseSync, line: string): string[] | null {
  const trimmed = line.trim();
  if (trimmed === "") return helpLines();
  const { name, flags, positionals } = parseLine(trimmed);
  const coerced = Object.fromEntries(
    Object.entries(flags).map(([k, v]) => [k, coerce(v)]),
  );

  try {
    switch (name) {
      case "search": {
        const args = SEARCH_CMD.parse(coerced);
        const res = searchSessions(db, args);
        const lines = [`命中 ${res.total} 条(耗时 ${res.tookMs.toFixed(1)}ms,显示 ${res.items.length} 条)`];
        for (const it of res.items) {
          lines.push(
            `${it.sessionKey.padEnd(28)} ${new Date(it.timestamp).toISOString().slice(0, 10)} ${String(it.messageCount).padStart(3)}条 ${it.originalTitle}`,
          );
          if (it.snippet) lines.push(`    ↳ ${it.snippet}`);
        }
        return lines;
      }
      case "messages": {
        const sessionKey = positionals[0] ?? (typeof coerced.sessionKey === "string" ? coerced.sessionKey : "");
        const args = MESSAGES_CMD.parse({ sessionKey, tail: coerced.tail });
        const messages = getMessages(db, args.sessionKey, args.tail);
        return [
          `会话 ${args.sessionKey} 最近 ${messages.length} 条:`,
          ...messages.map((m) => `  #${m.index} [${m.role}] ${m.content.slice(0, 60)}`),
        ];
      }
      case "stats": {
        STATS_CMD.parse(coerced);
        const stats = sessionStats(db);
        return [
          `按来源:${stats.perSource.map((s) => `${s.source}=${s.count}`).join(", ") || "(空)"}`,
          `按日:${stats.perDay.map((d) => `${d.day}=${d.count}`).join(", ") || "(空)"}`,
          `(耗时 ${stats.tookMs.toFixed(1)}ms)`,
        ];
      }
      case "sync": {
        // sync 是异步命令:交互模式由 main() 特判处理;这里只给出指引
        return ["sync 需要异步执行:请在 REPL(main)中输入 sync --rootDir <目录>"];
      }
      case "help":
        return helpLines();
      case "quit":
      case "exit":
        return null;
      default:
        return [`未知命令「${name}」。可用命令: search / messages / stats / sync / help / quit`];
    }
  } catch (err) {
    if ((err as { issues?: unknown }).issues !== undefined) {
      return zodErrorLines(err as ZodError);
    }
    return [`执行出错: ${String(err)}`];
  }
}

function helpLines(): string[] {
  return [
    "mini-recall 命令:",
    "  search --query <词> [--source <来源>] [--project <前缀>] [--after YYYY-MM-DD] [--before YYYY-MM-DD] [--limit N] [--sort time|relevance]",
    "  messages <sessionKey> [--tail N]",
    "  stats",
    "  sync --rootDir <目录>     # 扫描目录并增量入库",
    "  quit / exit               # 退出",
  ];
}

/** REPL 薄壳:仅负责读写循环与退出 */
export async function main(): Promise<void> {
  const db = openDatabase();
  migrateMiniRecallStore(db);
  // 主程序职责:把库路径写给进程外的 MCP server(阶段 5 db 指针机制)
  writeDbPointer(DEFAULT_DB_PATH);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(`mini-recall REPL(库: ${DEFAULT_DB_PATH});输入 help 查看命令。`);
  for (;;) {
    const line = await rl.question("> ");
    if (line.trim() === "") continue;
    // sync 需要异步:在这里特判,其余命令走同步调度
    if (line.trim().startsWith("sync")) {
      const { flags } = parseLine(line);
      const rootDir = typeof flags.rootDir === "string" ? flags.rootDir : undefined;
      if (!rootDir) {
        console.log("用法: sync --rootDir <目录>");
        continue;
      }
      const status = await syncSessions(db, { rootDir });
      console.log(`indexed=${status.indexed} skipped=${status.skipped} removed=${status.removed} conflicts=${status.conflicts} errors=${status.errors.length}`);
      continue;
    }
    const lines = dispatchLine(db, line);
    if (lines === null) break;
    console.log(lines.join("\n"));
  }
  rl.close();
  db.close();
}

// 直接运行本文件时进入 REPL(import.meta 判定,避免构建步骤)
if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/cli.ts")) {
  main().catch((err) => {
    console.error(String(err));
    process.exitCode = 1;
  });
}
