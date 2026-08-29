# AgentRecall 复现式系统学习计划

> **目标**：通过亲手构建一个完整可运行的项目 **mini-recall**（AgentRecall v1 的复现 + Agentic 化扩展），让你在技术面试中能对每个组件同时回答「**为什么这样设计**」和「**具体怎么实现**」。
> **总时长**：约 3~4 周（与简历上「一个月内公开 AgentRecall 相关仓库」的承诺对齐）。
> **阅读约定**：文中所有「真实源码」指 `AgentRecall/apps/main-1.0/src/` 下的对应文件，复现时务必边写边对照。

---

## 0. 总体设计：这个计划为什么长这样

### 0.1 一句话定位

**mini-recall = AgentRecall v1 的领域内核复现（Node + TypeScript + SQLite，不含 Electron UI）+ 在这个内核之上构建的「会话检索 Agent」（ReAct 决策循环 + 工具调用 + 查询改写 + 结果反思）+ MCP 对外暴露 + 评测闭环。**

为什么砍掉 Electron、只复现 `src/core`：
- AgentRecall v1 的**真实逻辑几乎全部在 `src/core/`**（会话加载、存储、索引、迁移），它是无 Electron 依赖、可单测的领域内核——这正是最值得复现的部分，也是面试官最爱追问的部分；
- UI（3186 行的 `App.tsx` 上帝组件）对面试加分有限，且会吃掉你一周时间；
- 简历上写的「SESSION_SOURCE_REGISTRY、增量索引、worker_threads、FTS5、MCP、多 Agent Chat、Workflow DAG」全部可以在 mini-recall 里以可运行代码落地。

### 0.2 阶段地图（前一阶段的产出 = 后一阶段的依赖）

```
阶段0 跑通原版+基线
   └→ 阶段1 领域内核（来源注册表/格式适配/加载器）      —— 产出：LoadedSession[]
        └→ 阶段2 存储与增量索引（SQLite+WAL+FTS5）       —— 产出：可查询的 SessionStore
             └→ 阶段3 查询服务与 zod 契约层 + CLI        —— 产出：受契约保护的 search API
                  └→ 阶段4 代理决策循环（ReAct+工具+改写+反思）—— 产出：Agentic 检索助手
                       └→ 阶段5 MCP 化（对外暴露为工具服务器）
                            └→ 阶段6 评测闭环 + 项目总结文档（PROJECT-RECAP）
```

### 0.3 与简历条目的对应关系（面试可追溯性）

| 简历上的话 | 本计划的落地点 |
| --- | --- |
| 「复现 SESSION_SOURCE_REGISTRY 注册表（capability 开关）」 | 阶段 1 |
| 「复现增量索引（size+mtime 跳变 + 字节偏移尾扫）」 | 阶段 2 |
| 「worker_threads 并行解析」 | 阶段 2（选做：把 indexer 挪进 worker） |
| 「FTS5 全文检索」 | 阶段 2 |
| 「代理决策循环 / 工具调用 / 查询改写 / 结果反思与迭代优化」 | 阶段 4 |
| 「零依赖 CommonJS MCP Server、STDIO 注册、工具发现」 | 阶段 5 |
| 「复现 Workflow v2 DAG 执行器 / 多 Agent Chat」 | 阶段 6 之后的方向性延伸（见附录 B） |
| 「拿到可量化的评测数据」 | 阶段 6 |

### 0.4 统一目录结构（一次搭好，各阶段往里填）

```
mini-recall/
├─ package.json            # type: "module"；scripts: dev / test / eval / build:mcp
├─ tsconfig.json           # strict: true, module: NodeNext, target: ES2023
├─ fixtures/               # 合成的会话文件（绝不用真实 ~/.claude 数据做测试）
│  ├─ claude/              #   claude 格式 jsonl 样例（正常 / 半行损坏 / 空文件）
│  └─ codex/               #   codex 格式 jsonl 样例
├─ src/
│  ├─ core/                # 阶段1-3：领域内核（对应 v1 的 src/core）
│  ├─ shared/              # 阶段3：zod 契约（对应 v1 的 src/shared/ipc）
│  ├─ agent/               # 阶段4：决策循环、工具、改写、反思
│  ├─ mcp/                 # 阶段5：MCP server
│  └─ cli.ts               # 阶段3：REPL 入口（扮演"渲染层"角色）
├─ scripts/
│  └─ build-mcp.mjs        # 阶段5：esbuild 打包零依赖 CJS bundle
├─ eval/                   # 阶段6：数据集 + 评测 harness
└─ docs/
   └─ PROJECT-RECAP.md     # 阶段6：长期回顾的项目总结（框架见第 8 节）
```

硬性工程约定（刻意对齐 AgentRecall 的仓库风格，面试时可以直接讲"我遵守了原仓库的工程约束"）：
- **纯 ESM、禁止路径别名**，import 一律相对路径（`../core/...`）；
- **`tsc --noEmit` 是唯一静态门禁**，每次提交前必跑；
- 测试用 **Vitest**，`*.test.ts` 与源码同目录；
- 涉及文件系统的测试一律用 `mkdtemp` 临时目录 + 合成 fixtures，**绝不读写真实 `~/.claude` / `~/.codex`**（对应原仓库 `AGENT_RECALL_TEST_HOME` 的安全约定）；
- 运行时锁定 **Node ≥ 22.13**（`node:sqlite` 的 `DatabaseSync` 需要）。

---

## 阶段 0：跑通原版、建立体感与基线（1~2 天）

### 目标与产出
- 原版 v1 在本机跑起来并亲手用一遍，建立「产品到底在做什么」的体感；
- mini-recall 骨架仓库建好，`npm test` / `tsc --noEmit` 全绿；
- 采一份**合成 fixtures**（自己手写 10 个 jsonl 文件，含正常/损坏/边界样例）。

### 操作清单
```bash
cd AgentRecall
npm run setup:v1     # 初始化 v1（等价于 node scripts/setup-app.mjs apps/main-1.0）
npm run dev:v1       # 启动开发模式
# 用默认来源（Claude Code / Codex）搜一次自己的会话；
# 去「设置 → 可选来源」开一个来源，点「更新索引」，观察索引过程。
```

同时建立 mini-recall 骨架：`git init`、按 0.4 的目录建空文件、写 `package.json`（`"type": "module"`）与 `tsconfig.json`，加一个恒通过的 `smoke.test.ts`。

### 验收标准
1. 原版 v1 可搜索、可查看会话（截图存档，将来写复盘用）；
2. mini-recall 仓库 `npm test` 与 `npx tsc --noEmit` 全绿；
3. fixtures 目录有 ≥10 个合成 jsonl，其中至少 1 个**最后一行是半行 JSON**（模拟 Agent 写会话中途崩溃的场景，阶段 1 的容错解析就靠它验收）。

### 坑点与调试
- **Windows 下 `npm ci` 慢/失败**：确认 Node ≥ 22.13；用仓库自带的 `setup-app.mjs` 而不是裸 `npm install`（它会跳过往真实 `~/.claude` 写 statusline 的步骤）；
- **Electron 二进制校验失败**：重跑 `setup:v1`，它会重新校验；别手动删 `node_modules` 排查，先看脚本输出。

---

## 阶段 1：领域内核 —— 来源注册表、格式适配与会话加载（3~4 天）

### 1.1 本阶段文件清单

| 文件 | 职责 | 对应真实源码 |
| --- | --- | --- |
| `src/core/types.ts` | 全部领域类型：`Session`、`SessionMessage`、`LoadedSession`、`SessionSource`、`SessionFormat`、`SessionSourceCapabilities` 等 | `src/core/types.ts` |
| `src/core/session-sources.ts` | **来源注册表** `SESSION_SOURCE_REGISTRY` + `SessionSourceDescriptor`；每个来源声明格式/族/能力开关 | `src/core/session-sources.ts` |
| `src/core/format-adapters.ts` | **格式适配器**：按行解析各来源的 jsonl，产出 `(session, messages)` | `src/core/format-adapters.ts` |
| `src/core/session-loader.ts` | **加载器**：遍历目录、找文件、调 adapter、组装 `LoadedSession[]` | `src/core/session-loader.ts`（原版约 3500 行，你写 ~150 行的简化版即可） |
| `session-sources.test.ts` / `format-adapters.test.ts` | 注册表不变量校验 + 解析容错测试 | 同目录 `*.test.ts` 约定 |

### 1.2 核心模块与输入输出

**① 来源注册表（本阶段的灵魂）**

```
输入：无（静态注册）
输出：SessionSourceDescriptor[]
```

`SessionSourceDescriptor` 至少包含（对照真实源码的同名结构）：

```ts
interface SessionSourceDescriptor {
  id: SessionSource;                    // "claude-cli" | "codex" | ... 你自己定义 3~4 个
  label: string;                        // UI 显示名
  format: SessionFormat;                // 解析格式，决定走哪个 adapter
  family: SessionSourceFamily;          // 同族来源（claude-cli 与 claude-app 同属 claude 族）
  optionalSetting: string | null;       // null = 默认开启；否则需要用户在设置里手动开
  capabilities: SessionSourceCapabilities; // 五个能力开关（见下）
}

interface SessionSourceCapabilities {
  live: boolean;        // 是否支持"正在运行"的会话
  resume: boolean;      // 是否支持续聊
  migrate: boolean;     // 是否支持把会话迁移到别的 Agent
  sessionSync: boolean; // 是否支持 hook 同步
  openApp: boolean;     // 是否支持"打开对应 App"
}
```

**面试要点（why）**：为什么用「注册表 + 描述符」而不是 switch-case？
- 新增来源 = 加一个对象，**不改任何已有分支**（开闭原则）；
- 能力开关让上层（UI / 索引器 / 迁移器）按**声明式能力**决定行为，而不是 `if (source === "codex")` 散落各处；
- 注册表自带不变量测试：每个 descriptor 字段完整性可以一条测试锁住——原仓库 `session-sources.test.ts` 就是这么干的，**这个抽象是自检查的**。
- 真实案例背书：原仓库里 `workbuddy-cli` 那一项五个能力全是 `false`（首版只读），正是「能力开关表达产品边界」的活例子。

**② 格式适配器**

```
输入：文件全文 text（string）
输出：{ session: Session; messages: SessionMessage[] } 或 null（解析失败）
```

接口只做一件事：**把某种 jsonl 格式的文本 → 领域对象**。不碰文件系统、不碰目录遍历（这是它和 loader 的分工）。

**③ 会话加载器**

```
输入：{ rootDir: string; sources?: SessionSource[] }   // rootDir 指向 fixtures 或真实目录
输出：LoadedSession[] = { session, messages }[]
副作用：读文件系统（仅此一个模块碰 fs）
```

### 1.3 模块调用关系与一次数据流转

```
sessionLoader.load({rootDir})
  ├─ 1. 从 SESSION_SOURCE_REGISTRY 取启用的 sources
  ├─ 2. 对每个 source：按其目录约定遍历 rootDir 下的 jsonl 文件
  ├─ 3. 每个文件 → formatAdapters[source.format].parseFile(text)
  │       ├─ 按行 split，逐行 JSON.parse（半行损坏 → 跳过该行并计数，不抛异常）
  │       └─ 提取 role/content/timestamp → SessionMessage[]
  └─ 4. 组装 LoadedSession{ session(含 source/file_path/message_count), messages }
```

「目录遍历」与「格式解析」分两层的原因（面试 why）：格式会横向增加（新 Agent），目录约定会纵向变化（新版本换存储路径）；分开后 loader 改动不影响 adapter 的测试，adapter 是**纯函数**、最好测。

### 1.4 验收标准
1. **可运行演示**：`node dist/cli.js? ` 本阶段用一条测试脚本代替——`npm test` 里跑通「fixtures → LoadedSession[]」并打印统计（每个来源多少会话、多少消息、跳过多少坏行）；
2. 半行损坏的 fixture 被容错跳过且**坏行数被统计出来**（不是静默吞掉）；
3. `session-sources.test.ts` 锁住注册表不变量（改坏一个 descriptor 字段，测试变红）。

### 1.5 演进动机（为什么要进入阶段 2）
阶段 1 的产出在内存里，进程一退就没了；而且每次全量重新解析很慢。**没有持久化与索引，就没有「查询」**——下一层抽象（SQLite + 增量索引）解决「数据生命周期」与「重复劳动」两个问题。

### 1.6 常见坑点与调试
| 坑 | 现象 | 调试思路 |
| --- | --- | --- |
| jsonl 里有 BOM | 第一行 `JSON.parse` 失败 | 读文件后 `text.replace(/^\uFEFF/, "")` |
| 半行 JSON | 解析抛异常导致整文件丢弃 | try/catch 每行，坏行计数进结果 |
| 时间戳格式不统一 | timestamp 有的是秒有的是毫秒 | 在 adapter 里统一归一成 ms，写一条边界测试 |
| 相对路径 import 拼错 | tsc 报 cannot find module | 全仓禁别名，用 `../core/types.js`（NodeNext 记得带 `.js` 后缀） |

### 1.7 面试问答速查
- **Q：SessionSource 和 Family 为什么要分两个字段？** A：一来源一 ID（精确解析），family 表达同族共享行为（同族可合并统计、共享 live 监听）；原仓库 `claude-cli` / `claude-app` 不同 id 同 family 就是这个用途。
- **Q：JSONL 相比 JSON 的工程优势？** A：追加写（Agent 边跑边记）、按行流式解析、tail-scan 只读增量字节——这是阶段 2 增量索引的前提条件。
- **Q：你的 loader 和原版 3500 行的差距在哪？** A（诚实版）：原版处理 16 个来源、live 会话、trace 事件、token 事件、远程环境；我只实现 3 个来源 + 本地 + 基础消息，但**抽象接口与原版一致**，扩展点都在。

---

## 阶段 2：存储与增量索引 —— SQLite + WAL + FTS5（4~5 天）

### 2.1 本阶段文件清单

| 文件 | 职责 | 对应真实源码 |
| --- | --- | --- |
| `src/core/store/database.ts` | `node:sqlite` 的 `DatabaseSync` 封装：open 真实库 / `createInMemoryStore()` 测试库 | `src/core/store/database.ts` |
| `src/core/store/schema.ts` | `migrateMiniRecallStore(db)`：建表 + `addColumnIfMissing` + 一次性数据迁移表 | `src/core/store/schema.ts` |
| `src/core/store/sessions.ts` | sessions 表读写：`upsertIndexedSession`、`get`、`list` | `src/core/store/sessions.ts` |
| `src/core/store/messages.ts` | messages 表读写 | `src/core/store/messages.ts`（原版在 store/ 下同类文件） |
| `src/core/store/fts.ts` | FTS5 虚拟表、内容同步、`searchContent()` | v1 的 FTS5 检索逻辑 |
| `src/core/indexer.ts` | `syncDefaultSessions` + 增量索引（size+mtime、字节偏移尾扫） | `src/core/indexer.ts` |
| `indexer.test.ts` | 增量正确性测试（改一个文件 → 只重索引它） | 同目录约定 |

### 2.2 核心模块与输入输出

**① 存储与迁移**

```
输入：DatabaseSync 实例
输出：完成建表/迁移的库（幂等，可重复执行）
```

表设计直接对标真实 `schema.ts`（字段可精简，但**键与增量判定字段必须保留**）：

```sql
CREATE TABLE IF NOT EXISTS sessions (
  session_key TEXT PRIMARY KEY,      -- 业务主键（source + raw_id 派生）
  raw_id TEXT NOT NULL, source TEXT NOT NULL,
  project_path TEXT NOT NULL, file_path TEXT NOT NULL,
  original_title TEXT NOT NULL, first_question TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  file_mtime_ms REAL NOT NULL,       -- ─ 增量判定的两个锚点
  file_size INTEGER NOT NULL,        -- ─ 同上
  message_count INTEGER NOT NULL DEFAULT 0,
  indexed_at INTEGER NOT NULL DEFAULT 0,
  content_indexed_mtime_ms REAL NOT NULL DEFAULT 0,  -- 上次内容索引时的快照
  content_indexed_size INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
  session_key TEXT NOT NULL, message_index INTEGER NOT NULL,
  role TEXT NOT NULL, content TEXT NOT NULL, timestamp TEXT NOT NULL,
  PRIMARY KEY (session_key, message_index),
  FOREIGN KEY (session_key) REFERENCES sessions(session_key) ON DELETE CASCADE
);
```

关键工程决策（面试 why）：
- **WAL 模式**：`PRAGMA journal_mode = WAL`，让**只读进程（阶段 5 的 MCP server）能在主程序写入时并发读**——这是「为什么开 WAL」的标准答案，原代码注释原文就是这个理由；
- **无编号迁移**：`CREATE TABLE IF NOT EXISTS` + `addColumnIfMissing` + 已执行迁移记在 `data_migrations` 表。**能对比**：v2 用 PGlite + 编号只追加迁移。为什么不同？迁移数量与团队规模：小同步库「自描述式」够用；大异步库需要可审查、可回放的迁移历史。这个对比是很好的面试展开点。

**② 增量索引**

```
输入：SessionStore + LoadOptions（+ forceReindex 谓词）
输出：IndexStatus { indexed, skipped, total, lastIndexedAt, error }
```

算法（对标真实 `indexer.ts` 的 `syncDefaultSessions` + `BatchIndexOptions`）：

```
for 每个 LoadedSession:
  取库里该 session 的 content_indexed_mtime_ms / content_indexed_size
  if (文件 size 相同 && mtime 相同) → skipped++，跳过解析      // 绝大多数文件走这里
  else → 调 store.upsertIndexedSession(session, messages)，indexed++
```

进阶（选做，简历写了就做）：**字节偏移尾扫**——若文件只在尾部追加（Codex 的典型模式），记录上次读到的字节偏移，下次只 parse 增量字节拼接半行缓冲。这正是为什么阶段 1 的 adapter 要支持「从中间开始按行解析」。

**③ FTS5 全文索引**

```
输入：searchContent(query: string, limit?: number)
输出：{ session_key, snippet }[]（bm25 排序）
```

对 `messages.content` 建 FTS5 虚拟表（contentless 或 external content + 触发器同步）。

### 2.3 一次数据流转（写入侧全链路）

```
磁盘 jsonl
  → session-loader.load()           // 阶段1 产出：LoadedSession[]
  → indexer.syncDefaultSessions()   // 增量判定：size+mtime
  → store.upsertIndexedSession()    // upsert sessions + messages + FTS5 同步
查询侧（本阶段末尾能手工验证）：
sqlite> SELECT ... FROM sessions JOIN messages ... / searchContent('关键词')
```

### 2.4 验收标准（可量化）
1. **增量索引演示**：脚本连跑两次 `sync`，第二次输出 `indexed: 0, skipped: N`；改动 fixtures 中 1 个文件后再跑，输出 `indexed: 1`；
2. **性能对比数据**（存进 PROJECT-RECAP）：首次全量索引耗时 vs 增量耗时（预期 10~100 倍差距）；`LIKE '%kw%'` vs FTS5 查询耗时对比（造 1 万条消息的合成数据）；
3. 内存库测试：`createInMemoryStore()` 跑全套 store 测试，不落盘。

### 2.5 演进动机（为什么要进入阶段 3）
数据进库了，但查询能力只有裸 SQL。用户（以及阶段 4 的 Agent）需要的是**结构化的查询接口**：多条件过滤、分页、统计、以及**类型安全的调用边界**——跨层调用没有契约校验，脏参数会在运行时才炸。这就是 zod 契约层 + 查询服务的动机。

### 2.6 常见坑点与调试
| 坑 | 现象 | 调试思路 |
| --- | --- | --- |
| node:sqlite 不可用 | `DatabaseSync is not defined` | Node 版本 < 22.5；用受管的 Node 22 运行 |
| 中文检索不命中 | 英文关键词能搜到、中文搜不到 | FTS5 默认 `unicode61` 分词把 CJK 按单字切；查证原仓库的 tokenizer 选择（面试可主动聊这个坑：可用 `trigram` tokenizer 改善中文短语匹配） |
| upsert 后 message 重复 | 消息翻倍 | upsert 语义要「先删该 session 的 messages 再插」或用 `INSERT OR REPLACE`，并写重复索引测试 |
| WAL 文件残留 | 目录下有 -wal/-shm | 正常现象；测试结束 `db.close()` 即可回收 |
| mtime 精度问题 | 内容变了但 mtime 未变（少见） | 原仓库同样用 size+mtime，接受这个 trade-off 并提供 forceReindex 兜底——能讲清 trade-off 比盲目换 hash 强 |

### 2.7 面试问答速查
- **Q：为什么 size+mtime 而不是文件 hash？** A：会话文件可能很大，每次全量读算 hash 的 IO 成本 ≈ 重新解析；mtime+size 在 99% 情况下足够判定，成本是两次 stat。漏判兜底是 forceReindex。
- **Q：WAL 是什么、为什么你的场景需要？** A：Write-Ahead Logging，写先记日志再入库，读写不再互斥。我的场景：主程序写索引 + MCP 只读进程并发查询，不开 WAL 读方会被写锁阻塞。
- **Q：FTS5 的 bm25 是什么？** A：词频相关的概率排序函数（TF-IDF 变体），短字段/稀有词权重更高；比 LIKE 全表扫快几个数量级（你自己的对比数据就是证据）。
- **Q：worker_threads 有什么用（简历写了）？** A：索引是 CPU 密集的解析任务，放 worker 不阻塞主进程事件循环；原仓库 `session-index-worker.ts` 通过队列串行化 + 第二 rollup input 打包。你的选做实现即对应此点。

---

## 阶段 3：查询服务与契约层 + CLI「渲染层」（约 3 天）

### 3.1 本阶段文件清单

| 文件 | 职责 | 对应真实源码 |
| --- | --- | --- |
| `src/core/search.ts` | 查询解析（过滤语法）、`searchSessions`、分页、统计 | `src/core/session-store.ts` + `store/sessions.ts` 的查询部分 |
| `src/shared/contract.ts` | `defineCommand(name, zodSchema)` 契约工厂 + `parseArgs` | `src/shared/ipc/contract.ts`（`defineIpcRequest` + zod 校验范式） |
| `src/shared/commands.ts` | 把同一域的命令契约聚成一个对象（搜索/消息/统计） | `src/shared/ipc/providers.ts` 的聚合范式 |
| `src/cli.ts` | REPL：读命令 → 契约校验 → 调 core → 渲染结果 | preload + App.tsx 的角色替身 |

### 3.2 核心模块与输入输出

**① 查询服务（文档检索模块）**

```
输入：SearchFilters {
  query?: string;          // FTS5 关键词（命中 messages 内容）
  source?: string;         // 来源过滤
  project?: string;        // 项目路径前缀
  after?: number;          // 时间下界（ms）
  before?: number;
  limit?: number; offset?: number;
}
输出：{ items: SessionSummary[]; total: number; tookMs: number }
```

实现要点：关键词走 FTS5、结构化过滤走普通 SQL，**两路结果按 session_key JOIN 合并**；排序支持时间倒序与相关度两种。统计接口返回按 source / 按日的会话数分布（对应原版「搜索统计」能力）。

**② zod 契约层**

```ts
export function defineCommand<S extends z.ZodType>(name: string, schema: S) {
  return { name, schema, parse(input: unknown) { return schema.parse(input); } };
}
export const SEARCH_CMD = defineCommand("search", z.object({
  query: z.string().optional(), limit: z.number().int().min(1).max(200).default(50), ...
}));
```

**面试要点（why 契约层）**：原仓库把请求参数用 zod 校验（`defineIpcRequest(channel, z.tuple([...]))`），因为 **IPC/进程边界上类型系统失效**——渲染层传来的值是 `unknown`，编译期查不出来。契约同时给出：运行时校验（坏参数立刻抛）、类型推导（handler 签名自动收紧）、以及「同一份 schema 既做校验又做文档」。你的 CLI 层扮演跨边界角色，问题域完全同构。

**③ CLI REPL**

```
> search --query "RAG" --source claude --after 2026-08-01
  12 hits (took 4ms)   ← 表格输出 session 摘要
> messages <session_key> --tail 20
```

### 3.3 一次请求的完整穿越路径（本阶段的「标准答案」，务必背熟）

```
用户在 CLI 输入命令
  → 1. cli.ts 词法切分 argv
  → 2. SEARCH_CMD.parse(argv对象)          // zod 校验：非法 limit 在这里被拦
  → 3. searchSessions(filters)             // core 查询服务
  → 4. 关键词 → fts.searchContent()        // FTS5 倒排命中候选 session_key 集
  → 5. 结构化过滤 → sessions 表 SQL WHERE  // 与 4 的结果求交
  → 6. 分页/排序 → 组装 SessionSummary[]
  → 7. 沿调用链返回 → cli 渲染表格 + tookMs
```

对照原版（面试常问「前后端怎么通信」）：`App.tsx` → `api.searchSessions()`（preload）→ `ipcRenderer.invoke("search:sessions")` → `ipcMain.handle` → core 查询 → 原路返回。你的 2↔3 之间那道 zod 边界，等价于原版 preload↔main 的 IPC 契约边界。

### 3.4 验收标准
1. **可运行演示**：REPL 里完成「搜索 → 看消息 → 统计」闭环，录屏或截图存档；
2. 非法参数（`limit: -1`、未知字段）被 zod 拒绝并给出字段级错误信息（测试覆盖）；
3. 记录典型查询的 `tookMs` 基线数据（阶段 6 的对照组之一）。

### 3.5 演进动机（为什么要进入阶段 4）
到目前为止，检索是「**用户会构造查询**」的。但真实需求是「**用户只会问自然语言**」：『上周我在哪个会话里调过 Rerank？』——把这句话变成 `SearchFilters` 需要 LLM；检索结果不够好需要改写再检索；多步问题需要规划。这就是代理决策循环的登场理由：**把「查询构造」从人交给 Agent**。

### 3.6 常见坑点与调试
| 坑 | 现象 | 调试思路 |
| --- | --- | --- |
| zod `.default()` 不生效 | 校验前就用了字段 | default 只在 `parse` 时应用；先 parse 再用返回值 |
| FTS5 与 SQL 过滤合并错 | 关键词过滤了两套结果 | 先跑 FTS 得 key 集合，再用 `IN (...)` 交集，别两个独立查询拼数组 |
| 分页 total 不对 | limit 生效但 total 全量 | total 用单独 COUNT 查询 |
| REPL 中文输入乱码 | Windows 终端编码 | `chcp 65001` 或用 VSCode 内置终端跑 |

### 3.7 面试问答速查
- **Q：为什么查询服务和存储层分开？** A：存储层管持久化语义（upsert/事务），查询层管检索语义（过滤/排序/分页）；合并会让 SQLite 细节泄漏到调用方。对应原版 `SessionStore` 门面盖在子 store 上的分层。
- **Q：CLI 为什么算「渲染层」？** A：架构上它和 App.tsx 同位——都是「收集输入 → 调契约 API → 渲染输出」的边界层；我故意保持 core 不感知 CLI，将来换成 Electron preload 不用动 core（这就是分层的可迁移性论据）。

---

## 阶段 4：代理决策循环 —— ReAct Agent + 工具调用 + 查询改写 + 反思（5~6 天，核心阶段）

> 本阶段把 mini-recall 从「检索工具」升级成「会话检索 Agent」：用户问自然语言问题，Agent 自主决定查什么、怎么改写、何时反思、何时给最终答案。这是面试中「代理决策循环 / 工具调用 / 查询改写 / 结果反思与迭代优化」四个关键词的落地现场。

### 4.1 本阶段文件清单

| 文件 | 职责 |
| --- | --- |
| `src/agent/llm.ts` | `LlmProvider` 接口（chat + tool calling）+ OpenAI 兼容实现 + **`MockLlm`**（测试用，零成本、确定性） |
| `src/agent/tools.ts` | **工具注册表**：每个工具 = name + description + JSON Schema 参数 + execute；工具集：`search_sessions` / `get_messages` / `list_sources` / `now` |
| `src/agent/rewrite.ts` | **查询改写**：LLM 把自然语言问题 → `SearchFilters`（zod 校验结构化输出） |
| `src/agent/reflect.ts` | **结果反思**：评估检索结果与问题的匹配度，输出「足够回答 / 需要新查询（附改写建议）」 |
| `src/agent/prompt.ts` | system prompt 组装（角色、工具使用规则、引用溯源要求） |
| `src/agent/loop.ts` | **决策循环主体**：消息历史、工具调度、停止条件、事件流输出 |
| `agent/*.test.ts` | 用 MockLlm 做「脚本化对话」测试（不花一分钱跑 CI） |

### 4.2 核心模块与输入输出

**① 工具调用（tools.ts）**

```
Tool = {
  name: string;
  description: string;            // 给模型看的自然语言说明
  parameters: JSONSchema;         // 给模型看的参数 schema
  execute(args): Promise<ToolResult>;  // 输入经 zod parse 后的类型安全执行
}
```

工具即阶段 3 能力的**面向模型的封装**：`search_sessions` 的 parameters 直接复用 `SEARCH_CMD` 的 zod schema 转 JSON Schema——**契约层在这里二次复用**（面试讲「同一份 schema 服务三个消费者：CLI 校验、TS 类型、模型工具描述」，这是很强的设计一致性论据）。

**② 决策循环（loop.ts）—— ReAct 范式**

```
输入：{ question: string; maxSteps?: number; llm: LlmProvider }
输出：{ answer: string; steps: AgentStep[]; usage: { toolCalls, promptTokens, ... } }

循环体（每步 = 一个 AgentStep）：
  1. 组装 messages（system + 历史 + 用户问题 + 工具观察结果）
  2. llm.chat(messages, tools) → 返回 { content? , toolCalls? }
  3. if toolCalls：逐个校验参数 → execute → 把结果作为 tool 消息追加进历史 → 回到 1
  4. if content 且无 toolCalls：视为最终答案 → 终止
停止条件（缺一不可，面试必问）：
  - maxSteps 超限（默认 8）：强制收尾，返回「已达步数上限 + 目前已知信息」
  - 工具连续失败 ≥ 3 次：熔断退出而不是无限重试
  - 重复调用检测：同一工具 + 同一参数 hash 已出现过 → 拒绝执行并把「你已查过」回喂模型
```

**③ 查询改写（rewrite.ts）**

```
输入：{ question: string; llm }
输出：SearchFilters（经 zod 校验；解析失败 → 降级为 { query: 原句关键词 }）
```

两种接入位置（面试对比题）：
- **前置式**（简单）：进循环前先改写一次——快，但无法根据检索结果调整；
- **工具式**（你的默认实现）：`rewrite_query` 本身作为一个工具，由决策循环**按需**调用、并可在反思后再次调用——这是「迭代优化」的实现载体。

**④ 结果反思（reflect.ts）**

```
输入：{ question: string; searchResults: SessionSummary[] }
输出：{ verdict: "sufficient" | "insufficient"; reason: string; suggestedQuery?: SearchFilters }
```

反思的判据写进 prompt：结果是否覆盖问题的时间范围？是否包含问题中的实体（项目名/技术词）？`insufficient` 时给出**具体改进方向**（改时间过滤、换关键词、拆子问题），由 loop 决定是否再调 `rewrite_query` + `search_sessions`。上限轮次继承 maxSteps。

### 4.3 一次请求的完整穿越路径（Agent 版，背熟）

```
用户："上周我在哪个会话里调过 Rerank？"
  → 1. loop.run(question)
  → 2. prompt 组装 → llm.chat（附 4 个工具的 schema）
  → 3. 模型返回 toolCalls: [now()]                    // 先拿当前时间锚定"上周"
  → 4. loop 执行 now → 观察结果入历史
  → 5. 模型返回 toolCalls: [rewrite_query(question="...Rerank... 上周")]
  → 6. rewrite → zod 校验 → SearchFilters{query:"Rerank", after: <now-7d>}
  → 7. 模型返回 toolCalls: [search_sessions(filters)]
  → 8. 走阶段3链路：契约 parse → searchSessions → FTS5+SQL → 命中 3 条
  → 9. 模型（或显式 reflect 调用）判定 sufficient → toolCalls: [get_messages(key, tail)]
  → 10. 模型生成最终答案，附会话标题与 session_key（引用溯源）
  → 11. loop 终止，返回 answer + 全部 steps（审计轨迹）
```

注意第 7 步之后完全复用阶段 3 的链路——**Agent 是检索内核之上的编排层，不是替代**。这就是「前一阶段产出是后一阶段基础」的最直观证明。

### 4.4 验收标准
1. **可运行演示**：CLI 里 `ask "上周我在哪个会话里讨论过 FTS5？"` 之类 5 个问题，Agent 正确完成 ≥4 个（工具轨迹用 `--trace` 打印每一步的 toolCall/观察摘要）；
2. **可量化对比**（阶段 6 的主数据来源）：同一批问题上——直接 FTS5 关键词检索 vs 改写后检索 vs 完整 Agent 循环的命中率（recall@5）对比表；
3. 停止条件全部有测试：maxSteps 触发、重复工具调用被拒、工具连续失败熔断（用 MockLlm 脚本化触发）；
4. MockLlm 让全流程测试 **0 token 成本跑进 CI**。

### 4.5 演进动机（为什么要进入阶段 5）
现在检索能力只被你自己的 CLI 独占。而生态里真正需要这个能力的**是别的 Agent**（Claude Code / WorkBuddy 在对话中想反查历史会话）。把能力以标准协议暴露出去 = MCP。这也是 AgentRecall 原版「让外部 Agent 通过 MCP 搜历史会话」的设计动机——你的项目在此刻和原版动机完全合流。

### 4.6 常见坑点与调试
| 坑 | 现象 | 调试思路 |
| --- | --- | --- |
| 模型不调工具/乱调 | 一直输出文本或参数瞎编 | description 写清「何时用我」；参数 schema 收紧（enum/范围）；system prompt 给 1-shot 示例 |
| 幻觉 session_key | 答案引用不存在的会话 | 答案里的 key 必须来自工具观察结果——prompt 强约束 + 输出校验（不在观察集合里就要求重答） |
| 无限循环 | 反复 search 相同参数 | 重复调用检测（工具名+参数 hash 集合）+ maxSteps 双保险 |
| LLM 结构化输出解析失败 | rewrite 结果不是合法 JSON | zod safeParse + 失败降级策略（用原句关键词），记日志不崩溃 |
| 真实 API 测试昂贵且不稳定 | CI 时不时挂 | CI 只跑 MockLlm；真实 API 用 `eval` 命令手动触发 |

### 4.7 面试问答速查（本阶段是面试主战场，多背几条）
- **Q：ReAct 是什么、为什么选它？** A：Reason+Act 交替：模型先推理（该查什么）再行动（调工具）再观察（结果入上下文）再推理。适合探索式、多步、依赖中间结果的检索任务。对比 Plan-and-Execute（先全盘规划再执行）：规划型省调用、适合结构固定任务；我的场景查询依赖中间反馈，ReAct 更合适。
- **Q：工具参数怎么交给模型？** A：把每个工具的 name/description/JSON Schema 放进 chat 请求的 tools 字段（OpenAI function calling 协议）；模型返回 toolCalls，我方**必须**用同一份 zod schema 校验后再执行——模型输出不可信任，校验层是安全边界。
- **Q：查询改写解决什么问题？** A：词汇失配（用户说「重排」库里有「Rerank」）、时间表达解析（「上周」→ 时间窗）、结构化条件抽取。本质是把自然语言投影到检索系统的查询空间。
- **Q：反思和简单重试的区别？** A：重试 = 同样输入再来一次（解决随机性）；反思 = 显式评估失败原因并生成**不同的**下一步查询（解决系统性差距）。我的 reflect 输出 verdict + 具体改进建议，loop 据此改路。
- **Q：Agent 的成本怎么控制？** A：maxSteps、重复调用拦截、token 预算、短上下文摘要（观察结果截断/snippet 化而不是全文塞入）、以及「先关键词后 Agent」的分级路由。

---

## 阶段 5：MCP 化 —— 对外暴露为标准工具服务器（2~3 天）

### 5.1 本阶段文件清单

| 文件 | 职责 | 对应真实源码 |
| --- | --- | --- |
| `src/mcp/server.ts` | STDIO JSON-RMC server：`initialize` / `tools/list` / `tools/call` | `src/mcp/` 打包产物 + `bin/agent-recall-mcp.mjs` |
| `src/mcp/registration.ts` | 工具注册表 → MCP tool 描述（复用 agent/tools.ts 的 schema） | MCP 工具发现与按需注入设计 |
| `scripts/build-mcp.mjs` | esbuild 把 server 打成**零依赖单文件 CJS bundle** | `scripts/build-mcp-bundle.mjs` |
| `src/mcp/db-pointer.ts` | 写 `~/.mini-recall/db-path` 指针文件，让**进程外**的 server 定位数据库 | 原版 `~/.agent-recall/db-path` 机制 |

### 5.2 核心模块与输入输出

```
server 输入：stdin 上的 JSON-RPC 消息（MCP 协议）
server 输出：stdout JSON-RPC 响应
  initialize → { capabilities: { tools: {...} } }
  tools/list → 4 个工具的 name/description/inputSchema
  tools/call { name: "search_sessions", arguments } → 校验 → 只读查询 → { content: [{ type: "text", text }] }
```

两个关键设计（面试 why，都有原版背书）：
- **只读打开 + WAL**：server 以 readonly 模式打开 SQLite（阶段 2 开的 WAL 在这里兑现价值——主程序写、server 读、互不阻塞）；
- **db 指针文件**：因为应用的数据目录在 dev/打包两种形态下路径不同，主程序把真实路径写进 `~/.mini-recall/db-path`，进程外的 server 读指针定位库，**不 import 应用代码、不需要应用配置**。

### 5.3 一次请求穿越路径（跨进程版）

```
外部 Agent（如 Claude Code）收到用户问题
  → 其宿主按注册信息 spawn 你的 server（STDIO）
  → initialize 握手
  → tools/list 发现 search_sessions / get_messages ...
  → 模型决定调用 → tools/call (JSON-RPC over stdin)
  → server：zod 校验 → 复用阶段3 searchSessions → WAL 只读查询
  → 结果 JSON 序列化 → stdout 返回 → 外部 Agent 拿到观察继续推理
```

### 5.4 验收标准
1. **可运行演示**：把 `mini-recall-mcp` 注册进 Claude Code / WorkBuddy 的 MCP 配置，在一次真实对话里让宿主 Agent 调 `search_sessions` 搜到你的会话（截图，含「模型确实自主选择了该工具」的证据）；
2. bundle 产物 `node mini-recall-mcp.cjs` 直接运行（无 node_modules、零依赖）；
3. 主程序写库的同时 server 查询不被阻塞（并发测试，WAL 验收）。

### 5.5 演进动机（为什么要进入阶段 6）
功能全部就位，但所有「好不好」的论断还是定性感觉。面试官一定会问「你怎么证明这套东西有用/更快/更准」——没有评测数据，前面所有阶段的对比都只是修辞。评测闭环 + 文档化复盘，是把项目从「玩具」变成「作品」的最后一层。

### 5.6 常见坑点与调试
| 坑 | 现象 | 调试思路 |
| --- | --- | --- |
| stdout 混入日志 | 宿主解析 JSON-RPC 失败 | MCP server 的 stdout **只许协议消息**，日志全部走 stderr |
| CJS/ESM 混战 | bundle 后 `require is not defined` | esbuild 打包为 cjs 单文件，别保留动态 import |
| Windows 换行 | JSON-RPC 帧解析失败 | 按 `Content-Length` 头或行分隔协议解析时处理 `\r\n` |
| server 找不到库 | 指针文件不存在 | 先跑一次主程序索引生成 db-path；server 报可诊断错误而非静默空结果 |

### 5.7 面试问答速查
- **Q：MCP 三大原语？** A：Tool（可执行能力，模型主动调用）、Resource（可读数据，类似文件/数据源）、Prompt（可复用提示模板）。我的场景核心是 Tool。
- **Q：STDIO vs HTTP 传输怎么选？** A：本地单机工具选 STDIO——宿主直接 spawn 子进程，零网络、天然隔离、认证简单；HTTP/SSE 适合远程共享、多消费者。原仓库也同时支持两种注册。
- **Q：为什么要零依赖 bundle？** A：server 装在用户机器上全局可用（免 `npm i -g` 拖依赖树）、启动快、和应用主进程解耦（应用升级不破坏 server）。原版 `bin/*.cjs` 同一哲学：**不 import src/、免构建可运行**。

---

## 阶段 6：评测闭环与项目总结（约 3 天 + 长期维护）

### 6.1 本阶段文件清单

| 文件 | 职责 |
| --- | --- |
| `eval/dataset.json` | 30~50 个问题 + 标注（期望命中的 session_key / 关键证据片段 / 时间窗），从 fixtures + 真实历史（脱敏抽样）构造 |
| `eval/harness.ts` | 三模式跑批：A=直接关键词检索；B=+查询改写；C=完整 Agent 循环；输出对比表 |
| `eval/metrics.ts` | recall@k、MRR、平均工具调用轮数、平均 token 消耗、端到端耗时 |
| `docs/PROJECT-RECAP.md` | 项目总结文档（框架见第 8 节，长期回顾的唯一入口） |

### 6.2 评测设计要点
- **对照实验**：同一 dataset 跑 A/B/C 三模式，控制变量（同 LLM、同温度=0、同 maxSteps）；
- **报告样例（数字是占位，跑出来填真值）**：

| 模式 | recall@5 | MRR | 平均轮次 | 平均 token | 平均延迟 |
| --- | --- | --- | --- | --- | --- |
| A 直接检索 | __% | __ | 1 | 0 | __ms |
| B +查询改写 | __% | __ | 1(+1次LLM) | __ | __ms |
| C 完整 Agent | __% | __ | __ | __ | __s |

- 诚实原则：如果 C 在某些类别反而差（成本高、延迟大），**照实写进复盘**——「知道自己的系统何时不该用」是高级工程师的信号，也是面试的加分回答。

### 6.3 验收标准
1. `npm run eval` 一条命令产出上表（JSON + Markdown 双格式）；
2. 至少 3 条有洞察的结论（例：「改写对时间类问题提升最大，因为时间窗解析无法靠关键词」「Agent 模式对多跳问题（先查 A 再查 B）显著优于单次检索」）；
3. PROJECT-RECAP.md 完成初稿（含全部 ADR 与各阶段对比数据）。

### 6.4 常见坑点
| 坑 | 调试思路 |
| --- | --- |
| 过拟合 eval 集 | 出题时别看着检索结果出题；留 20% 做 hold-out |
| LLM 输出不稳定 | 温度 0、固定 seed（若支持）、每模式跑 3 次取中位数 |
| 指标只看 recall | 补 precision（命中但无关也算错）与人工 spot-check |

---

## 7. 横切要求：每周固定动作

1. **每周一次「讲解彩排」**：对着本周产出，不看笔记给自己讲 15 分钟「一次请求怎么穿越我的系统」，讲卡壳的地方就是知识盲区，当天补；
2. **每个阶段结束写一条 ADR**（模板见下节）——面试被问「为什么这么设计」时，你的回答直接来自决策记录而不是临场编；
3. **每个阶段在真实仓库里找「对照物」**：写完 mini 版，去 AgentRecall 源码里看同一问题的工业解法差在哪（例：我的 loader 150 行 vs 原版 3500 行，差异就是面试里「你和工业级的差距」的诚实答案）；
4. typecheck + test 全绿再进下一阶段，**不留「回头再修」**。

---

## 8. 项目总结文档框架（docs/PROJECT-RECAP.md，可长期回顾）

```markdown
# mini-recall 项目总结
## 1. 项目一句话 & 架构总览图（一张 ASCII/mermaid 全链路图）
## 2. 架构决策记录（ADR，每条一页）
   模板：
   - ADR-00X：<标题，如「增量索引采用 size+mtime 而非内容 hash」>
   - 背景：遇到什么问题
   - 备选方案：至少 2 个
   - 决策：选了什么
   - 理由与代价：为什么、放弃了什么、什么条件下应重新评估
   - 状态：已接受 / 已被 ADR-00Y 取代
   建议条目：注册表模式 / WAL / 无编号迁移 / zod 契约 / ReAct 循环 /
             改写作为工具而非前置 / 反思判定标准 / MCP 传输选 STDIO / 零依赖 bundle
## 3. 关键问题复盘（每个坑一节）
   模板：现象 → 根因 → 定位过程（用了什么工具/日志）→ 修复 → 预防（测试/约定）
   候选：半行 JSON 容错 / 中文 FTS5 分词 / upsert 消息重复 / Agent 无限循环 /
         幻觉 session_key / MCP stdout 污染
## 4. 各阶段效果对比
   - 阶段2：全量 vs 增量索引耗时；LIKE vs FTS5
   - 阶段3：典型查询延迟基线
   - 阶段6：A/B/C 三模式对比表（6.2 的最终数字）
   - 逐阶段 LOC / 测试数 / 覆盖率曲线
## 5. 与 AgentRecall 工业实现的差异清单（诚实差距表）
   我的实现 vs 原版对应文件 vs 差距原因（简化假设是什么）
## 6. 如果重来一次：会改的 3 个决定
## 7. 面试问答弹药库（各阶段速查的汇总 + 自己录音回听标记）
```

---

## 附录 A：总时间表与里程碑

| 周 | 阶段 | 里程碑产出 |
| --- | --- | --- |
| 第 1 周前半 | 阶段 0 + 1 | 原版跑通；mini-recall 解析层可用 + 测试绿 |
| 第 1 周后半 | 阶段 2 | 增量索引 + FTS5 可查询；性能对比数据 v1 |
| 第 2 周 | 阶段 3 + 4 前半 | CLI 闭环；工具注册表 + loop 骨架 |
| 第 3 周 | 阶段 4 后半 + 5 | Agentic 检索助手演示；MCP 注册进真实 Agent |
| 第 4 周 | 阶段 6 | eval 报告 + PROJECT-RECAP 初稿 + 仓库公开（README + 演示 GIF） |

## 附录 B：做完之后的方向延伸（对应简历上 v2 相关表述）

- **Workflow DAG 执行器**：在 `loop.ts` 之上加一层 DAG 编排（节点=Agent/工具/脚本，边=数据依赖），对标 v2 `workflow-v2-executor.ts` 的 orchestrator/executor/reviewer 三角色——这是从「单 Agent」到「多 Agent 协作」的下一步抽象；
- **进入 v2 的正确姿势**：不要直接读 `src/automation/`（vendored 上游引擎，约 430 文件），先读稳定的接缝 `src/automation/contracts.ts`，入口是 `engine/main/hub/agent-hub.ts`（状态机）与 `workflow-v2-executor.ts`（DAG 执行）；
- **数据层对比课题**：v2 用 PGlite + 编号只追加迁移 vs v1 的 SQLite + 自描述迁移——把两者差异整理成一篇短文，是很好的面试谈资。

## 附录 C：全程面试问答总索引（速查）

| 主题 | 阶段 | 高频问题 |
| --- | --- | --- |
| 注册表/描述符模式 | 1 | 为什么不用 switch；能力开关如何驱动上层 |
| JSONL 解析 | 1 | 流式、容错、tail-scan 前提 |
| WAL | 2 | 是什么；读写并发场景 |
| FTS5 | 2 | 倒排/bm25；中文分词坑 |
| 增量索引 | 2 | size+mtime vs hash 的 trade-off |
| 迁移策略 | 2 | 自描述 vs 编号迁移的适用场景 |
| zod 契约 | 3 | 跨边界类型安全；schema 多消费者复用 |
| 查询分层 | 3 | 存储语义 vs 检索语义分离 |
| ReAct | 4 | 范式对比；循环停止条件 |
| 工具调用 | 4 | schema 交付方式；输出校验即安全边界 |
| 查询改写 | 4 | 词汇失配/时间解析；工具式 vs 前置式 |
| 反思迭代 | 4 | 与重试的区别；判据设计 |
| 成本控制 | 4 | maxSteps/重复拦截/上下文裁剪/分级路由 |
| MCP | 5 | 三原语；传输选择；零依赖 bundle 理由 |
| 评测 | 6 | 指标设计；对照实验；不过拟合 |
```
