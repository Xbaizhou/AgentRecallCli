// zod 契约工厂:跨边界调用的一致性防线。进程边界(渲染层→core、模型→工具)上类型系统失效,
// 传入值是 unknown——同一份 schema 同时提供运行时校验与 TS 类型推导(计划 3.2 的核心论据)。
import type { z } from "zod";

export interface Command<S extends z.ZodType> {
  /** 命令名:既是 CLI 子命令,也是阶段 4 模型工具名 */
  name: string;
  schema: S;
  /** 校验并解析:失败抛 ZodError(字段级 issues);成功返回收紧类型的值 */
  parse(input: unknown): z.infer<S>;
}

export function defineCommand<S extends z.ZodType>(name: string, schema: S): Command<S> {
  return {
    name,
    schema,
    parse(input: unknown) {
      return schema.parse(input);
    },
  };
}
