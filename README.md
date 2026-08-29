# mini-recall

> AgentRecall v1 的复现式学习仓库:领域内核(Node + TypeScript + SQLite,不含 Electron UI)+ 会话检索 Agent(ReAct)+ MCP 对外暴露 + 评测闭环。

## 当前进度:阶段 1 领域内核已完成 ✅

把合成 jsonl 会话文件解析为 `LoadedSession[]` 并输出按来源统计——「磁盘文件 → 领域对象」的第一块可用产出。

```text
src/core/
├── types.ts              # 全部领域类型(唯一出处)
├── session-sources.ts    # 来源注册表:claude-cli / codex 默认开,workbuddy-cli 需显式开启
├── format-adapters.ts    # 三种 jsonl 格式的纯函数适配器 + 时间戳归一
└── session-loader.ts     # 唯一允许访问文件系统的模块:遍历 → 解析 → 组装 → 统计
fixtures/                 # 合成会话数据(只读;含半行损坏 / BOM / 空文件 / 毫秒·秒·ISO 三种时间戳)
specs/001-phase1-session-core/  # 本阶段的规格、计划、任务、契约与验证指南
```

## 命令

```bash
npm install          # 安装开发期依赖(仅 TypeScript / Vitest / @types/node,运行时零依赖)
npm run typecheck    # tsc --noEmit:唯一静态门禁
npm test             # 全部测试 + 【验收演示】统计输出
```

## 硬性工程约定(宪法摘要,全文见 `.specify/memory/constitution.md`)

- **纯 ESM**,相对导入带 `.js` 后缀;`tsc --noEmit` + `npm test` 全绿才进下一阶段;
- 运行时**零第三方依赖**(本阶段);新增依赖必须先修订宪法白名单;
- **数据安全红线**:任何测试绝不读写真实 `~/.claude`、`~/.codex`,只用 `fixtures/` + `mkdtemp` 临时目录;
- 全部文档与代码注释使用中文;每个源文件顶部一行职责注释,关键逻辑写「为什么」。

## 阶段路线(学习计划见 `docs/mini_agent_lab/AgentRecall复现式学习计划.md`)

阶段 0 跑通原版 → **阶段 1 领域内核(当前)** → 阶段 2 存储与增量索引(SQLite+WAL+FTS5)→ 阶段 3 查询服务+契约层+CLI → 阶段 4 Agent 决策循环 → 阶段 5 MCP 化 → 阶段 6 评测闭环。
