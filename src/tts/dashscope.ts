/** 阿里云 DashScope 原生接口的 Qwen3-TTS（非流式）：返回音频 URL，再下载为 WAV */
export interface TtsClient {
  readonly model: string;
  readonly voice: string;
  synthesize(text: string): Promise<Buffer>;
}

export interface DashScopeTtsOptions {
  apiKey: string;
  /** DashScope 地址，到 /api/v1 为止 */
  baseUrl: string;
  model: string;
  voice: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface TtsResponse {
  output?: { audio?: { url?: string; data?: string }; finish_reason?: string };
  code?: string;
  message?: string;
}

const RETRIES = 1;

export function createDashScopeTts(opts: DashScopeTtsOptions): TtsClient {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/services/aigc/multimodal-generation/generation`;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 120_000;

  const once = async (text: string): Promise<Buffer> => {
    const res = await fetchImpl(url, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({ model: opts.model, input: { text, voice: opts.voice, language_type: "Chinese" } }),
    });
    const bodyText = await res.text();
    if (res.status === 429 || res.status >= 500) throw new RetryableError(`TTS HTTP ${res.status}：${bodyText.slice(0, 300)}`);
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}：${bodyText.slice(0, 300)}`);
    const data = JSON.parse(bodyText) as TtsResponse;
    if (data.code) throw new Error(`TTS 接口错误 ${data.code}：${data.message ?? ""}`);
    const audio = data.output?.audio;
    if (audio?.data) return Buffer.from(audio.data, "base64");
    if (!audio?.url) throw new Error(`TTS 响应没有音频：${bodyText.slice(0, 300)}`);
    const dl = await fetchImpl(audio.url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!dl.ok) throw new RetryableError(`下载 TTS 音频失败 HTTP ${dl.status}`);
    return Buffer.from(await dl.arrayBuffer());
  };

  return {
    model: opts.model,
    voice: opts.voice,
    async synthesize(text: string): Promise<Buffer> {
      for (let attempt = 0; ; attempt++) {
        try {
          return await once(text);
        } catch (e) {
          const retryable = e instanceof RetryableError || (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"));
          if (!retryable || attempt >= RETRIES) throw e;
          console.error(`${(e as Error).message}，2 秒后重试`);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    },
  };
}

class RetryableError extends Error {}
