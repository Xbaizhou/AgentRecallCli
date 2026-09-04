# 实现计划:阶段 3 查询服务与契约层 + CLI

**Branch**: `003-phase3-query-cli` | **Date**: 2026-08-29 | **Spec**: [spec.md](./spec.md)

## Summary

在阶段 2 存储之上提供结构化查询服务(FTS5 关键词 × SQL 条件求交、分页、排序、统计),以 zod 契约工厂守护跨层调用边界,再以 CLI REPL 扮演「渲染层」——与原版 App.tsx→preload→ipcMain 的链路同构,core 不感知 CLI。

## Technical Context

- **Language/Runtime**: TypeScript 5.x,Node ≥ 22.13,纯 ESM(宪法固定)
- **Primary Dependencies**: 运行时新增 **zod**(宪法 IV 白名单内,契约校验);开发期 TypeScript + Vitest
- **Storage**: 复用阶段 2 SQLite(WAL/FTS5),本阶段零 schema 变更
- **Testing**: Vitest;内存库 + 合成数据;dispatchLine 纯逻辑直测
- **Scale/Scope**: src/core/search.ts、src/shared/{contract,commands}.ts、src/cli.ts + 4 测试文件

## Constitution Check

| 原则 | 检查项 | 状态 |
| --- | --- | --- |
| I/III | 文档与注释中文;契约边界处写「为什么」 | ✅ |
| II | 渲染为纯文本行,无表格库;两段式调度 | ✅ |
| IV | 新增依赖仅 zod(白名单已含) | ✅ |
| V | 每检查点双门禁全绿 | ✅ |
| VI | 内存库 + 合成数据 | ✅ |
| VII | core.search 不感知 CLI;契约层守护跨边界 | ✅ |

## Project Structure

```text
src/
├── core/search.ts           # searchSessions / sessionStats(查询语义:过滤/排序/分页)
├── shared/contract.ts       # defineCommand(zod 契约工厂)
├── shared/commands.ts       # SEARCH_CMD / MESSAGES_CMD / STATS_CMD
├── cli.ts                   # parseLine + dispatchLine(可测)+ main REPL(薄壳)
└── **/*.test.ts             # 与源码同目录
specs/003-phase3-query-cli/   # 本文件与设计产物
```

## Complexity Tracking

无违例。
