import { DEFAULT_MAX_TOKENS, type LlmClient, type LlmRequest, type LlmResponse } from "./types";

interface ChatCompletion {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

/** OpenAI-compatible /chat/completions（供国内模型接入），用内置 fetch 实现，不引入 SDK */
export function createOpenAiCompatibleClient(opts: { apiKey: string; model: string; baseUrl: string }): LlmClient {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return {
    model: opts.model,
    async complete(req: LlmRequest, tag: string): Promise<LlmResponse> {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
          model: opts.model,
          temperature: 0.3,
          max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
        }),
      });
      const bodyText = await res.text();
      if (!res.ok) throw new Error(`[${tag}] ${url} 返回 HTTP ${res.status}：${bodyText.slice(0, 300)}`);
      let data: ChatCompletion;
      try {
        data = JSON.parse(bodyText) as ChatCompletion;
      } catch {
        throw new Error(`[${tag}] 响应不是 JSON：${bodyText.slice(0, 300)}`);
      }
      if (data.error?.message) throw new Error(`[${tag}] 接口错误：${data.error.message}`);
      const choice = data.choices?.[0];
      const text = choice?.message?.content ?? "";
      if (choice?.finish_reason === "length") throw new Error(`[${tag}] 输出超过 max_tokens 被截断`);
      return {
        text,
        usage: { input_tokens: data.usage?.prompt_tokens ?? 0, output_tokens: data.usage?.completion_tokens ?? 0 },
      };
    },
  };
}
