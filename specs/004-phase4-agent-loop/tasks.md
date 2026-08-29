# Tasks:阶段 4 代理决策循环

**Prerequisites**: 阶段 3 查询服务与契约;zod。**门禁**: 每检查点双门禁全绿;全部测试 MockLlm 零 token。

- [x] T001 实现 `src/agent/llm.ts`:LlmProvider 接口 + ChatMessage/ToolCall/ChatResult 类型 + createOpenAiProvider(内置 fetch,温度 0)+ MockLlm(脚本化弹出,耗尽报错)
- [x] T002 实现 `src/agent/tools.ts`:Tool 五元组 + AGENT_TOOLS(search_sessions/get_messages/list_sources/now/rewrite_query)+ ToolContext;参数 zod 校验失败即工具失败
- [x] T003 实现 `src/agent/rewrite.ts` + `src/agent/reflect.ts` + `src/agent/prompt.ts`:改写(zod 校验+降级)、反思(verdict+reason+降级)、system prompt(角色/工具规则/溯源强约束)
- [x] T004 实现 `src/agent/loop.ts`:runAgent(ReAct 步进 + maxSteps/重复检测/熔断 + 幻觉键重答一次 + 观察截断)
- [x] T005 测试:tools(校验拒绝/执行)、rewrite(成功/降级)、reflect(两种 verdict/降级)、loop(正常轨迹/maxSteps/重复调用/连续熔断/幻觉重答)
- [x] T006 【验收演示】脚本化 5 问 + --trace 轨迹打印(计划 4.4 验收 1);README 进度更新

依赖:T001 → T002 → T003 → T004 → T005 → T006。
