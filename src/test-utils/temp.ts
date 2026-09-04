// 测试用临时目录:一律落在仓库本地 .tmp/,不用 os.tmpdir()。
//
// 为什么不用系统 Temp:清理耗时会随机器的 Temp 状态剧烈波动。本机实测删除同一批
// 100 个文件——系统 Temp(C:\Users\x\AppData\Local\Temp)约 21ms/文件、总计 >10s,
// 会直接撞上 vitest 的 10s hookTimeout;仓库本地目录约 300ms,快 30 倍以上。
// 测试收尾(用完即收,同 WAL 约定)不该被系统目录的性能左右,否则 CI 上也会随机飘红。
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

/** 仓库根下的 .tmp/(已 gitignore);src/test-utils → ../.. */
const TMP_ROOT = join(import.meta.dirname, "..", "..", ".tmp");

/** 在 .tmp/ 下建一个唯一临时目录,前缀建议带来源便于定位残留 */
export async function makeTempDir(prefix: string): Promise<string> {
  await mkdir(TMP_ROOT, { recursive: true });
  return mkdtemp(join(TMP_ROOT, prefix));
}

/** 递归删除;force 保证残留不阻塞后续用例 */
export async function removeTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
