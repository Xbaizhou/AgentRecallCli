# mini-recall 项目总结(PROJECT-RECAP)

> 长期回顾的唯一入口。按「复现式学习计划」第 8 节框架组织;**全部数据来自本仓库实测**(eval/report/、各阶段验收演示),不含虚构数字。

## 1. 项目一句话 & 架构总览

**mini-recall = AgentRecall v1 的领域内核复现(纯 ESM TypeScript + SQLite,无 Electron)+ 会话检索 Agent(ReAct 决策循环 + 工具调用 + 查询改写 + 结果反思)+ MCP 对外暴露 + 评测闭环。**

```text
磁盘 jsonl(合成 fixtures)
  → session-loader.scanSourceFiles/parseScannedFile   [阶段1 唯一 fs 模块;注册表+描述符驱动]
  → indexer.syncSessions(size+mtime 快照判定,解析前跳过) [阶段2]
  → store:SQLite(WAL)+ sessions/messages + FTS5(trigram+短词LIKE兜底) [阶段2]
  → searchSessions(FTS × SQL 两路求交/分页/排序) ←── zod 契约层(SEARCH/MESSAGES/STATS) [阶段3]
  → CLI REPL(渲染层)/ Agent 循环(runAgent:now→rewrite→search→get_messages→反思) [阶段3/4]
  → MCP server(JSON-RPC over STDIO,只读,零依赖 bundle) [阶段5]
  → eval:A/B/C 三模式对照报告 [阶段6]
```

## 2. 架构决策记录(ADR)

模板:背景 → 备选 → 决策 → 理由与代价 → 状态。

| ADR | 决策 | 理由(为什么) | 代价 / 重新评估条件 | 状态 |
| --- | --- | --- | --- | --- |
| ADR-001 | 来源发现用「注册表 + 描述符 + 能力开关」 | 新增来源零分支(开闭原则);workbuddy 五能力全 false 表达产品边界 | 描述符字段校验成本(用不变量自检覆盖) | 已接受 |
| ADR-002 | 增量索引用 size+mtime 而非内容 hash | 全量读文件算 hash 的 IO ≈ 重新解析;两次 stat 成本极低 | mtime 精度漏检 → forceReindex 兜底 | 已接受 |
| ADR-003 | 增量跳过发生在「解析前」(两段式 loader:scan→按需 parse) | 初版先解析后对比,实测增量无提速(1x);改为解析前判定后实测 **9x** | loader API 拆两段 | 已接受(取代初版) |
| ADR-004 | SQLite 开 WAL | 只读 MCP server 与写进程并发互不阻塞(实测只读连接可打开) | -wal/-shm 残留文件(close 回收) | 已接受 |
| ADR-005 | FTS5 trigram 分词 + 短词 LIKE 兜底 | 实证 unicode61 把连续 CJK 视为单 token,中文查询必不命中(计划 2.6 的坑);trigram 让 ≥3 字符中英文子串命中 | <3 字符查询走全表 LIKE(语义优先,如实记录) | 已接受(修正澄清假设) |
| ADR-006 | 无编号自描述迁移(CREATE IF NOT EXISTS + addColumnIfMissing + data_migrations) | 单机同步库「自描述」够用;与 v2 PGlite 编号迁移的对比是面试展开点 | 无集中迁移历史审查(规模变大需换) | 已接受 |
| ADR-007 | zod 契约层守护一切跨边界调用 | 进程边界上类型系统失效;strictObject 拒绝拼错字段;同一 schema 服务 CLI 校验/TS 类型/模型工具描述 | 引入 zod(白名单唯一运行时依赖) | 已接受 |
| ADR-008 | 查询改写做成工具(rewrite_query)而非前置一次 | 反思后可再次改写——「迭代优化」的载体;实测改写把 paraphrase/time 类 recall 从 50% 提到 100% | 每次改写多一次 LLM 调用 | 已接受 |
| ADR-009 | MCP server 零依赖单文件 CJS bundle + db 指针文件 | 免拖依赖树、启动快、与应用解耦;指针让进程外 server 定位库而不 import 应用代码 | 构建步骤(esbuild,仅构建期) | 已接受 |
| ADR-010 | ReAct 而非 Plan-and-Execute | 检索依赖中间结果(先锚定时间、看命中再改写);循环步数少(实测平均 1 工具调用) | 无全局规划能力(当前任务不需要) | 已接受 |

## 3. 关键问题复盘(每个坑:现象 → 根因 → 定位 → 修复 → 预防)

1. **中文 FTS5 检索不命中**:英文能搜到、中文搜不到 → unicode61 把连续 CJK 视为单 token,短语查询整 token 才命中 → 运行时实测复现(计划 2.6 预言)→ trigram 分词 + 短词 LIKE 兜底 → 分词语义收敛到 fts.ts 单一出处(曾因 searchSessions/searchContent 两处分流不一致再次踩坑,已统一)。
2. **增量索引无提速**:初版同步「先全量解析再对比快照」,实测增量 1x → 计划 2.2 的算法本意是「解析前用 stat 判定」→ loader 拆两段式 API → 实测 9x。教训:**先读计划算法原文,再写实现**。
3. **upsert 消息翻倍**:直接重插消息行数翻倍 → 「先删该会话消息再插」语义(计划 2.6)+ 幂等测试锁死。
4. **跨文件同键误判「未变」**:三个 fixture 同 session_id 同内容同 mtime,同步时 1 indexed/2 skipped → 跳过判定补充「file_path 必须相同」→ 快照结构带路径,测试覆盖。
5. **Agent 引用幻觉会话键**:答案引用观察结果里不存在的键 → prompt 强约束 + 循环内溯源校验 + 一次重答(澄清 4)→ 评测 n01–n04 诚实应答率 100%。
6. **MCP stdout 污染**:日志混入 stdout 会破坏 JSON-RPC 帧 → stdout 只写协议消息,日志全走 stderr,非 JSON 行忽略并记录。
7. **openDatabase 竞态**:同步函数里调异步 mkdir,目录未建好即开库报 unable to open → 改 mkdirSync(库文件创建属存储层职责)。
8. **main-1.0 测试混入**:仓库内原版参照目录(阶段 0)的 124 个测试文件被 vitest 收集 → include 收紧到 src/ 与 eval/。

## 4. 各阶段效果对比(实测)

| 项 | 数值 | 出处 |
| --- | --- | --- |
| 全量索引 100 文件 vs 增量同步 | 36.1ms vs 4.2ms(**9x**) | indexer.test.ts 性能用例 |
| 万条消息 FTS5 vs LIKE | 0.2ms vs 0.5ms(**2.5x**) | 同上 |
| 评测 recall@5 | A 直接 50% / B 改写 100% / C Agent 100% | eval/report/eval-report.md |
| 评测 MRR | A 0.5 / B 0.9 / C 1.0 | 同上 |
| C 模式成本 | 平均 1 次工具调用、30 token、亚毫秒级(MockLlm) | 同上 |
| 无命中诚实应答率(C) | 100%(n01–n04) | 同上 |
| 阶段 1 典型查询 tookMs 基线 | 演示输出 ~0.1ms 量级 | search.test/demo |

**对照结论**(诚实):改写对「词汇失配 + 时间窗」类问题提升最大(50%→100%),因为时间换算与术语对齐无法靠关键词原句完成;C 模式在此小数据集上与 B 同为 100%,但多了 1 次工具调用与 2 倍 token——**数据集小、C 的多步价值未体现,这是本评测的边界,不是 C 无用的证据**。

## 5. 与 AgentRecall 工业实现的差异清单(诚实差距表)

| 模块 | 我的实现 | 原版 | 差距原因(简化假设) |
| --- | --- | --- | --- |
| session-loader | 两段式 ≈200 行,3 来源 | ≈3500 行,16 来源 + live 会话 + trace/token 事件 + 远程环境 | 只复现「本地文件 + 基础消息」;抽象接口(注册表/纯函数适配器/唯一 fs 模块)与原版同构 |
| 元数据 | title=文件名;时间戳 10^12 启发式归一 | summary 行提取;按格式约定 | 元数据规则简化,原始 ID 缺失回退文件名 |
| 增量索引 | stat 快照判定 | size+mtime + 字节偏移尾扫(增量字节拼接半行缓冲) | 尾扫为计划选做,未做(记录在案) |
| 会话键唯一性 | 同键不同文件先到先得 | 更复杂的来源内唯一语义 | 单文件粒度足够本阶段 |
| 迁移 | 自描述三件套 | v1 同款 / v2 PGlite 编号迁移 | 对比写进 ADR-006 |
| UI | CLI REPL(渲染层同位) | Electron App(3186 行 App.tsx) | 计划明确砍掉 UI |

## 6. 如果重来一次:会改的 3 个决定

1. **增量索引先读算法再实现**:初版「先解析后对比」返工成两段式 loader;开工前应把计划 2.2 的伪代码逐行对照。
2. **关键词语义从第一天就单一出处**:分词兜底逻辑曾在 fts 与 search 两处实现,演示阶段才暴露不一致;应在阶段 2 就定下「ftsQuery 唯一入口」。
3. **fixtures 用独立模块生成**:手写 JSONL 文本三处重复(sessionKey 与文件名的映射靠约定),改成 fixtures 生成脚本可避免评测数据集与语料的二次对齐成本。

## 7. 面试问答弹药库(索引)

各阶段「面试问答速查」的汇总入口:注册表/描述符(计划 1.7)、JSONL 解析与 tail-scan(1.7)、WAL(2.7)、FTS5/中文分词(2.7 + 本文坑 1)、增量判定 trade-off(2.7 + ADR-002)、迁移策略对比(2.7 + ADR-006)、zod 契约(3.7 + ADR-007)、查询分层(3.7)、ReAct 与停止条件(4.7)、工具调用安全边界(4.7)、改写工具式 vs 前置式(4.7 + ADR-008)、反思与重试的区别(4.7)、成本控制(4.7)、MCP 三原语/传输选择/零依赖 bundle(5.7 + ADR-009)、评测设计与防过拟合(6.4)。录音回听标记:每周讲解彩排后在此登记卡壳点。
