import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LlmClient, LlmRequest, LlmResponse } from "./types";

/** tag → 文件名：冒号换成短横线 */
export function tagToFile(tag: string): string {
  return `${tag.replace(/[:/\\]/g, "-")}.txt`;
}

/** 从目录读取预录响应；用于离线测试与复现 */
export function createFixtureClient(dir: string): LlmClient {
  return {
    model: "fixture",
    complete(_req: LlmRequest, tag: string): Promise<LlmResponse> {
      const path = join(dir, tagToFile(tag));
      if (!existsSync(path)) return Promise.reject(new Error(`fixture 缺少响应文件：${path}`));
      return Promise.resolve({ text: readFileSync(path, "utf8"), usage: { input_tokens: 0, output_tokens: 0 } });
    },
  };
}
