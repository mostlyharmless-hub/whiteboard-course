import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_MAX_TOKENS, type LlmClient, type LlmRequest, type LlmResponse } from "./types";

/**
 * Anthropic 官方 SDK 实现。不发送 temperature（Opus 5 / Sonnet 5 已移除该参数），
 * 也不显式配置 thinking（当前型号默认 adaptive）。
 */
export function createAnthropicClient(opts: { apiKey: string; model: string; baseUrl?: string }): LlmClient {
  const client = new Anthropic(opts.baseUrl ? { apiKey: opts.apiKey, baseURL: opts.baseUrl } : { apiKey: opts.apiKey });
  return {
    model: opts.model,
    async complete(req: LlmRequest, tag: string): Promise<LlmResponse> {
      const response = await client.messages.create({
        model: opts.model,
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      });
      if (response.stop_reason === "refusal") throw new Error(`[${tag}] 模型拒绝了请求：${response.stop_details?.explanation ?? "无说明"}`);
      if (response.stop_reason === "max_tokens") throw new Error(`[${tag}] 输出超过 max_tokens 被截断`);
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return { text, usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens } };
    },
  };
}
