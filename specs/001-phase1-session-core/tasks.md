# Tasks:阶段 1 领域内核——来源注册表、格式适配与会话加载

**Input**: Design documents from `/specs/001-phase1-session-core/`

**Prerequisites**: plan.md(必需)、spec.md(必需)、research.md、data-model.md、contracts/core-interfaces.md、quickstart.md

**Tests**: 宪法原则 V 与提示词手册明确要求测试;每个用户故事内测试先行(先写测试、确认失败、再实现)。

**Organization**: 按用户故事分组,每个故事可独立实现与验收;门禁(`npx tsc --noEmit` + `npm test` 全绿)为每任务 DoD 的固定项。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行(不同文件、无未完成依赖)
- **[Story]**: 所属用户故事(US1/US2/US3/US4,对应 spec.md)
- 每条任务含精确文件路径

## Path Conventions

单项目结构(见 plan.md):`src/core/` 源码与测试同目录;`fixtures/` 合成数据(只读)。

---

## Phase 1: Setup(共享基础设施)

**Purpose**: 项目骨架与工具链,宪法工程约束落进配置

- [x] T001 创建 `package.json`(`"type": "module"`;scripts:`test` → `vitest run`、`typecheck` → `tsc --noEmit`)与 `tsconfig.json`(`strict: true`、`module: NodeNext`、`target: ES2023`、`noEmit: true`、`types: ["node"]`);禁止路径别名(宪法工程约束)
- [x] T002 配置 `vitest.config.ts`(默认约定,环境 node)并创建恒通过的冒烟测试 `src/core/smoke.test.ts`
- [x] T003 安装开发期依赖 `typescript` / `vitest` / `@types/node`(宪法原则 IV 白名单,运行时零依赖),首次跑通 `npx tsc --noEmit` 与 `npm test` 全绿

**Checkpoint**: 骨架就绪,双门禁首次全绿

---

## Phase 2: Foundational(阻塞性前置)

**Purpose**: 全部用户故事依赖的领域类型与注册表数据

**⚠️ CRITICAL**: 本阶段未完成前不得开始任何用户故事

- [x] T004 实现 `src/core/types.ts`:全部领域类型与唯一出处(Session/SessionMessage/LoadedSession/SessionSource/SessionSourceFamily/SessionFormat/SessionSourceDescriptor/SessionSourceCapabilities/LoadOptions/LoadResult/LoadStats/SourceLoadStats/ParsedFile),字段与校验规则严格对照 `contracts/core-interfaces.md` 第 1 节;文件顶部一行职责注释(宪法 III)
- [x] T005 实现 `src/core/session-sources.ts` 注册表数据:`SESSION_SOURCE_REGISTRY` 内置 3 个描述符(claude-cli / codex 默认开,workbuddy-cli 五能力全 false)+ `getEnabledSources(sources?)`(未传 → 仅 optionalSetting===null;未知 ID 抛错),对照 `contracts/core-interfaces.md` 第 2 节;`validateSessionSourceRegistry` 本任务仅留签名,US4 实现

**Checkpoint**: 领域模型与注册表数据可用,用户故事可并行展开

---

## Phase 3: User Story 1 - 解析合成会话目录并输出统计 (Priority: P1) 🎯 MVP

**Goal**: 磁盘合成 jsonl → LoadedSession[] + 按来源统计,三种格式正常路径全通

**Independent Test**: 对只含正常样例的目录执行 `loadSessions()`,返回结构正确的会话数组与统计输出

### Tests for User Story 1

- [x] T006 [P] [US1] 创建正常合成样例 `fixtures/claude/normal-1.jsonl`、`fixtures/claude/normal-2.jsonl`(ISO 时间戳,含数组型 content)、`fixtures/codex/rollout-20260801T100000.jsonl`、`fixtures/codex/rollout-20260802T090000.jsonl`(毫秒时间戳)、`fixtures/workbuddy/session-a.jsonl`(秒时间戳)、`fixtures/workbuddy/session-b.jsonl`(含空行),行结构对照 `research.md` R5;fixtures 只读,绝不放真实数据(宪法 VI)
- [x] T007 [P] [US1] 编写 `src/core/format-adapters.test.ts` 正常路径用例:三格式各断言 session 元数据(rawId/projectPath/firstQuestion/originalTitle/timestamp)与消息列表(index/role/content/timestamp);先写测试确认失败
- [x] T008 [US1] 实现 `src/core/format-adapters.ts`:`FORMAT_ADAPTERS` 三适配器正常路径 + `normalizeTimestampMs`(归一规则见 research R1;<10^12 秒×1000,ISO 用 Date.parse,非法→0),纯函数不碰 fs(宪法 VII);注释写「为什么」(宪法 III)
- [x] T009 [US1] 编写 `src/core/session-loader.test.ts` 正常用例(mkdtemp 临时目录复制 fixtures):返回 sessions+stats、排序确定性(两次结果一致)、无文件来源计 0;先确认失败
- [x] T010 [US1] 实现 `src/core/session-loader.ts`:`loadSessions(options)`——getEnabledSources → 递归 readdir(withFileTypes) → filePattern 过滤 → readFile → 适配器调度 → 组装 LoadedSession(sessionKey=`${source}:${rawId}`、messageCount)→ 统计(注册表顺序、全部启用来源含计 0);唯一 fs 模块(宪法 VII),目录不存在计 0 不抛错
- [x] T011 [US1] 在 `src/core/session-loader.test.ts` 增加【验收演示】用例:加载仓库 `fixtures/` 全目录,console 打印「来源/会话数/消息数/坏行数」统计表,并断言 claude-cli 与 codex 会话数 > 0(计划 1.4 可运行演示)

**Checkpoint**: MVP 可独立验收——`npm test` 全绿,演示输出三列统计与 fixtures 实际内容一致

---

## Phase 4: User Story 2 - 损坏数据容错与显式计数 (Priority: P1)

**Goal**: 半行 JSON/BOM/空文件/整文件损坏全部容错,坏行显式计数不静默

**Independent Test**: 目录含 1 个半行损坏文件,加载后正常行全解析、坏行计数=实际坏行数、无未捕获异常

### Tests for User Story 2

- [x] T012 [P] [US2] 补齐损坏样例使 fixtures 总数 ≥10:`fixtures/claude/broken-halfline.jsonl`(最后一行半行 JSON)、`fixtures/claude/with-bom.jsonl`(UTF-8 BOM)、`fixtures/claude/empty.jsonl`(0 字节)、`fixtures/claude/unknown-lines.jsonl`(合法 JSON 非 message 行)、`fixtures/codex/rollout-broken.jsonl`(半行损坏)
- [x] T013 [P] [US2] `src/core/format-adapters.test.ts` 容错用例:半行→坏行计数≥1 且前面行全解析;BOM→正常解析;空文本→0 消息不返回 null;全坏→坏行数=总行数;空行→不计坏行;非消息行→忽略不计(先确认失败)
- [x] T014 [US2] 实现 `src/core/format-adapters.ts` 容错分支:`stripBom`、逐行 try/catch(坏行计数继续)、空行跳过不计、未知 type 行忽略、空文件产出 0 消会话(澄清 FR-012 语义);注释说明「坏行只与能否解析相关」的语义边界
- [x] T015 [US2] `src/core/session-loader.test.ts` 容错贯通用例(mkdtemp 构造):单文件损坏不拖垮整体(SC-002)、适配器返回 null → skippedBadLines+1(research R7)、重复会话标识各自产出(FR-012);确认 loader 侧语义无缺口

**Checkpoint**: SC-001/SC-002 满足——含损坏样例的 fixtures 全量加载成功且计数精确

---

## Phase 5: User Story 3 - 按来源过滤加载 (Priority: P2)

**Goal**: 显式来源子集过滤 + 默认启用范围(仅 optionalSetting=null)

**Independent Test**: 指定单一来源加载,结果 0 条来自其他来源;默认加载不出现 workbuddy-cli

### Tests for User Story 3

- [x] T016 [P] [US3] `src/core/session-loader.test.ts` 过滤用例:显式 `sources:["claude-cli"]` → 其他来源解析率 0(SC-005);不传 sources → 默认仅 claude-cli+codex(workbuddy 不出现,US3 场景 2);传入未知来源 ID → 抛错(契约第 4 节);先确认失败
- [x] T017 [US3] 实现 `src/core/session-loader.ts` 过滤逻辑:启用来源解析顺序化、逐来源独立统计;`getEnabledSources` 校验未知 ID 抛错(本任务在 T005 签名上补齐行为,不新增分支式判断)

**Checkpoint**: SC-005 满足,默认启用范围与澄清结论一致

---

## Phase 6: User Story 4 - 来源注册表自检不变量 (Priority: P2)

**Goal**: 注册表字段完整性可自检,改坏任一字段测试变红

**Independent Test**: 注入字段缺失/非法/重复 ID,`validateSessionSourceRegistry()` 全部报错并指明位置

### Tests for User Story 4

- [x] T018 [P] [US4] 编写 `src/core/session-sources.test.ts`:合法注册表校验通过且 ID 无重复;以「构造坏描述符 → 单独校验」方式覆盖:缺 id/label/format/relativeDir、filePattern 非正则、capabilities 缺键或非布尔、ID 重复、relativeDir 含 `..`(先确认失败)
- [x] T019 [US4] 实现 `src/core/session-sources.ts` 的 `validateSessionSourceRegistry()`:逐条不变量检查(对照 data-model 校验列),违规抛 Error 并列出「来源+字段+问题」;不改注册表数据本身

**Checkpoint**: SC-004 满足——注册表抽象自检查生效

---

## Phase 7: Polish & Cross-Cutting(横切收尾)

**Purpose**: 文档合规与最终验收

- [x] T020 [P] 补齐仓库根 `README.md`(项目一句话、目录结构、npm 命令、宪法红线提示),全中文(宪法 I)
- [x] T021 [P] 注释复查:4 个源文件均有顶部职责行,容错/归一/注册表不变量处有「为什么」中文注释(宪法 III)
- [x] T022 运行 `quickstart.md` 完整验证:`npx tsc --noEmit` + `npm test` 全绿,演示统计与 fixtures 实际内容逐条核对;对照 spec SC-001~SC-006 打勾,并在执行报告记录「与原版差距」(loader 简化点,依据 research R6)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup(Phase 1)** → **Foundational(Phase 2)**:骨架先行,类型是万物之源
- **Foundational(Phase 2)** → **US1(Phase 3)**:types+registry 阻塞所有故事
- **US1 → US2**:容错在正常路径之上增强(同文件演进,禁止并行改 format-adapters)
- **US1 → US3 / US4**:US3(过滤)、US4(自检)与 US2 无文件冲突,可在 US1 完成后并行
- **Polish(Phase 7)**:全部故事完成后

### User Story Dependencies

- **US1(P1)**:仅依赖 Foundational——MVP
- **US2(P1)**:依赖 US1 的 adapters/loader 文件形态(同文件演进)
- **US3(P2)**:依赖 Foundational + US1 的 loader 骨架
- **US4(P2)**:仅依赖 Foundational(T005 的签名);与其他故事无文件冲突

### Parallel Opportunities

- T006 / T007(T007 仅依赖 T004)/ T012 / T013 / T016 / T018 / T020 / T021 标记 [P]
- US3 与 US4 整组可并行(不同文件:loader 过滤 vs session-sources 自检)
- fixtures 类任务(T006/T012)可与任何代码任务并行(纯数据文件)

---

## Implementation Strategy

- **MVP First**:完成 Phase 1→2→3 后即可独立演示「fixtures → 统计」(T011),向学习计划阶段 1 验收标准对齐
- **增量交付**:US2 补容错 → US3 补过滤 → US4 补自检,每步门禁全绿再前进,不留「回头再修」(宪法 V)
- **测试先行**:每个故事先写测试确认失败(T007/T009/T013/T016/T018),再实现(T008/T010/T014/T017/T019)

## Notes

- 测试与源码同目录(`src/core/*.test.ts`);文件系统测试一律 mkdtemp(宪法 VI)
- fixtures 只读;任何任务不得引入白名单外依赖(宪法 IV)
- 提交节奏:每任务或逻辑组一提交,提交信息全中文

---

## Phase 8: Convergence($speckit-converge 于 2026-08-29 追加)

- [x] T023 在 `src/core/session-loader.test.ts` 增加性能基线用例:mkdtemp 生成 100 个合成会话文件,断言 `loadSessions` 全量解析 < 1000ms 且会话数 = 100(per plan 性能目标「100 文件 < 1 秒」防退化,gap-type: missing)
