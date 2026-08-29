# 领域模型:阶段 1 领域内核

> 类型唯一出处为 `src/core/types.ts`;本文件记录字段语义、校验规则与派生规则。
> 对应真实源码:AgentRecall v1 `src/core/types.ts`(精简复现,保留抽象形状)。

## 实体关系总览

```text
SessionSourceDescriptor (注册表一行,静态声明)
        │ format 决定 ──────────────┐
        │ relativeDir+filePattern   │
        ▼                           ▼
   session-loader.loadSessions()   FORMAT_ADAPTERS[format](纯函数)
        │  <rootDir>/<relativeDir> 递归找文件        │ 文本进 → 领域对象出
        ▼                                           ▼
   LoadResult { sessions: LoadedSession[], stats } ←── 组装(sessionKey/messageCount)
                       │
                       ├── LoadedSession { session: Session, messages: SessionMessage[] }
                       └── stats.perSource[] { source, sessionCount, messageCount, skippedBadLines }
```

## Session(会话)

| 字段 | 类型 | 语义 | 派生/校验规则 |
| --- | --- | --- | --- |
| `sessionKey` | string | 业务标识 | `${source}:${rawId}`,由 loader 组装;本阶段不做唯一性约束(阶段 2 存储层管唯一) |
| `source` | SessionSource | 来源 ID | 必须来自注册表 |
| `rawId` | string | 原始会话 ID | claude=`sessionId`、codex=`session_id`;缺失或 workbuddy → 文件名去扩展名 |
| `projectPath` | string | 项目路径 | 内容中 `cwd`;无则 `""` |
| `filePath` | string | 文件绝对路径 | loader 填入 |
| `originalTitle` | string | 原始标题 | 文件名去扩展名(简化决策,见 research R6) |
| `firstQuestion` | string | 首个用户提问 | 第一条 role=user 消息内容;无则 `""` |
| `timestamp` | number | 会话时间(ms) | 第一条消息归一后时间;无消息则 `0` |
| `messageCount` | number | 消息数 | `messages.length`,loader 填入 |

## SessionMessage(会话消息)

| 字段 | 类型 | 语义 | 规则 |
| --- | --- | --- | --- |
| `index` | number | 文件内序号 | 从 0 递增,按出现顺序 |
| `role` | string | 角色 | `user` / `assistant` |
| `content` | string | 文本内容 | claude 数组 content 取 text 拼接 |
| `timestamp` | number | 时间(ms) | 经 `normalizeTimestampMs` 归一 |

## LoadedSession(已加载会话)

`{ session: Session; messages: SessionMessage[] }` —— 加载器的产出单元,阶段 2 索引器的输入单元。

## SessionSourceDescriptor(来源描述符,注册表行)

| 字段 | 类型 | 语义 | 校验(不变量自检) |
| --- | --- | --- | --- |
| `id` | SessionSource | 唯一 ID | 非空且注册表内不重复 |
| `label` | string | 显示名 | 非空 |
| `format` | SessionFormat | 解析格式 | 必须在 FORMAT_ADAPTERS 中有对应适配器 |
| `family` | string | 来源族 | 非空;同族来源共享族行为(阶段用途) |
| `optionalSetting` | string \| null | 显式开启项 | null = 默认开启;否则为设置键名 |
| `relativeDir` | string | 根目录下相对目录 | 非空,禁止绝对路径与 `..` |
| `filePattern` | RegExp | 文件名匹配 | 必须为 RegExp 实例 |
| `capabilities` | SessionSourceCapabilities | 五项能力 | 五个键全为 boolean |

### 内置来源(3 个,依澄清结论)

| id | family | format | optionalSetting | relativeDir | filePattern | capabilities |
| --- | --- | --- | --- | --- | --- | --- |
| `claude-cli` | claude | claude-jsonl | null(默认开) | `claude` | `/\.jsonl$/` | live/resume/migrate/sessionSync=true, openApp=false |
| `codex` | codex | codex-jsonl | null(默认开) | `codex` | `/^rollout-.*\.jsonl$/` | live/resume=true, 其余 false |
| `workbuddy-cli` | workbuddy | workbuddy-jsonl | `"sources.workbuddy.enabled"` | `workbuddy` | `/\.jsonl$/` | **全 false(只读来源实例)** |

默认加载范围 = `optionalSetting === null` 的来源(即 claude-cli + codex)。

## SessionSourceCapabilities(能力开关)

`live`(进行中会话)/ `resume`(续聊)/ `migrate`(迁移)/ `sessionSync`(hook 同步)/ `openApp`(打开对应 App)——全部 boolean。上层按声明式能力决定行为,替代条件分支。

## LoadResult / 统计

```text
LoadOptions  { rootDir: string; sources?: SessionSource[] }
LoadResult   { sessions: LoadedSession[]; stats: LoadStats }
LoadStats    { perSource: SourceLoadStats[] }   // 每个启用来源一条,注册表顺序
SourceLoadStats { source; sessionCount; messageCount; skippedBadLines }
```

- 启用但无文件的来源也出现在 stats 中(计 0),保证统计完整性(SC-003)。
- `skippedBadLines` = 坏行(JSON.parse 失败)+ 适配器返回 null 的文件数(1/文件);空行与「合法但非消息」的行不计入。

## 时间戳归一(normalizeTimestampMs)

```text
number          → < 10^12 ? ×1000 : 原值
纯数字字符串     → 转数字后同上
ISO 8601 字符串  → Date.parse()
其他/解析失败    → 0(不判坏行:元数据缺失不丢消息)
```

## 生命周期与状态

本阶段全部实体为不可变值对象:适配器与加载器不修改输入,`loadSessions()` 为纯查询(唯一副作用是读 fs)。无持久化、无状态迁移——生命周期管理(增量索引)属阶段 2。
