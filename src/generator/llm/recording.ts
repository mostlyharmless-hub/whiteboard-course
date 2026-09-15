import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tagToFile } from "./fixture";
import type { LlmClient, LlmRequest, LlmResponse } from "./types";

/** 把每次调用的提示词与响应落盘：<dir>/<tag>.txt 是响应（可直接作 fixture），<dir>/<tag>.prompt.md 是提示词 */
export function withRecording(client: LlmClient, dir: string): LlmClient {
  mkdirSync(dir, { recursive: true });
  return {
    model: client.model,
    async complete(req: LlmRequest, tag: string): Promise<LlmResponse> {
      writeFileSync(join(dir, tagToFile(tag).replace(/\.txt$/, ".prompt.md")), `# system\n\n${req.system}\n\n# user\n\n${req.user}\n`);
      const res = await client.complete(req, tag);
      writeFileSync(join(dir, tagToFile(tag)), res.text);
      return res;
    },
  };
}
