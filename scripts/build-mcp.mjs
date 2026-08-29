// esbuild 打包:零依赖单文件 CJS bundle(计划 5.2)。
// 零依赖的理由:server 装在用户机器上全局可用(免拖依赖树)、启动快、与应用主进程解耦。
import { build } from "esbuild";

await build({
  entryPoints: ["src/mcp/server.ts"],
  outfile: "dist/mini-recall-mcp.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  // .js 后缀 → .ts 的解析由 esbuild 的 TypeScript 约定处理;zod 一并打入,产物零运行时依赖
  minify: false,
  sourcemap: false,
  logLevel: "info",
});
console.log("构建完成: dist/mini-recall-mcp.cjs");
