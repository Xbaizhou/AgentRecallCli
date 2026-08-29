// 命令契约聚合:同一域的命令契约集中声明。strictObject 让「拼错字段名」被拒绝而非静默剥除;
// .default() 只在 parse 时生效——调用方必须使用 parse 的返回值(计划 3.6 坑点)。
import { z } from "zod";
import { defineCommand } from "./contract.js";

export const SEARCH_CMD = defineCommand(
  "search",
  z.strictObject({
    query: z.string().optional(),
    source: z.string().optional(),
    project: z.string().optional(),
    after: z.number().int().nonnegative().optional(),
    before: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(200).default(50),
    offset: z.number().int().min(0).default(0),
    sort: z.enum(["time", "relevance"]).default("time"),
  }),
);

export const MESSAGES_CMD = defineCommand(
  "messages",
  z.strictObject({
    sessionKey: z.string().min(1),
    tail: z.number().int().min(1).max(500).default(20),
  }),
);

export const STATS_CMD = defineCommand("stats", z.strictObject({}));

export type SearchArgs = z.infer<typeof SEARCH_CMD.schema>;
export type MessagesArgs = z.infer<typeof MESSAGES_CMD.schema>;
export type StatsArgs = z.infer<typeof STATS_CMD.schema>;
