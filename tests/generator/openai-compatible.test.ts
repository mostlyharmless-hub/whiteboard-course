import { describe, expect, it, vi } from "vitest";
import { createOpenAiCompatibleClient } from "../../src/generator/llm/openai-compatible";

const ok = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });

const make = (fetchImpl: typeof fetch) =>
  createOpenAiCompatibleClient({ apiKey: "k", model: "m", baseUrl: "https://x/v1/", fetchImpl, sleep: () => Promise.resolve() });

describe("OpenAI-compatible 客户端", () => {
  it("正常响应：取 content 与 usage，只读 message.content（忽略 reasoning_content）", async () => {
    const fetchImpl = vi.fn(async () => ok("[1]"));
    const r = await make(fetchImpl as unknown as typeof fetch).complete({ system: "s", user: "u" }, "t");
    expect(r).toEqual({ text: "[1]", usage: { input_tokens: 10, output_tokens: 5 } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x/v1/chat/completions");
    const body = JSON.parse(String(init.body)) as { model: string; temperature: number; messages: { role: string }[] };
    expect(body).toMatchObject({ model: "m", temperature: 0.3 });
    expect(body.messages.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("超时后重试一次", async () => {
    const err = new Error("timeout");
    err.name = "TimeoutError";
    const fetchImpl = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce(ok("ok"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await make(fetchImpl as unknown as typeof fetch).complete({ system: "s", user: "u" }, "t");
    expect(r.text).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0]?.[0]).toMatch(/超时/);
    spy.mockRestore();
  });

  it("5xx 重试，连续失败后抛错", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad gateway", { status: 502 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(make(fetchImpl as unknown as typeof fetch).complete({ system: "s", user: "u" }, "t")).rejects.toThrow(/502/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it("4xx 不重试", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":{"message":"no such model"}}', { status: 400 }));
    await expect(make(fetchImpl as unknown as typeof fetch).complete({ system: "s", user: "u" }, "t")).rejects.toThrow(/400/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("finish_reason=length 视为截断错误", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "[" }, finish_reason: "length" }] }), { status: 200 }));
    await expect(make(fetchImpl as unknown as typeof fetch).complete({ system: "s", user: "u" }, "t")).rejects.toThrow(/截断/);
  });
});
