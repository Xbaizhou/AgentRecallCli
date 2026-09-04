# 验收维度清单(Requirements Quality):阶段 1 领域内核

**Purpose**: 检验规格/计划/任务在「数据安全、质量门禁、验收演示、文档合规」四个维度的需求书写质量——测的是需求本身是否完整、清晰、可度量,不是实现是否工作
**Created**: 2026-08-29
**Feature**: [spec.md](../spec.md)

**Note**: 本清单由 `/speckit-checklist` 基于特性上下文与用户指定的四个验收维度生成。
**Review Ownership**: 评审者所有。仅当评审者确认某条需求质量标准成立时才标 `[x]`;`[x]` 代表需求质量达标,不代表实现完成。
**Marker Semantics**: `/speckit-implement` 读取清单状态但不得修改勾选。

## 维度一:数据安全红线(Requirements Completeness/Clarity)

- [ ] CHK001 - 规格是否把「测试数据隔离」写成明确需求(mkdtemp 临时目录 + fixtures 只读),使任何实现者无需口头约定即可遵守? [Completeness, Spec §FR-011]
- [ ] CHK002 - 规格是否显式禁止读写真实 `~/.claude`、`~/.codex`,并给出了唯一替代路径(手写合成 fixtures)? [Completeness, Spec §FR-011 + 边界情况;宪法 VI]
- [ ] CHK003 - fixtures 损坏样例的构成(半行 JSON/BOM/空文件/全坏文件)是否在规格边界情况与任务清单中双向列全、口径一致,而非留白? [Consistency, Spec §边界情况 ↔ tasks T006/T012]
- [ ] CHK004 - 「真实数据即使脱敏也不得入库测试」的红线是否写进了需求,而不只是工程习惯? [Completeness, Spec §FR-011;宪法 VI]

## 维度二:质量门禁(Requirements Measurability/Consistency)

- [ ] CHK005 - 静态门禁与测试门禁(tsc --noEmit / npm test 全绿)是否被声明为每任务固定 DoD,使「跳过门禁」无从解释? [Clarity, tasks 组织约定;宪法 V]
- [ ] CHK006 - 注册表不变量要求是否给出可测口径:注入方式(构造坏描述符)、必须报错并指明「来源+字段+问题」? [Measurability, Spec §FR-010/SC-004 ↔ tasks T018/T019]
- [ ] CHK007 - 「测试先行(先失败后实现)」是否落实为任务顺序与依赖说明,而非仅原则声明? [Consistency, tasks 依赖与执行顺序节]

## 维度三:验收演示(Requirements Consistency/Measurability)

- [ ] CHK008 - 统计演示的三列输出(会话数/消息数/跳过坏行数)在规格 FR-006、成功标准 SC-003 与 quickstart 核对点之间是否口径一致、可断言? [Consistency, Spec §FR-006/SC-003 ↔ quickstart §2]
- [ ] CHK009 - 演示的复现方式是否写到「不读实现代码也能跑」的程度(命令、预期输出形态、核对点清单)? [Clarity, quickstart §1–2]
- [ ] CHK010 - SC-001~SC-006 是否全部客观可度量,且每条都映射到演示核对点或具体测试任务? [Measurability, Spec §成功标准 ↔ tasks T009/T011/T013/T015/T017/T019]

## 维度四:文档合规(Requirements Completeness/Clarity)

- [ ] CHK011 - 全中文要求是否覆盖 spec/plan/tasks 与实现期产物(README/注释),并界定了「代码标识符用英文」的例外边界? [Clarity, 宪法原则 I ↔ tasks T020/T021]
- [ ] CHK012 - 基础注释要求是否给出具体位置清单(文件顶部职责行;容错/归一/不变量处的「为什么」),而非泛泛「要有注释」? [Clarity, plan 宪法检查 III ↔ tasks T021]
- [ ] CHK013 - 「与工业级原版的差距诚实记录」是否指定了承载文档与记录时机(执行报告 vs PROJECT-RECAP)? [Completeness, tasks T022 ↔ 计划文档第 7/8 节]

## Notes

- 焦点:用户指定的四个验收维度(数据安全/门禁/演示/文档);深度:Standard;评审者:作者本人(学习项目自验收)。
- 13 项中 13 项含可追溯引用(≥80% 达标)。
- 本清单为需求质量清单;实现完成度由 tasks.md 勾选与 quickstart.md 核对点负责,两者勿混。
