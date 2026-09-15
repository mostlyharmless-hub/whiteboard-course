export interface LlmRequest {
  system: string;
  user: string;
  maxTokens?: number;
}

export interface LlmResponse {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
}

/** 生成器唯一的 LLM 入口；tag 用于日志、录制与 fixture 查找（如 "outline"、"script:s1"、"repair:s1:1"） */
export interface LlmClient {
  readonly model: string;
  complete(req: LlmRequest, tag: string): Promise<LlmResponse>;
}

export const DEFAULT_MAX_TOKENS = 8192;
