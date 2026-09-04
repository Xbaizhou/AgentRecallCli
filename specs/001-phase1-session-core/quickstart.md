# 快速验证指南:阶段 1 领域内核

> 目标:不读实现代码,也能在 5 分钟内验证「合成 fixtures → LoadedSession[] + 统计」闭环。
> 前提:Node ≥ 22.13(本机 v24.15.0);依赖白名单仅 TypeScript / Vitest / @types/node。

## 1. 环境准备

```bash
npm install          # 安装开发期依赖(仅白名单内)
npx tsc --noEmit     # 静态门禁:必须 0 错误
npm test             # 全部测试必须全绿
```

## 2. 验收演示(npm test 内自动执行)

测试套件包含一个固定的 **【验收演示】** 用例:加载仓库内只读的 `fixtures/`(claude / codex / workbuddy 三来源合成样例),在输出中打印统计表,形如:

```text
来源          会话数   消息数   坏行数
claude-cli        3       6        1
codex             2       5        1
workbuddy-cli     0       0        0   ← 默认不开,显式 sources 时才有数
```

**核对点**(对照 spec 成功标准):

- [ ] `fixtures/` 内 ≥ 10 个 jsonl,含半行损坏样例(SC-001);
- [ ] 半行损坏文件:正常行全解析,坏行计数与文件中实际坏行数一致(SC-001);
- [ ] 带 BOM、空文件样例不导致失败,空文件产出 0 消息会话(SC-002);
- [ ] 统计表三列齐备,10 秒内可读(SC-003);
- [ ] 默认加载不出现 workbuddy-cli(澄清结论:仅 optionalSetting=null 默认开);
- [ ] 显式 `sources: ["claude-cli"]` 时,结果 0 条来自其他来源(SC-005)。

## 3. 手工抽查(可选)

用任一 JSONL 查看器打开:

- `fixtures/claude/broken-halfline.jsonl` — 最后一行是截断 JSON;
- `fixtures/codex/rollout-20260801T100000.jsonl` — 毫秒时间戳;
- `fixtures/workbuddy/session-a.jsonl` — 秒级时间戳(验证归一启发式)。

## 4. 常见问题

| 现象 | 处置 |
| --- | --- |
| `DatabaseSync is not defined` | 本阶段不应出现(无 SQLite);若见,说明误入阶段 2 代码 |
| Vitest 找不到 `*.test.ts` | 确认测试与源码同目录、文件名 `*.test.ts` |
| tsc 报 cannot find module | 检查相对导入是否带 `.js` 后缀(宪法工程约束) |
| 测试读写了真实目录 | **立即停止**——违反宪法 VI 数据安全红线,应只用 fixtures + mkdtemp |

## 5. 完成判据

`npx tsc --noEmit` 与 `npm test` 全绿,且验收演示统计输出与 `fixtures/` 实际内容一致,即满足阶段 1 验收(计划 1.4 三条标准全部覆盖)。
