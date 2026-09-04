# 研究记录:阶段 1 领域内核

> 本文件解决 Technical Context 与规格中的全部待定项。每项决策给出「决策 / 理由 / 被拒备选」。
> 全部决策受宪法约束:不引入白名单外依赖,不破坏分层边界。

## R1. 时间戳归一启发式

- **决策**:统一归一为毫秒。规则:`number` → 值 < 10^12 视为秒 ×1000,否则视为毫秒;字符串为纯数字 → 转数字后同上;字符串为 ISO 8601 → `Date.parse()`;非法输入(解析失败)→ `0` 并由调用方按坏数据处理吗?不——非法时间戳不判坏行,记 `0`(容错优先,不因元数据缺失丢消息)。
- **理由**:计划 1.6 明确「在 adapter 里统一归一成 ms,写一条边界测试」;10^12 阈值可区分秒(≈10^9 量级,至 2286 年)与毫秒(≈10^12,2001 年后),对会话数据足够。
- **备选**:按字段名判断单位(`ts` vs `timestamp`)——被拒:格式一变就失效,且同格式内也可能混用;按字符串长度判断——被拒:与数值判断重复且更绕。

## R2. 来源目录约定与文件匹配

- **决策**:描述符携带 `relativeDir`(如 `"claude"`)与 `filePattern`(正则,如 `/\.jsonl$/`);加载器通用地遍历 `rootDir/<relativeDir>` 递归目录,用 `filePattern` 过滤文件。真实用户目录(如 `~/.claude/projects/...`)到 `rootDir` 的映射属实现层/后续阶段,本阶段 fixtures 直接按 `fixtures/<relativeDir>/` 组织。
- **理由**:满足 FR-009 目录约定;通用遍历 + 描述符驱动 = 新增来源零分支(宪法 VII);正则比 glob 语义更可控。
- **备选**:引入 glob 库——被拒:违反依赖白名单,递归 `readdir(withFileTypes)` 十几行即可;把目录逻辑写进 adapter——被拒:违反「adapter 纯函数、loader 独占 fs」的分层。

## R3. 半行 JSON 与坏行判定

- **决策**:逐行 `JSON.parse` + try/catch;解析失败 = 坏行,计数后跳过;**空行与纯空白行直接跳过且不计坏行**;合法 JSON 但非消息行(如 claude 的 `summary`、codex 的未知 `type`)静默忽略且不计坏行。
- **理由**:坏行的定义应只与「能否解析」相关,语义噪声另算;半行损坏(崩溃现场)正是 try/catch 能覆盖的验收场景。
- **备选**:流式解析器(逐字节)——被拒:YAGNI,文件级 read + split 足够,字节偏移尾扫属阶段 2 增量索引。

## R4. BOM 与编码

- **决策**:读文件按 utf-8;解析前 `text.replace(/^\uFEFF/, "")` 剥离 BOM。
- **理由**:计划 1.6 坑点表的标准做法;Windows 编辑器常产生 BOM。

## R5. 三种格式的合成样例行结构

> fixtures 为自写合成数据,行结构「对照真实源码精简」:保留字段名与嵌套风格,砍掉 token/trace 等扩展。

- **claude-jsonl**(ISO 字符串时间戳):
  ```json
  {"type":"user","sessionId":"<uuid>","cwd":"/proj/demo","timestamp":"2026-08-01T10:00:00.000Z","message":{"role":"user","content":"..."}}
  {"type":"assistant","sessionId":"<uuid>","cwd":"/proj/demo","timestamp":"2026-08-01T10:00:05.000Z","message":{"role":"assistant","content":"..."}}
  ```
  `message.content` 兼容字符串或 `[{type:"text",text:"..."}]` 数组(取 text 拼接)。
- **codex-jsonl**(数值毫秒时间戳):
  ```json
  {"type":"session_meta","session_id":"<id>","cwd":"/proj/codex","timestamp":1754035200000}
  {"type":"response_item","payload":{"role":"user","content":"..."},"timestamp":1754035205000}
  ```
- **workbuddy-jsonl**(数值秒时间戳,最简格式):
  ```json
  {"ts":1754035200,"role":"user","text":"..."}
  ```

- **理由**:三种格式恰好覆盖时间戳三种形态(ISO / 毫秒数 / 秒数),归一边界测试无需额外构造;字段命名贴近真实来源,复现讲解时可对照。
- **备选**:全用同构简化行——被拒:失去「格式适配器为什么按来源分」的论证力。

## R6. 会话元数据派生

- **决策**:`rawId` = claude/codex 从内容提取(`sessionId` / `session_id`),workbuddy 与提取失败时回退为文件名(去扩展名);`projectPath` = 内容中的 `cwd`(无则空串);`firstQuestion` = 第一条 role=user 消息内容(无则空串);`originalTitle` = 文件名去扩展名(简化:真实版有 summary 行,砍);会话 `timestamp` = 第一条消息归一后时间戳(无消息则 0);`messageCount` 由 loader 按 `messages.length` 填;`sessionKey` = `${source}:${rawId}` 由 loader 组装。
- **理由**:元数据派生规则一次定清,测试才可断言;简化点明确记录,是「与工业级差距清单」的一部分。
- **备选**:title 从内容摘要生成——被拒:需要额外规则,YAGNI。

## R7. 适配器返回 null 的语义

- **决策**:`ParsedFile | null` 中 `null` 表示「该格式整体无法解析」;对合法 utf-8 文本(含空文件)适配器**永不**返回 null(空文件按 FR-012 产出 0 消息会话)。loader 收到 null 时把该文件计入 `skippedBadLines`(1/文件)并继续。
- **理由**:满足 FR-002 接口形状,同时避免空文件被误判为整体失败;null 通道为未来「魔数校验/加密文件」类场景保留。

## R8. 测试与验收演示形态

- **决策**:`npm test` 内包含一个固定的【验收演示】测试:加载 `fixtures/` 全目录,打印「每个来源会话数/消息数/坏行数」统计表并断言核心数字;其余测试用 `mkdtemp` 临时目录复制/构造损坏场景。fixtures 目录只读,永不写入。
- **理由**:计划 1.4 明确「本阶段用一条测试脚本代替可运行演示」;免建 dist 构建,保持零门槛复现。
- **备选**:`tsc` 构建后跑独立 demo 脚本——被拒:引入构建步骤,违背简洁原则且无增量价值。

## R9. 模块导入后缀

- **决策**:相对导入一律带 `.js` 后缀(宪法原文),配合 `module: NodeNext` 与 `tsc --noEmit`;Vitest 的解析器原生支持 `.js` → `.ts` 映射,运行全走 Vitest,无需构建产物。
- **理由**:与计划 1.6「NodeNext 记得带 .js 后缀」一致;避免 allowImportingTsExtensions 这类非默认开关。
- **备选**:`.ts` 后缀直跑 node——被拒:偏离宪法字面约定且引入额外 tsconfig 开关。

## R10. 确定性与排序

- **决策**:启用来源按注册表顺序处理;同来源内文件按完整路径字典序;`loadSessions()` 对相同输入输出完全一致(满足 SC-006)。
- **理由**:统计演示与测试断言需要稳定顺序;纯函数式可重跑也是阶段 2 增量索引的对照基线。

## R11. Node API 选型

- **决策**:目录遍历用 `node:fs/promises` 的 `readdir(..., { withFileTypes: true })` 递归实现;读文件 `readFile(path, "utf8")`;路径拼接 `node:path` 的 `join/resolve`;测试临时目录 `mkdtemp`。
- **理由**:全部内置模块,零依赖;`withFileTypes` 一次拿类型,避免额外 stat。
- **备选**:`fs.extra`/glob 类库——被拒:白名单外。
