# 实现计划:阶段 1 领域内核——来源注册表、格式适配与会话加载

**Branch**: `001-phase1-session-core` | **Date**: 2026-08-29 | **Spec**: [spec.md](./spec.md)

**Input**: `/specs/001-phase1-session-core/spec.md`

## Summary

复现 AgentRecall v1 的领域内核解析层(不含 Electron、不含存储):以「来源注册表 + 描述符」声明会话来源,以纯函数格式适配器把合成 jsonl 文本解析为领域对象,以唯一的 fs 访问模块(会话加载器)把目录加载为 `LoadedSession[]`,并输出按来源统计(会话数/消息数/坏行数)。容错语义(半行 JSON、BOM、空文件、整文件损坏)与时间戳归一启发式由澄清结论固定。

## Technical Context

**Language/Version**: TypeScript 5.x,运行时 Node.js ≥ 22.13(宪法固定;本机 v24.15.0)

**Primary Dependencies**: 运行时零第三方依赖(本阶段);开发期 TypeScript + Vitest + @types/node(宪法原则 IV 白名单)

**Storage**: 无(本阶段纯内存;SQLite/WAL/FTS5 属阶段 2)

**Testing**: Vitest,`*.test.ts` 与源码同目录;测试文件系统一律 `mkdtemp` 临时目录,fixtures 只读引用

**Target Platform**: Windows/macOS/Linux 本地 Node 进程(纯 ESM)

**Project Type**: library(领域内核;CLI「渲染层」属阶段 3)

**Performance Goals**: 全量解析 100 个合成会话文件 < 1 秒(学习项目量级,仅需防退化)

**Constraints**: 禁止路径别名,相对导入带 `.js` 后缀;fs 访问仅限 session-loader;测试绝不读写真实 `~/.claude`、`~/.codex`;单文件保持单层职责

**Scale/Scope**: 4 个源文件 + 3 个测试文件 + fixtures ≥ 10 个 jsonl;源码目标 ≈ 300~400 行(简化版,抽象接口对齐原版)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 宪法原则 | 检查项 | 状态 |
| --- | --- | --- |
| I 全中文文档 | spec/plan/research/data-model/contracts/quickstart/tasks 全部中文 | ✅ 通过 |
| II 代码简洁 (YAGNI) | 每模块单一职责;loader 取简化版(≈150 行);无投机抽象;接口与原版对齐保留扩展点 | ✅ 通过 |
| III 基础注释 | 每个源文件顶部一行职责注释;增量判定/容错/归一等关键逻辑写「为什么」中文注释 | ✅ 通过(实现阶段落实) |
| IV 最少第三方依赖 | 运行时 0 依赖(node:fs/promises、node:path);开发期仅 TypeScript + Vitest + @types/node | ✅ 通过 |
| V 质量门禁 | 每任务完成定义含 `npx tsc --noEmit` + `npm test` 全绿;验收演示以测试形式打印统计 | ✅ 通过 |
| VI 数据安全红线 | 测试仅用 fixtures(只读)+ mkdtemp(可写);无任何真实 Agent 目录路径 | ✅ 通过 |
| VII 分层架构 | 注册表+描述符驱动(无 if (source===…) 散落);adapter 纯函数;fs 仅 session-loader | ✅ 通过(设计即约束) |

**Phase 1 设计后复核**:无新增违例。见 Complexity Tracking(空)。

## Project Structure

### Documentation (this feature)

```text
specs/001-phase1-session-core/
├── plan.md              # 本文件(/speckit-plan 输出)
├── research.md          # Phase 0 产出:决策与备选
├── data-model.md        # Phase 1 产出:领域模型
├── quickstart.md        # Phase 1 产出:端到端验证指南
├── contracts/           # Phase 1 产出:接口契约
│   └── core-interfaces.md
└── tasks.md             # Phase 2 产出(/speckit-tasks 生成,本命令不创建)
```

### Source Code (repository root)

```text
├── package.json            # "type": "module";scripts: test / typecheck
├── tsconfig.json           # strict:true / module:NodeNext / target:ES2023 / noEmit
├── vitest.config.ts        # 测试配置(仅默认约定需要时保留)
├── fixtures/               # 合成会话数据(只读;绝不放真实数据)
│   ├── claude/             # claude-cli 样例:正常×2 / 半行损坏 / BOM / 空文件 / 含未知行
│   ├── codex/              # codex 样例:rollout-*.jsonl 正常×2 / 半行损坏
│   └── workbuddy/          # workbuddy-cli 样例:秒级时间戳 / 含空行
└── src/
    └── core/
        ├── types.ts               # 全部领域类型(单一出处)
        ├── session-sources.ts     # SESSION_SOURCE_REGISTRY + 不变量自检
        ├── format-adapters.ts     # FORMAT_ADAPTERS:按格式的纯函数适配器
        ├── session-loader.ts      # loadSessions():唯一 fs 访问模块
        ├── session-sources.test.ts
        ├── format-adapters.test.ts
        └── session-loader.test.ts # 含【验收演示】统计输出测试
```

**Structure Decision**: 单项目 library 结构(对应宪法「工程约束与技术栈」的固定目录);测试与源码同目录(宪法 V);阶段 2+ 的 `src/store/`、`src/agent/`、`src/mcp/`、`src/cli.ts` 等目录由后续阶段按学习计划加入,本阶段不预建空目录。

## Complexity Tracking

> 仅当宪法检查存在必须解释的违例时填写。

| 违例 | 为什么需要 | 被拒绝的更简单替代 |
| --- | --- | --- |
| (无) | — | — |
