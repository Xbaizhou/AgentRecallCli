# 实现计划:阶段 2 存储与增量索引

**Branch**: `002-phase2-store-indexer` | **Date**: 2026-08-29 | **Spec**: [spec.md](./spec.md)

## Summary

把阶段 1 的 LoadedSession[] 落入嵌入式同步库:sessions/messages 双表 + external-content FTS5 全文索引(触发器自动同步);同步流程以「文件大小 + 修改时间」为增量判定锚点,支持跳过/重建/删除清理与强制重建谓词;持久形态启用 WAL 为阶段 5 只读并发铺路。

## Technical Context

**Language/Version**: TypeScript 5.x,Node.js ≥ 22.13(本机 v24.15.0;node:sqlite/FTS5/trigram/只读连接均已运行时验证)

**Primary Dependencies**: 运行时零第三方依赖(node:sqlite/node:fs/promises);开发期 TypeScript + Vitest + @types/node

**Storage**: SQLite(WAL + 外键)+ FTS5(trigram 分词)

**Testing**: Vitest;内存库为主,mkdtemp 文件库验证 WAL/只读;fixtures 只读复用

**Target Platform**: Windows/macOS/Linux 本地 Node 进程(纯 ESM)

**Project Type**: library(领域内核延伸)

**Performance Goals**: 万条消息 FTS5 检索显著快于逐行 LIKE(实测数据采集);增量同步显著快于全量(实测数据采集)

**Constraints**: fs 访问仅限 session-loader(indexer 只对比快照);单文件错误不中断;全中文文档与注释

**Scale/Scope**: store/ 5 文件 + indexer + 5 测试文件;复用阶段 1 fixtures

## Constitution Check

| 宪法原则 | 检查项 | 状态 |
| --- | --- | --- |
| I 全中文文档 | 本特性全部产物中文 | ✅ |
| II 代码简洁 | 复用阶段 1 类型;无投机抽象;迁移自描述不引入框架 | ✅ |
| III 基础注释 | WAL/触发器/增量锚点/分词坑写「为什么」注释 | ✅ |
| IV 最少依赖 | 运行时 0 新依赖(node:sqlite 内置) | ✅ |
| V 质量门禁 | 每检查点 tsc + vitest 全绿 | ✅ |
| VI 数据安全红线 | 默认库仅 ~/.mini-recall/*;测试内存库/mkdtemp | ✅ |
| VII 分层架构 | loader 唯一 fs 模块(stat 后交锚点);indexer 不碰 fs | ✅ |

## Project Structure

```text
src/core/
├── types.ts                 # 追加 fileSize/fileMtimeMs/IndexStatus/SearchHit/SyncOptions
├── session-loader.ts        # 追加 stat:fileSize/fileMtimeMs(仍为唯一 fs 模块)
├── indexer.ts               # syncSessions():增量判定 + 删除清理 + 强制重建谓词
├── indexer.test.ts          # 增量正确性 + 性能数据采集
└── store/
    ├── database.ts          # openDatabase(WAL+外键) / createInMemoryStore()
    ├── schema.ts            # migrateMiniRecallStore:幂等迁移(表+FTS5+触发器+登记)
    ├── sessions.ts          # upsertIndexedSession/getSession/listSessions/getIndexedMeta/removeSessions
    ├── messages.ts          # getMessages(支持 tail)
    ├── fts.ts               # searchContent:trigram MATCH + 短词 LIKE 兜底
    └── *.test.ts            # 与源码同目录
```

## Complexity Tracking

无违例。
