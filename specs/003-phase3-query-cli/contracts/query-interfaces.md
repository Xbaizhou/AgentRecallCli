# 契约:阶段 3 查询服务与命令

## core/search.ts

```ts
export interface SearchFilters {
  query?: string; source?: string; project?: string;
  after?: number; before?: number;              // 毫秒,闭区间
  limit?: number; offset?: number;              // 默认 50 / 0
  sort?: "time" | "relevance";                  // 默认 time;relevance 无关键词退化为 time
}
export interface SessionSummary {
  sessionKey: string; source: string; projectPath: string; filePath: string;
  originalTitle: string; firstQuestion: string; timestamp: number;
  messageCount: number; snippet?: string;        // 关键词命中时提供
}
export interface SearchResponse { items: SessionSummary[]; total: number; tookMs: number; }
export function searchSessions(db: DatabaseSync, filters: SearchFilters): SearchResponse;

export interface SessionStats { perSource: Array<{ source: string; count: number }>;
                               perDay: Array<{ day: string; count: number }>; tookMs: number; }
export function sessionStats(db: DatabaseSync): SessionStats;
```

## shared/contract.ts

```ts
export interface Command<S extends z.ZodType> {
  name: string; schema: S;
  parse(input: unknown): z.infer<S>;   // 失败抛 ZodError(字段级 issues)
}
export function defineCommand<S extends z.ZodType>(name: string, schema: S): Command<S>;
```

## shared/commands.ts

```ts
export const SEARCH_CMD   // { query?, source?, project?, after?, before?, limit=50, offset=0, sort="time" }
export const MESSAGES_CMD // { sessionKey: string(min 1), tail=20(1..500) }
export const STATS_CMD    // {}
```

## cli.ts

```ts
export function parseLine(line: string): { name: string; flags: Record<string, string|boolean>; positionals: string[] };
export function dispatchLine(db: DatabaseSync, line: string): string[] | null; // null = quit
export function main(): Promise<void>;  // readline REPL 薄壳
// 支持命令:search / messages / stats / help / quit(exit);ZodError → 字段级错误行
```

## 错误语义

| 场景 | 行为 |
| --- | --- |
| limit=-1 / 0 | ZodError:limit 字段级拒绝 |
| 未知字段 --nonsense | strictObject 拒绝 |
| messages 缺 sessionKey | ZodError:必填缺失 |
| 无关键词 + sort=relevance | 退化为时间倒序 |
| offset 超界 | items=[],total 正确 |
