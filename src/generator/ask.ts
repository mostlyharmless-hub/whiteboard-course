import type { z } from "zod";
import { extractJson } from "./json";
import type { LlmClient, LlmRequest } from "./llm/types";
import type { Usage } from "./types";

export type AskResult<T> = { ok: true; value: T; text: string } | { ok: false; error: string; text: string };

/** 一次"只要 JSON"的调用：累计 token 用量 → 剥围栏解析 → zod 校验；失败返回可放进打回清单的错误文字 */
export async function askJson<T>(llm: LlmClient, req: LlmRequest, schema: z.ZodType<T>, tag: string, usage: Usage): Promise<AskResult<T>> {
  const res = await llm.complete(req, tag);
  usage.calls += 1;
  usage.input_tokens += res.usage.input_tokens;
  usage.output_tokens += res.usage.output_tokens;
  const json = extractJson(res.text);
  if (!json.ok) return { ok: false, error: json.error, text: res.text };
  const parsed = schema.safeParse(json.value);
  if (!parsed.success) {
    const lines = parsed.error.issues.slice(0, 10).map((i) => `- ${i.path.length > 0 ? i.path.join(".") : "根"}：${i.message}`);
    return { ok: false, error: `JSON 结构不符合要求：\n${lines.join("\n")}`, text: res.text };
  }
  return { ok: true, value: parsed.data, text: res.text };
}
