# mini-recall Speckit 命令提示词手册

> **用途**:为 `$speckit-*` 各命令提供本项目内可直接复制使用的提示词。
> **约束来源**:宪法 `.specify/memory/constitution.md`(v1.0.0)与学习计划 `docs/mini_agent_lab/AgentRecall复现式学习计划.md`。
> **技术基线**:Node ≥ 22.13、纯 ESM、Vitest、zod、esbuild(MCP bundle 用)。

## 推荐使用顺序

| 顺序 | 命令 | 做什么 |
| --- | --- | --- |
| 0 | `$speckit-constitution` | 制定/修订宪法(**已完成 v1.0.0,日常无需重跑**) |
| 1 | `$speckit-specify` | 为当前阶段创建特性规格 |
| 2 | `$speckit-clarify` | 扫描 spec 的歧义点并回填答案 |
| 3 | `$speckit-plan` | 生成实现计划(技术方案) |
| 4 | `$speckit-tasks` | 生成依赖有序的任务清单 |
| 5 | `$speckit-analyze` | 跨 spec/plan/tasks 一致性检查 |
| 6 | `$speckit-checklist` | 生成本阶段定制验收清单 |
| 7 | `$speckit-implement` | 按 tasks 逐任务实现 |
| 8 | `$speckit-converge` | 收尾:对照三产物查漏补缺,补任务 |
| 附 | `$speckit-taskstoissues` | 把 tasks 转成 GitHub Issues(可选) |

每个阶段走一轮 1→8;提示词默认以**阶段 1(领域内核)**为例,后续阶段把阶段名、计划章节号与文件清单替换即可(阶段 2 → 计划第 2 节,依此类推;阶段 0 的骨架搭建同样适用此流程)。

> 前置提醒:本项目尚未 `git init`。执行涉及分支或 GitHub 的命令前,先初始化仓库并按需建远端。

---

## 0. `$speckit-constitution` — 宪法制定与修订

宪法已批准(v1.0.0),只有两种情况需要重跑:**新增/修改原则** 或 **调整依赖白名单**。修订提示词示例:

```text
$speckit-constitution 修订宪法:在原则 IV 依赖白名单的「运行时」分组新增 <依赖名>
(用途:<为什么需要>,白名单内方案为何不可行)。同步更新文件顶部的同步影响报告,
版本号按 MINOR 递增(1.0.0 → 1.1.0);其余原则与章节保持不变;全中文输出。
```

> 修订阶段产出前若只是措辞澄清用 PATCH;删除/重定义原则属 MAJOR,须先评估对已完成阶段的影响。

## 1. `$speckit-specify` — 创建特性规格

```text
$speckit-specify 为 mini-recall 创建特性规格「阶段 1:领域内核——来源注册表、格式适配与会话加载」,
需求来源:docs/mini_agent_lab/AgentRecall复现式学习计划.md 第 1 节(1.1–1.4)。

范围:src/core/types.ts、src/core/session-sources.ts、src/core/format-adapters.ts、
src/core/session-loader.ts 及同目录 *.test.ts。

必须覆盖:
1. 计划 1.2 的三个模块契约:SESSION_SOURCE_REGISTRY(含 capabilities 五个能力开关)、
   format-adapters(纯函数:文本 → {session, messages} | null,不碰文件系统)、
   session-loader(load({rootDir, sources?}) → LoadedSession[],唯一允许访问 fs 的模块);
2. 计划 1.4 验收标准:半行损坏行容错跳过且坏行计数显式输出(不静默吞掉);
   注册表不变量测试(改坏任一 descriptor 字段,测试必须变红);
3. 宪法约束:全中文文档;纯 ESM(NodeNext 相对导入带 .js 后缀);依赖仅限白名单;
   测试只用 fixtures + mkdtemp 临时目录,绝不读写真实 ~/.claude、~/.codex。

排除(后续阶段范围):存储与索引(阶段 2)、查询与契约层(阶段 3)、Agent 决策循环(阶段 4)、
MCP(阶段 5)、评测(阶段 6)。
```

## 2. `$speckit-clarify` — 规格澄清

```text
$speckit-clarify 对当前特性(阶段 1 领域内核)的 spec 做澄清扫描,重点澄清以下项目特有的歧义:
- 内置来源清单:计划只要求 3~4 个来源(如 claude-cli / codex / …),具体定哪几个、
  各自的目录约定(jsonl 存放路径模式)是什么;
- 时间戳归一:秒/毫秒混合时的归一规则,及其边界测试;
- 容错边界:除 BOM 与半行 JSON 外,空文件、整文件损坏、重复 session_key 的处理语义
  (跳过/计数/覆盖哪种);
- LoadOptions.sources 未传时的默认行为(全部启用,还是仅 optionalSetting 为 null 的默认开启项)。
把答案回写进 spec 并保持全中文;回答不得引入白名单外依赖或真实用户数据。
```

## 3. `$speckit-plan` — 生成实现计划

```text
$speckit-plan 为当前特性(阶段 1 领域内核)生成实现计划。技术栈已被宪法固定,直接采用,
不评审替代方案:
- Node ≥ 22.13;纯 ESM;tsconfig strict:true / module:NodeNext / target:ES2023;
  禁止路径别名,相对导入带 .js 后缀;
- 分层遵守宪法原则 VII:adapter 必须是纯函数;fs 访问仅限 session-loader;
  注册表 + 描述符模式,禁止 if (source === "...") 散落判断;
- 测试:Vitest,*.test.ts 与源码同目录;fixtures 仅合成数据;
- 每个模块给出:文件职责(对照计划 1.1 表格)、输入输出签名、调用关系图(对照计划 1.3);
- 全部文档与代码注释为中文,遵守宪法原则 I/III。
```

## 4. `$speckit-tasks` — 生成任务清单

```text
$speckit-tasks 基于当前 plan 生成 tasks.md,要求:
- 按依赖排序:骨架与 tsconfig → types.ts → session-sources.ts(+不变量测试)→
  format-adapters.ts(+容错测试:BOM/半行 JSON/时间戳归一)→ session-loader.ts
  (+目录遍历与组装测试)→ 补齐 fixtures(≥10 个 jsonl,至少 1 个半行损坏)→
  「fixtures → LoadedSession[]」统计演示;
- 每个任务必须包含:涉及文件、完成定义(DoD)、需跑的门禁(npx tsc --noEmit 与 npm test 全绿);
- 标注可并行执行的任务组;任务粒度对齐宪法原则 V:测试不通过不得进入下一任务;
- 全中文输出。
```

## 5. `$speckit-analyze` — 跨产物一致性分析

```text
$speckit-analyze 对当前特性的 spec/plan/tasks 做一致性分析,除常规检查外重点核对:
- 宪法 VI 数据安全:所有测试相关任务是否只用 fixtures/mkdtemp;是否出现任何读写
  真实 ~/.claude、~/.codex 的路径或用例;
- 宪法 IV 依赖:tasks 中是否引入白名单外依赖;
- 宪法 V 门禁:每个任务是否有 tsc --noEmit + Vitest 全绿的完成定义;
- 计划 1.4 的三条验收标准是否都能追溯到具体任务与测试;
- 文档语言是否全部为中文。
发现问题按影响面给出修复建议,不做破坏性修改。
```

## 6. `$speckit-checklist` — 定制验收清单

```text
$speckit-checklist 为当前特性(阶段 1 领域内核)生成定制验收清单,至少覆盖四个维度:
1. 数据安全红线:测试目录隔离(mkdtemp);无任何真实 ~/.claude、~/.codex 访问;
   fixtures 含半行损坏样例;
2. 质量门禁:tsc --noEmit 全绿;npm test 全绿;注册表不变量测试存在且确实能测坏;
3. 验收演示:「fixtures → LoadedSession[]」统计脚本可运行,输出每个来源的会话数、
   消息数、跳过坏行数;
4. 文档合规:spec/plan/tasks 全中文;核心模块具备基础注释(文件顶部职责行 +
   关键逻辑「为什么」注释)。
```

## 7. `$speckit-implement` — 执行实现

```text
$speckit-implement 按 tasks.md 顺序执行当前特性(阶段 1 领域内核)的全部任务:
- 严格执行每个任务的 DoD;每完成一个任务运行 npx tsc --noEmit 与 npm test,
  全绿才进入下一任务;
- 代码遵守宪法 II/III:简化实现、不写投机性抽象;每个源文件顶部一行职责注释,
  关键逻辑(容错解析、注册表不变量)写中文「为什么」注释;
- 禁止引入白名单外依赖;测试只用 fixtures + mkdtemp,绝不触碰真实 ~/.claude、~/.codex;
- 全部任务完成后运行「fixtures → LoadedSession[]」统计演示,把输出(各来源会话数/
  消息数/坏行数)写入执行报告,并对照计划 1.4 三条验收标准逐条打勾。
```

## 8. `$speckit-converge` — 收尾查漏补缺

```text
$speckit-converge 对照当前特性的 spec/plan/tasks 盘点已实现代码,把尚未落盘的工作
追加进 tasks.md:
- 重点核对阶段 1 清单是否齐全:types / session-sources / format-adapters / session-loader
  及对应测试;fixtures ≥10 个(含半行损坏);统计演示脚本;
- 追加任务时保持宪法约束(中文文档、白名单依赖、门禁 DoD);
- 不修改已完成任务的历史记录。
```

## 9. `$speckit-taskstoissues` — 任务转 GitHub Issues(可选)

```text
$speckit-taskstoissues 将当前 tasks.md 转换为 GitHub Issues:
- 前置:仓库已 git init 并配置 GitHub 远端;
- 按依赖顺序生成;标题用中文,正文包含 DoD、门禁要求、所属阶段与对应宪法原则编号;
- 依赖关系在 issue 正文用「依赖:#<编号>」标注。
```

---

## 各阶段特性命名与需求章节对照

| 阶段 | 建议特性名 | 需求来源(学习计划章节) |
| --- | --- | --- |
| 0 | `phase0-bootstrap` | 阶段 0(原版跑通 + 骨架) |
| 1 | `phase1-session-core` | 第 1 节(1.1–1.7) |
| 2 | `phase2-store-indexer` | 第 2 节(2.1–2.7) |
| 3 | `phase3-query-cli` | 第 3 节(3.1–3.7) |
| 4 | `phase4-agent-loop` | 第 4 节(4.1–4.7) |
| 5 | `phase5-mcp-server` | 第 5 节(5.1–5.7) |
| 6 | `phase6-eval-recap` | 第 6 节(6.1–6.4)+ 第 8 节(RECAP 框架) |

替换提示词时的三处固定动作:①把「阶段 N」及其名称换成目标阶段;②把「计划第 X 节」换成上表章节;③把范围文件清单换成计划该节「本阶段文件清单」表格里的文件。
