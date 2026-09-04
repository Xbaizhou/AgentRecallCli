# 研究记录:阶段 2

## R1. 分词器的运行时实证(修正上轮澄清假设)

- **实测**:unicode61 把连续 CJK 视为**单个 token**——文档「FTS5 全文检索虚拟表模块」对短语查询 `"全文检索"` **零命中**(正是计划 2.6 预言的「中文检索不命中」坑)。
- **决策**:FTS5 使用 `tokenize='trigram'`(≥3 字符的中英文子串命中,已实测通过);**短于 3 字符的查询走 LIKE 兜底**(转义 %/_ 后 `content LIKE '%q%'`),两者共同满足 FR-010「两字及以上中文词可命中」。
- **备选**:unicode61 + 查询逐字加空格——被拒:文档 token 未逐字化,短语匹配依然失效;自定义 JS 分词镜像列——被拒:node:sqlite 不支持注册自定义 tokenizer,镜像列增加双写漂移风险。

## R2. FTS5 内容同步

- **决策**:external content(`content='messages'`、`content_rowid='rowid'`)+ AFTER INSERT/DELETE 触发器;upsert 的「先删后插」自动带动索引更新,无残留(US1 场景 2)。
- **备选**:contentless——被拒:无法 snippet;手动双写——被拒:漂移风险。

## R3. 增量判定与 fs 边界

- **决策**:loader 读文件时顺便 `stat`,把 file_size/file_mtime_ms 写入 Session;库内保存上次索引快照 content_indexed_size/content_indexed_mtime_ms;syncSessions 逐会话对比,均相同 → skipped,否则重解析并更新快照。indexer 不访问 fs(宪法 VII 不变)。**字节偏移尾扫为选做不做**(计划明确),记录为差距。
- **删除清理**(澄清 2):同步时按来源列出库内 file_path,凡位于当前 rootDir 之下却已不存在者——连同消息(级联)与 FTS 项(触发器)删除,计 removed。rootDir 之外的记录不动(无法核验,避免误删)。

## R4. 强制重建谓词(澄清 3)

- **决策**:`forceReindex?: (source: SessionSource) => boolean`,命中来源无视快照判定强制重建;mtime 漏检属已知 trade-off,兜底优先于换算法(计划 2.7)。

## R5. WAL 与只读并发

- **决策**:持久形态 `PRAGMA journal_mode=WAL` + `PRAGMA foreign_keys=ON`;已实测 `new DatabaseSync(path, { readOnly: true })` 可在写连接存在时打开——阶段 5 server 的打开方式就此锁定。

## R6. 迁移策略

- **决策**:无编号自描述——`CREATE TABLE/VRIGGER IF NOT EXISTS` + `addColumnIfMissing`(PRAGMA table_info 探测)+ data_migrations 登记表(INSERT OR IGNORE)。与 v2 的 PGlite 编号迁移对比留作 PROJECT-RECAP 谈资。

## R7. 会话键冲突

- **决策**:同来源不同文件产出相同 session_key 时**先到先得**(文件按路径排序保证确定性),后到者跳过并计入 conflicts;合并策略不做(YAGNI)。

## R8. 默认库路径

- **决策**:`DEFAULT_DB_PATH = ~/.mini-recall/mini-recall.db`,openDatabase 自动建目录;该目录为本项目自建,不触碰任何真实 Agent 目录(宪法 VI)。db-path 指针文件属阶段 5。
