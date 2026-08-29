// 数据库封装:持久形态(WAL+外键)与内存形态(测试)。阶段 5 的只读 server 也从这里取打开方式。
// 注:库文件的创建属于存储层自身职责(spec FR-001);会话文件的读取仍仅限 session-loader(宪法 VII)。
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { DatabaseSync } from "node:sqlite";

/** 默认库路径:本项目自建目录,不触碰任何真实 Agent 目录(宪法 VI) */
export const DEFAULT_DB_PATH = join(homedir(), ".mini-recall", "mini-recall.db");

/**
 * 打开持久库:目录不存在则同步创建(mkdirSync——本函数是同步 API,异步 mkdir 会产生竞态);
 * WAL 让「主程序写 + 只读进程查」互不阻塞(计划 2.2:这是阶段 5 MCP server 并发读的前提);
 * 外键保证删会话级联删消息。
 */
export function openDatabase(path: string = DEFAULT_DB_PATH): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

/** 内存库:全套存储测试不落盘(宪法 VI 少留磁盘残留);WAL 对内存库无意义,不设 */
export function createInMemoryStore(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}
