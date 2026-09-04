# mini-recall 当前进度

> AgentRecall v1 的复现式学习仓库:领域内核(Node + TypeScript + SQLite,不含 Electron UI)+ 会话检索 Agent(ReAct)+ MCP 对外暴露 + 评测闭环。
> **首次运行请先读《[运行指南](docs/运行指南.md)》**——环境要求、依赖关系、全部命令均已实测。

## 进度:阶段 0–6 全部完成 ✅

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 0 | 跑通原版 + 骨架 | ✅ |
| 1 | 领域内核(注册表/适配器/加载器) | ✅ |
| 2 | 存储与增量索引(SQLite+WAL+FTS5) | ✅ |
| 3 | 查询服务 + zod 契约层 + CLI REPL | ✅ |
| 4 | Agent 决策循环(ReAct+工具+改写+反思) | ✅ |
| 5 | MCP 化(STDIO server + 零依赖 bundle) | ✅ |
| 6 | 评测闭环 + PROJECT-RECAP | ✅ |

## 目录

```text
src/core/        # 类型 / 注册表 / 适配器 / 加载器 / store(SQLite+FTS5)/ indexer / search
src/shared/      # zod 契约(SEARCH/MESSAGES/STATS)
src/agent/       # LLM 抽象 / 工具注册表 / 改写 / 反思 / ReAct 循环
src/mcp/         # MCP server(JSON-RPC over STDIO)+ db 指针 + 工具注册
src/cli.ts       # REPL 渲染层(search/messages/stats/sync/ask)
fixtures/        # 合成会话数据(只读)
specs/           # 各阶段规格/计划/任务/契约/验收记录
```

## 命令

```bash
npm install          # 开发期依赖(仅 TypeScript / Vitest / esbuild / @types/node)+ 运行时 zod
npm run typecheck    # tsc --noEmit:唯一静态门禁
npm test             # 全部测试 + 各阶段验收演示
npm run build:mcp    # esbuild 打包零依赖 MCP bundle(dist/mini-recall-mcp.cjs)
node dist/mini-recall-mcp.cjs --selfcheck   # bundle 自检(可在无 node_modules 目录运行)
node --experimental-strip-types src/cli.ts  # 进入 REPL(sync --rootDir fixtures 灌库 → search …)
```

## MCP 注册(宿主示例)

```json
{ "mcpServers": { "mini-recall": { "command": "node", "args": ["<绝对路径>/dist/mini-recall-mcp.cjs"] } } }
```

server 通过 `~/.mini-recall/db-path` 指针定位库(REPL 首次运行时写入),只读打开,零运行时依赖。

## 硬性工程约定(宪法摘要,全文见 `.specify/memory/constitution.md`)

- **纯 ESM**,相对导入带 `.js` 后缀;`tsc --noEmit` + `npm test` 全绿才进下一阶段;
- 依赖白名单:zod(运行时)/ TypeScript、Vitest、esbuild、@types/node(开发期);新增依赖必须先修订宪法;
- **数据安全红线**:任何测试绝不读写真实 `~/.claude`、`~/.codex`,只用 `fixtures/` + `mkdtemp` + 内存库;
- 全部文档与代码注释使用中文;关键逻辑写「为什么」。

## 阶段路线

阶段 0 跑通原版 → 阶段 1 领域内核 → 阶段 2 存储与增量索引 → 阶段 3 查询服务+契约层+CLI → 阶段 4 Agent 决策循环 → 阶段 5 MCP 化 → 阶段 6 评测闭环。全部完成;长期回顾见 `docs/PROJECT-RECAP.md`,评测报告见 `eval/report/`。学习计划见 `docs/mini_agent_lab/AgentRecall复现式学习计划.md`。
