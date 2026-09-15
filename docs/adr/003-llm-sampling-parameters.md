# ADR 003：LLM 采样参数按供应商区分，Anthropic 路径不发送 temperature

- 日期：2026-09-15
- 状态：已采纳
- 影响：CLAUDE.md 6.7；`src/generator/llm/anthropic.ts`、`openai-compatible.ts`

## 背景

规格要求 `temperature 0.3`。Anthropic 当前型号（Claude Opus 5 / Sonnet 5 及 4.7+ 系列）已移除 `temperature / top_p / top_k` 参数，发送即返回 400；这些型号默认启用 adaptive thinking，输出确定性由模型自身与提示词保证。国内 OpenAI-compatible 模型（本项目首个接入的是阿里云 `qwen3.8-max`）仍接受 `temperature`。

## 决定

- Anthropic 路径：不发送 `temperature`，不显式配置 `thinking`（默认 adaptive），`max_tokens 8192`，默认型号 `claude-opus-5`。
- OpenAI-compatible 路径：`temperature 0.3`，`max_tokens 8192`，只读取 `choices[0].message.content`（Qwen 等模型的思考内容在 `reasoning_content` 字段，忽略）。
- 输出稳定性统一靠"只输出 JSON + 剥围栏 + zod 校验 + 语义校验打回（≤ 2 轮）"保证，而不是靠采样参数。

## 影响

- 切换供应商只改 `.env`，代码不变。
- 若未来接入的 OpenAI-compatible 端点不接受 `temperature`，在 `openai-compatible.ts` 增加一个环境变量开关即可，不影响契约。
