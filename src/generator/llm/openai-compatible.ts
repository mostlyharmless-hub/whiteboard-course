import { DEFAULT_MAX_TOKENS, type LlmClient, type LlmRequest, type LlmResponse } from "./types";

interface ChatCompletion {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

/** 单次请求超时；带推理的模型一节可能要 3 分钟以上 */
export const REQUEST_TIMEOUT_MS = 300_000;
/** 超时 / 网络错误 / 429 / 5xx 的重试次数与间隔 */
export const RETRIES = 1;
export const RETRY_DELAY_MS = 2_000;

export interface OpenAiCompatibleOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs?: number;
  /** 测试注入；默认全局 fetch */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

class RetryableError extends Error {}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** OpenAI-compatible /chat/completions（供国内模型接入），用内置 fetch 实现，不引入 SDK */
export function createOpenAiCompatibleClient(opts: OpenAiCompatibleOptions): LlmClient {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;

  const once = async (req: LlmRequest, tag: string): Promise<LlmResponse> => {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
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
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      const msg = e instanceof Error ? e.message : String(e);
      const why = name === "TimeoutError" || name === "AbortError" ? `请求超过 ${timeoutMs / 1000} 秒超时` : `网络错误：${msg}`;
      throw new RetryableError(`[${tag}] ${why}`);
    }
    const bodyText = await res.text();
    if (res.status === 429 || res.status >= 500) throw new RetryableError(`[${tag}] ${url} 返回 HTTP ${res.status}：${bodyText.slice(0, 300)}`);
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
  };

  return {
    model: opts.model,
    async complete(req: LlmRequest, tag: string): Promise<LlmResponse> {
      for (let attempt = 0; ; attempt++) {
        try {
          return await once(req, tag);
        } catch (e) {
          if (!(e instanceof RetryableError) || attempt >= RETRIES) throw e;
          console.error(`${e.message}，${RETRY_DELAY_MS / 1000} 秒后重试（${attempt + 1}/${RETRIES}）`);
          await sleep(RETRY_DELAY_MS);
        }
      }
    },
  };
}
