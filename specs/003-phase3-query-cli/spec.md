# 特性规格:阶段 3 查询服务与契约层 + CLI「渲染层」

**Feature Branch**: `003-phase3-query-cli` | **Created**: 2026-08-29 | **Status**: Draft

**Input**: 学习计划第 3 节(3.1–3.4);阶段 2 的 SessionStore 与 searchContent 是本阶段输入。

## Clarifications

### Session 2026-08-29

- Q: 跨边界参数校验失败时的行为? → A: 立即拒绝并给出**字段级**错误信息(路径 + 错误码),不静默修正、不降级执行——契约是安全边界,坏参数必须在此被拦下(对应计划 3.4 验收 2)。
- Q: 未知字段如何处理? → A: 严格模式拒绝(而非剥除),避免调用方拼错字段名被静默吞掉。
- Q: 相关度排序在无关键词时? → A: 退化为时间倒序(相关度只对关键词检索有意义),接口不报错。
- Q: CLI 与 core 的边界? → A: core.search 不感知 CLI;CLI 只做「词法切分 → 契约校验 → 调 core → 渲染」;调度函数(dispatchLine)与终端 REPL(readline)分离,前者可测、后者薄壳(宪法 VII:core 不感知渲染层)。

## 用户故事与测试 *(强制)*

### US1 (P1) 多条件查询:学习者以关键词 + 结构化条件过滤会话
- Given 库中 3 个会话其中 1 个含「全文检索」且来源为 codex, When `search --query 全文检索 --source codex`, Then 只命中该会话、total=1、返回 tookMs;When 同样关键词但 `--source claude-cli`, Then 命中 0(FTS 与 SQL 两路求交)。
- 分页:limit=1, offset=1 时 items=1 且 total=全量(计数与页分离)。
- 排序:`--sort relevance` 按 bm25,默认时间倒序;无关键词时 relevance 退化为时间倒序。

### US2 (P2) 消息与统计:查看会话消息与库内分布
- `messages <sessionKey> --tail 2` 返回该会话最后 2 条(顺序保持原始 index 序)。
- `stats` 返回按来源、按日(YYYY-MM-DD)的会话数分布。

### US3 (P1) 契约校验边界:非法参数被字段级拒绝
- `search --limit -1` → 拒绝,错误信息含字段名 limit;`search --nonsense 1` → 拒绝(未知字段);`messages`(缺 sessionKey)→ 拒绝。
- 合法参数的默认值生效(limit=50, offset=0, sort=time)。

### US4 (P2) REPL 演示闭环
- 一条命令串完成「搜索 → 看消息 → 统计」,渲染为可读表格行并显示 tookMs(计划 3.4 验收 1)。

### 边界情况
- 空关键词 `search`(无 --query)→ 列出全部(结构化过滤仍生效);空白关键词 → 等价无关键词。
- 关键词命中数远大于 limit → total 仍为全量命中数;offset 超界 → items 空、total 正确。
- after/before 同时给出 → 闭区间过滤;只给其一 → 单边。
- 中文关键词、含引号关键词 → 沿用阶段 2 转义语义。

## 功能需求

- **FR-001**:`searchSessions(db, filters)` 必须支持 query(FTS5)、source(精确)、project(前缀)、after/before(毫秒闭区间)、limit/offset、sort(time|relevance);关键词与结构化过滤取交集。
- **FR-002**:响应必须含 items(SessionSummary,命中时可含 snippet)、total(过滤后全量计数)、tookMs;total 不受 limit 影响。
- **FR-003**:必须提供 zod 契约工厂 `defineCommand(name, schema)`,契约同时给出运行时校验与类型推导;同一份 schema 服务 CLI 校验与(阶段 4)模型工具描述。
- **FR-004**:内置三个命令契约:search / messages / stats;未知字段与非法值必须被字段级拒绝。
- **FR-005**:必须提供 `sessionStats(db)`:按来源、按日的会话数分布。
- **FR-006**:CLI 必须实现「词法切分 → 契约 parse → 调 core → 渲染」;调度函数与 REPL 分离(前者纯逻辑可测)。
- **FR-007**:REPL 的 stdout 只承载结果渲染;非法输入打印错误并继续,`quit/exit` 退出。
- **FR-008**:数据安全:本阶段一切测试用内存库 + 合成数据;默认日期参数按毫秒时间戳解释(ISO 字符串在 CLI 层转换)。

## 成功标准

- **SC-001**:FTS 与 SQL 两路求交正确(改来源过滤,命中数按预期 0/1 变化)。
- **SC-002**:分页 total 与 items 解耦正确;offset 超界不报错。
- **SC-003**:非法参数(limit=-1、未知字段、缺必填)100% 被字段级拒绝,默认值 100% 生效。
- **SC-004**:REPL 演示闭环「搜索→消息→统计」可运行(演示测试输出存档)。
- **SC-005**:典型查询 tookMs 基线数据被采集(阶段 6 对照组之一)。

## 假设

- 阶段 2 的 searchContent/getMessages/listSessions 为查询原语;本阶段不做增量、不做持久化变更。
- 表格渲染为纯文本行(无第三方表格库,宪法 IV);彩色/交互增强不做。
- 排除:Agent 决策循环(阶段 4)、MCP(阶段 5)、评测(阶段 6)。
