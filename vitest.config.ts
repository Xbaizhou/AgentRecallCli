import { defineConfig } from "vitest/config";

// 测试运行于 node 环境;测试文件与源码同目录(宪法 V)。
// include 收紧到 src/:仓库内并存的原版参照仓库 main-1.0(阶段 0)自带测试,不得被本项目收集。
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
