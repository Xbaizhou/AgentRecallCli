# Tasks:阶段 6 评测闭环与项目总结

**门禁**: 每检查点双门禁全绿;评测全部 MockLlm/确定性路径,零真实 API。

- [x] T001 构建 `eval/dataset.json`(24 问:关键词/改写/时间窗/无命中四类,fixtures 为知识源)
- [x] T002 实现 `eval/metrics.ts`(recallAt5/mrr 纯函数)+ 单测;实现 `eval/harness.ts`(评测库构建 + A/B/C 三模式跑批 + 汇总)
- [x] T003 实现 `eval/eval.test.ts`(npm run eval 入口):跑批 → 写 eval/report/eval-report.{json,md} → 断言(SC-001~SC-004)
- [x] T004 撰写 `docs/PROJECT-RECAP.md`(计划第 8 节七章框架,数据全部实测)
- [x] T005 README 收尾(进度表/评测说明);全量门禁;git 提交

依赖:T001 → T002 → T003 → T004 → T005。
