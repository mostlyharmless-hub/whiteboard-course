import { createAnthropicClient } from "./anthropic";
import { createOpenAiCompatibleClient } from "./openai-compatible";
import type { LlmClient } from "./types";

export type { LlmClient, LlmRequest, LlmResponse } from "./types";
export { createFixtureClient } from "./fixture";
export { withRecording } from "./recording";

const HELP = "请复制 .env.example 为 .env 并填写 LLM_PROVIDER / LLM_MODEL / LLM_API_KEY（OpenAI-compatible 还需 LLM_BASE_URL）";

/** 按 .env 选择实现：LLM_PROVIDER=anthropic（默认）| openai-compatible */
export function createLlmClient(env: NodeJS.ProcessEnv): LlmClient {
  const provider = (env.LLM_PROVIDER ?? "anthropic").trim();
  const apiKey = env.LLM_API_KEY?.trim();
  if (!apiKey) throw new Error(`缺少 LLM_API_KEY。${HELP}`);
  const baseUrl = env.LLM_BASE_URL?.trim() || undefined;
  if (provider === "anthropic") {
    const model = env.LLM_MODEL?.trim() || "claude-opus-5";
    return createAnthropicClient(baseUrl ? { apiKey, model, baseUrl } : { apiKey, model });
  }
  if (provider === "openai-compatible") {
    const model = env.LLM_MODEL?.trim();
    if (!model) throw new Error(`OpenAI-compatible 需要 LLM_MODEL。${HELP}`);
    if (!baseUrl) throw new Error(`OpenAI-compatible 需要 LLM_BASE_URL（如 https://api.deepseek.com/v1）。${HELP}`);
    const timeoutMs = Number(env.LLM_TIMEOUT_MS ?? "");
    return createOpenAiCompatibleClient(Number.isFinite(timeoutMs) && timeoutMs > 0 ? { apiKey, model, baseUrl, timeoutMs } : { apiKey, model, baseUrl });
  }
  throw new Error(`未知的 LLM_PROVIDER「${provider}」，可选 anthropic | openai-compatible`);
}
