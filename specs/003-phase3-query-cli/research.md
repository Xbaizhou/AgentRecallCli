# 研究记录:阶段 3

## R1. FTS × SQL 求交的实现方式
- **决策**:两路结果在 JS 内存中求交——先 `SELECT sessions 行 + 结构化 WHERE`,再用 FTS 命中的 session_key 集合过滤;相关度 = 每键最小 bm25。
- **备选**:SQL `IN (...)` 子查询合并——被拒:动态占位符拼装复杂、bm25 排序难以与 SQL 排序统一;SQLite 裸 MATCH JOIN——被拒:结构化过滤条件与 snippets 组装同样要回表,收益小。
- **代价**:候选集在 JS 中过滤;万条会话量级内存可承受(阶段 6 评测验证)。

## R2. zod 契约工厂
- **决策**:`defineCommand(name, schema)` 返回 { name, schema, parse };schema 用 `z.strictObject`(未知字段拒绝);`.default()` 只在 parse 时生效——调用方必须使用 parse 的返回值(计划 3.6 坑点)。
- **多消费者**:同一份 schema 在阶段 4 经 zod-to-json-schema 等价物(手写转换)交给模型工具描述;本阶段先服务 CLI 校验与 TS 类型推导。

## R3. CLI 词法与渲染
- **决策**:支持 `--key value` 与 `--key=value`;数值字符串自动转 number;ISO 日期字符串(YYYY-MM-DD)在 CLI 层转毫秒;渲染为纯文本行(对齐用 padEnd),无第三方表格库。
- **REPL 分离**:dispatchLine(db, line) → string[]|null(null=退出)纯逻辑可测;main() 只管 readline 与打印。

## R4. tookMs 采集
- **决策**:searchSessions/sessionStats 内部 performance.now 计时,随响应返回;演示测试打印基线(阶段 6 对照数据来源)。
