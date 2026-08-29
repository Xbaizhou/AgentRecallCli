// MCP server:JSON-RPC 2.0 over STDIO(行分隔帧,\r\n 容差)。stdout 只许协议消息,日志一律 stderr。
// handleRpc 是纯函数(可测);main() 只做「读行 → handleRpc → 写行」与只读开库。
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { callTool, mcpToolList } from "./registration.js";
import { resolveDbPath } from "./db-pointer.js";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "mini-recall", version: "0.1.0" };

interface RpcMessage {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

function ok(id: RpcMessage["id"], result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function error(id: RpcMessage["id"], code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

/**
 * 纯 RPC 处理:返回应答行(null = 通知,不应答)。
 * 未知方法 → -32601;tools/call 的业务错误走 isError content 而非协议错误(宿主模型可读)。
 */
export async function handleRpc(db: DatabaseSync, message: RpcMessage): Promise<string | null> {
  const isNotification = message.id === undefined || message.id === null;
  switch (message.method) {
    case "initialize":
      return isNotification
        ? null
        : ok(message.id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          });
    case "notifications/initialized":
    case "notifications/cancelled":
      return null; // 通知不应答
    case "ping":
      return isNotification ? null : ok(message.id, {});
    case "tools/list":
      return isNotification ? null : ok(message.id, { tools: mcpToolList() });
    case "tools/call": {
      const params = message.params ?? {};
      const name = String(params.name ?? "");
      const result = await callTool(db, name, params.arguments ?? {});
      return isNotification ? null : ok(message.id, result);
    }
    default:
      return isNotification ? null : error(message.id, -32601, `未知方法: ${message.method}`);
  }
}

/** 解析 server 的库路径并只读打开(不迁移——结构由主程序负责) */
export function openReadonlyDb(env = process.env): DatabaseSync {
  const path = resolveDbPath(env, env.MINI_RECALL_HOME ?? homedir());
  if (path === null) {
    throw new Error(
      "找不到数据库路径:请先运行主程序(sync/search)生成 ~/.mini-recall/db-path,或设置 MINI_RECALL_DB",
    );
  }
  // 只读打开:WAL 允许写连接存在时并发读(阶段 2 已验证)
  return new DatabaseSync(path, { readOnly: true });
}

/** stdio 主循环:行分隔帧,stdout 仅协议消息 */
export async function main(): Promise<void> {
  let db: DatabaseSync;
  try {
    db = openReadonlyDb();
  } catch (err) {
    console.error(`[mini-recall-mcp] ${String(err)}`);
    process.exitCode = 1;
    return;
  }
  console.error(`[mini-recall-mcp] 已只读打开 ${resolveDbPath() ?? "?"}`);
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let message: RpcMessage;
    try {
      message = JSON.parse(trimmed) as RpcMessage;
    } catch {
      // 无法解析的行走 stderr 报告,stdout 保持纯净
      console.error(`[mini-recall-mcp] 非 JSON 行已忽略: ${trimmed.slice(0, 80)}`);
      continue;
    }
    const response = await handleRpc(db, message);
    if (response !== null) process.stdout.write(`${response}\n`);
  }
  db.close();
}

// 直接运行时进入 serve 循环(bundle 入口)
if (process.argv[1]?.replace(/\\/g, "/").endsWith("server.ts") || process.argv[1]?.endsWith("mini-recall-mcp.cjs")) {
  if (process.argv.includes("--selfcheck")) {
    console.log("selfcheck ok: zero-dependency bundle is runnable");
    process.exit(0);
  }
  main().catch((err) => {
    console.error(`[mini-recall-mcp] ${String(err)}`);
    process.exitCode = 1;
  });
}
