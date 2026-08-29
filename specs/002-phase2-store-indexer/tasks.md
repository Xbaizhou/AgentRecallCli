# Tasks:阶段 2 存储与增量索引

**Prerequisites**: plan.md、spec.md、research.md、data-model.md、contracts/store-interfaces.md、quickstart.md
**Tests**: 宪法 V 明确要求;每任务 DoD 含双门禁(npx tsc --noEmit + npm test 全绿)。

## Phase 1: Setup(类型与锚点前置)

- [ ] T001 扩展 `src/core/types.ts`(Session +fileSize/fileMtimeMs;新增 IndexStatus/SearchHit/SyncOptions)并在 `src/core/session-loader.ts` 增加 stat(仍为唯一 fs 模块);更新受影响阶段 1 测试
- [ ] T002 [P] 实现 `src/core/store/database.ts`(openDatabase:建目录+WAL+外键;createInMemoryStore)+ `src/core/store/database.test.ts`(WAL 模式、只读连接、外键)

## Phase 2: Foundational(存储原语)

- [ ] T003 实现 `src/core/store/schema.ts`(migrateMiniRecallStore:三表+FTS5 trigram+触发器+data_migrations;addColumnIfMissing)+ 测试(幂等连跑两次等价)
- [ ] T004 实现 `src/core/store/sessions.ts`(upsertIndexedSession 先删后插+快照;getSession/listSessions/getIndexedMeta/listStoredPathsBySource/removeSession;键冲突先到先得)+ 测试(幂等 upsert、冲突、快照读写)
- [ ] T005 实现 `src/core/store/messages.ts`(getMessages 支持 tail)+ 测试

## Phase 3: US3 全文检索(P1)

- [ ] T006 实现 `src/core/store/fts.ts`(searchContent:≥3 字符走 trigram MATCH,短词 LIKE 兜底;引号与 LIKE 转义;bm25 排序)+ 测试(中文两字/四字、英文、空串、无残留)

## Phase 4: US2 增量同步(P1)

- [ ] T007 实现 `src/core/indexer.ts`(syncSessions:快照判定/forceReindex/键冲突/删除清理/错误隔离)+ `src/core/indexer.test.ts`(二次全跳、改 1 重索引 1、删除清理 removed=1、forceReindex、坏文件不中断)
- [ ] T008 在 indexer.test.ts 增加性能数据采集用例(全量 vs 增量耗时;万条消息 FTS5 vs LIKE 耗时),打印实测值供 PROJECT-RECAP 引用

## Phase 5: Polish(验收与文档)

- [ ] T009 【验收演示】用例:mkdtemp 4 文件全链路(首次入库→二次全跳→改 1→删 1→中英文检索)+ `quickstart.md` 核对;更新 README 进度与执行记录

## Dependencies

T001 → T002(类型先行)→ T003 → T004 → T005/T006(可并行)→ T007 → T008 → T009。
