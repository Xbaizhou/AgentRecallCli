# 快速验证指南:阶段 2 存储与增量索引

> 前提:Node ≥ 22.13(已验证 node:sqlite/FTS5/trigram/WAL/只读连接)。

## 1. 命令

```bash
npm install && npm run typecheck && npm test
```

## 2. 验收演示(npm test 内)

【验收演示】用例在 mkdtemp 目录构造 4 个会话文件并完成:

```text
1) 首次同步:   indexed=4, skipped=0, removed=0
2) 二次同步:   indexed=0, skipped=4          ← SC-001
3) 追加改动 1 个文件后同步: indexed=1, skipped=3
4) 删除 1 个文件后同步:      removed=1
5) searchContent("全文检索") 命中中文;("size") 命中英文  ← SC-002
6) 性能数据:  全量 vs 增量同步耗时、FTS5 vs LIKE(万条消息)耗时打印
```

## 3. 手工抽查(可选)

```bash
node -e "
import('node:sqlite').then(({DatabaseSync})=>{
  const db=new DatabaseSync(process.env.HOME+'/.mini-recall/mini-recall.db',{readOnly:true});
  console.log(db.prepare('SELECT session_key,message_count FROM sessions').all());
})"
```

## 4. 完成判据

- SC-001 增量正确;SC-002 中英文命中;SC-003 upsert 幂等;SC-004 万条对比数据;SC-005 内存库全绿零残留;SC-006 全量/增量对比数据。
- 违反红线(触碰 ~/.claude、~/.codex)的实现一律拒绝(宪法 VI)。
