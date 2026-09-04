# Tasks:阶段 5 MCP 化

**Prerequisites**: 阶段 2 只读并发(WAL)、阶段 4 工具注册表;esbuild 加入 devDeps(白名单,构建期)。
**门禁**: 每检查点双门禁全绿。

- [x] T001 实现 `src/mcp/db-pointer.ts`(pointerPath/writeDbPointer/readDbPointer,支持目录参数与 MINI_RECALL_DB)+ 测试(roundtrip、覆盖)
- [x] T002 实现 `src/mcp/registration.ts`(阶段 4 工具 → MCP 描述;只读四件套过滤;callTool 统一 zod 校验与 content 封装)+ 测试
- [x] T003 实现 `src/mcp/server.ts`(handleRpc 纯函数:initialize/tools/list/tools/call/ping/未知方法/通知;main:行分隔帧 + stdout 纯协议 + stderr 日志 + 只读开库 + 指针定位)+ 测试(三连响应、错误码、isError content、\r\n 容差)
- [x] T004 `scripts/build-mcp.mjs`(esbuild 零依赖 CJS bundle + --selfcheck)+ package.json build:mcp 脚本;构建产物实测(无 node_modules 目录运行 selfcheck)
- [x] T005 cli main 接入:sync 后写 db 指针;README 增加 MCP 注册说明;全量门禁

依赖:T001 → T002 → T003 → T004 → T005。
