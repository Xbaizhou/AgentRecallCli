# 特性规格:阶段 5 MCP 化——对外暴露为标准工具服务器

**Feature Branch**: `005-phase5-mcp-server` | **Created**: 2026-08-29 | **Status**: Draft

**Input**: 学习计划第 5 节(5.1–5.4);阶段 2 的 WAL 只读并发与阶段 4 的工具注册表是本阶段输入。

## Clarifications

### Session 2026-08-29

- Q: server 如何定位数据库? → A: 沿用原版 db 指针机制——主程序(sync/CLI)把真实库路径写入 `~/.mini-recall/db-path`;进程外 server 读指针定位,**不 import 应用代码、不需要应用配置**;环境变量 `MINI_RECALL_DB` 可覆盖(测试与多库场景)。
- Q: server 以什么模式打开库? → A: 只读(`readOnly: true`)。阶段 2 的 WAL 在这里兑现价值:主程序写、server 读、互不阻塞。server 不做迁移——库结构由主程序负责。
- Q: 哪些工具对外暴露? → A: 只读四件套 search_sessions / get_messages / list_sources / now;rewrite_query 依赖 LLM,不属于无依赖 server 的职责(注册表过滤)。
- Q: 传输与帧格式? → A: STDIO + 按行分隔 JSON-RPC 2.0(实现 `\r\n` 容差);stdout 只许协议消息,一切日志走 stderr(计划 5.6 坑点)。

## 用户故事与测试 *(强制)*

### US1 (P1) 工具发现与调用
- 外部 Agent(宿主)按注册信息 spawn server,完成 initialize 握手 → tools/list 发现四工具 → tools/call 检索历史会话并得到文本观察。
- Independent Test:向 handleRpc 发 initialize/tools/list/tools/call 三连,响应符合 JSON-RPC 2.0 与 MCP 语义。

### US2 (P1) 零依赖 bundle
- `node dist/mini-recall-mcp.cjs` 直接运行(无 node_modules、CJS 单文件),由 esbuild 打包(仅构建期依赖)。
- Independent Test:构建产物存在且 `node dist/... --selfcheck` 自检通过(不依赖 node_modules)。

### US3 (P2) db 指针与只读并发
- 主程序写库路径到指针文件;server 读指针 + 只读打开;写连接存在时只读查询不被阻塞。

### 边界情况
- 指针文件不存在 → server 报可诊断错误(stderr)后退出,而非静默空结果。
- 未知方法 → JSON-RPC error -32601;tools/call 未知工具或非法参数 → isError content(不崩进程)。
- 通知消息(无 id)→ 不回包。
- Windows 换行 `\r\n` → 行解析容差。

## 功能需求

- **FR-001**:必须实现 JSON-RPC 2.0 over STDIO 的 MCP server:`initialize` / `tools/list` / `tools/call` / `ping`,行分隔帧,stdout 仅协议消息。
- **FR-002**:必须提供 `handleRpc(db, message)` 纯函数(可测),与 stdio 读写壳分离。
- **FR-003**:工具注册必须复用阶段 4 工具五元组(name/description/parameters),过滤出只读四件套;tools/call 经同一 zod 校验后执行,输出封装为 `{content:[{type:"text",text}]}`。
- **FR-004**:必须提供 db 指针:`writeDbPointer`(主程序)与 `readDbPointer`(server);支持 `MINI_RECALL_DB` 环境变量覆盖。
- **FR-005**:server 必须只读打开库(`readOnly: true`),不执行迁移。
- **FR-006**:必须提供 `scripts/build-mcp.mjs`:esbuild 打包为零依赖单文件 CJS bundle(dist/mini-recall-mcp.cjs),并支持 `--selfcheck` 自检(不依赖 node_modules)。
- **FR-007**:数据安全:server 只读;默认路径仅 ~/.mini-recall/*;测试用内存库/临时目录。

## 成功标准

- **SC-001**:initialize → tools/list → tools/call 三连响应全部符合 JSON-RPC 2.0(含 id 对应与错误码)。
- **SC-002**:tools/call "search_sessions" 能在种子数据上命中并返回含片段的文本 content。
- **SC-003**:bundle 产物在无 node_modules 目录中 `--selfcheck` 通过。
- **SC-004**:写连接持有时只读 server 查询正常(并发不阻塞,WAL 验收)。

## 假设

- 宿主注册(Claude Code/WorkBuddy 的 MCP 配置)属部署说明,写进 README,不在测试范围。
- 通知(notifications/initialized)无需应答;批量请求不支持(MCP stdio 为逐条消息)。
