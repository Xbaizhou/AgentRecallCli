# 特性规格:阶段 4 代理决策循环——ReAct + 工具调用 + 查询改写 + 结果反思

**Feature Branch**: `004-phase4-agent-loop` | **Created**: 2026-08-29 | **Status**: Draft

**Input**: 学习计划第 4 节(4.1–4.4);阶段 3 的查询服务与契约层是本阶段输入。

## Clarifications

### Session 2026-08-29

- Q: 模型输出的工具参数可信吗? → A: 不可信。所有工具参数必须经同一份 zod 契约校验后执行——校验层是安全边界(计划 4.7);校验失败计为一次工具失败,错误信息回喂模型。
- Q: 查询改写放在前置还是工具? → A: 工具式(rewrite_query 作为工具,由决策循环按需调用、可在反思后再次调用)——「迭代优化」的实现载体(计划 4.2④)。
- Q: 反思失败的默认行为? → A: 反思输出解析失败时按「足以回答」处理(reason 记录降级原因),避免死循环;maxSteps 是最终兜底。
- Q: 最终答案的引用如何防幻觉? → A: 答案中出现的会话键必须来自工具观察结果;校验失败时把「引用了不存在的会话键」回喂模型并允许重答一次,二次违规仍以第二次答案为准并记录违规标记。

## 用户故事与测试 *(强制)*

### US1 (P1) 决策循环:自然语言问题 → 工具调度 → 带溯源的答案
- Given 脚本化模型依次调用 now → rewrite_query → search_sessions → get_messages 后给最终答案, When runAgent, Then answer 含答案文本、steps 记录每次工具调用轨迹、usage 统计工具调用数与 token 数。
- Given 模型直接输出无工具调用的内容, Then 视为最终答案立即终止。

### US2 (P1) 停止条件三件套(缺一不可)
- maxSteps(默认 8)超限:强制收尾,answer 说明「已达步数上限」并附已知信息。
- 重复调用:同一工具 + 同参数 hash 已出现过 → 拒绝执行,观察结果回喂「你已查询过」。
- 连续失败熔断:工具连续失败 ≥ 3 次 → 熔断退出,不再把预算耗在重试上。

### US3 (P1) 查询改写与结果反思
- rewrite_query:自然语言 → SearchFilters(zod 校验);解析失败降级为 {query: 原句},不崩溃。
- reflect:评估结果与问题匹配度输出 sufficient/insufficient + 理由;insufficient 时模型据此再调 rewrite_query + search_sessions(迭代优化)。

### US4 (P2) MockLlm 全流程 0 token 测试
- 全部循环测试用脚本化 MockLlm 驱动(确定性、零成本、可进 CI);真实 API 仅经 eval 手动触发。

### 边界情况
- 模型返回不合法 JSON 工具参数 → 该次计为工具失败,错误回喂。
- 模型调用不存在的工具 → 同上(观察结果提示可用工具)。
- 幻觉会话键(答案引用观察中不存在的键)→ 重答一次(澄清 4)。
- 观察结果过长 → 截断到有限长度,防止上下文膨胀(成本控制)。

## 功能需求

- **FR-001**:必须定义 LlmProvider(chat(messages, tools) → content/toolCalls/usage);提供 OpenAI 兼容实现(基于内置 fetch,零依赖)与 MockLlm(脚本化,测试用)。
- **FR-002**:工具必须为「名称 + 给模型看的描述 + JSON Schema 参数 + zod 校验 + execute」五元组;内置工具:search_sessions / get_messages / list_sources / now / rewrite_query。
- **FR-003**:决策循环必须实现 ReAct 步进:每步 = 组装 messages → chat → 有 toolCalls 则逐个「zod 校验 → 执行 → 观察结果入历史」→ 无 toolCalls 的内容视为最终答案。
- **FR-004**:停止条件必须齐备:maxSteps(默认 8)、重复调用检测(工具名+参数 hash)、连续失败熔断(≥3)。
- **FR-005**:查询改写必须经 zod 校验,失败降级 {query: 原句} 并记录降级。
- **FR-006**:结果反思必须输出 verdict + reason,insufficient 时附具体改进方向;解析失败按澄清 3 降级。
- **FR-007**:最终答案的会话键引用必须可溯源至观察结果,违规触发一次重答(澄清 4)。
- **FR-008**:system prompt 必须包含角色、工具使用规则、引用溯源强约束。
- **FR-009**:数据安全与成本:观察结果截断;全部测试用 MockLlm 零 token;真实 API 不进 CI。

## 成功标准

- **SC-001**:脚本化 5 问演示,Agent 正确完成 ≥4(与计划 4.4 验收 1 对齐)。
- **SC-002**:三类停止条件 100% 有测试且行为正确。
- **SC-003**:改写降级与反思降级路径 100% 有测试。
- **SC-004**:全流程测试 0 token(MockLlm),CI 无真实 API 依赖。
- **SC-005**:每步工具轨迹可打印(--trace 语义),steps 含 name/参数摘要/结果摘要。

## 假设

- 工具集是阶段 3 能力的面向模型封装(search_sessions 复用 SearchFilters 语义);不新增检索能力。
- OpenAI 兼容 = POST {baseUrl}/chat/completions,tools 字段按 function calling 协议;兼容多数网关即可。
- 评测对比(A/B/C 模式、recall@5)属阶段 6;本阶段交付可被评测调用的 runAgent。
