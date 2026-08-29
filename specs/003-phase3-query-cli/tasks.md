# Tasks:阶段 3 查询服务与契约层 + CLI

**Prerequisites**: 阶段 2 存储与 FTS5;zod(白名单运行时依赖)
**门禁**: 每检查点 `npx tsc --noEmit` + `npm test` 全绿。

- [x] T001 实现 `src/shared/contract.ts`(defineCommand)+ `src/shared/commands.ts`(三命令,strictObject + 默认值)+ `src/shared/contract.test.ts`(默认值生效、limit=-1 拒绝、未知字段拒绝、缺必填拒绝)
- [x] T002 实现 `src/core/search.ts`(searchSessions 两路求交/分页/排序/tookMs + sessionStats)+ `src/core/search.test.ts`(求交、分页 total、排序退化、空关键词、offset 超界、按日统计)
- [x] T003 实现 `src/cli.ts`(parseLine/dispatchLine 可测 + main REPL 薄壳)+ `src/cli.test.ts`(search/messages/stats 渲染、非法参数字段级错误、quit 返回 null、help)
- [x] T004 【验收演示】用例:脚本化 REPL 闭环「搜索→消息→统计」+ 典型查询 tookMs 基线打印;更新 README 进度

依赖:T001 → T002(契约先行)→ T003 → T004。
