import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFixtureClient, createLlmClient, withRecording } from "../../src/generator/llm";
import { tagToFile } from "../../src/generator/llm/fixture";

describe("fixture 客户端", () => {
  it("按 tag 读取文件，冒号映射为短横线", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wb-fixture-"));
    writeFileSync(join(dir, "script-s1.txt"), "[]");
    const llm = createFixtureClient(dir);
    expect(tagToFile("script:s1")).toBe("script-s1.txt");
    await expect(llm.complete({ system: "", user: "" }, "script:s1")).resolves.toMatchObject({ text: "[]" });
    await expect(llm.complete({ system: "", user: "" }, "missing")).rejects.toThrow(/缺少响应文件/);
  });
});

describe("录制包装", () => {
  it("把提示词与响应写到目录", async () => {
    const src = mkdtempSync(join(tmpdir(), "wb-src-"));
    const rec = mkdtempSync(join(tmpdir(), "wb-rec-"));
    writeFileSync(join(src, "outline.txt"), '[{"id":"s1"}]');
    const llm = withRecording(createFixtureClient(src), rec);
    const r = await llm.complete({ system: "S", user: "U" }, "outline");
    expect(r.text).toBe('[{"id":"s1"}]');
    expect(readFileSync(join(rec, "outline.txt"), "utf8")).toBe('[{"id":"s1"}]');
    expect(readFileSync(join(rec, "outline.prompt.md"), "utf8")).toMatch(/# system\n\nS\n\n# user\n\nU/);
  });
});

describe("createLlmClient", () => {
  it("缺 key 时给出填写指引", () => {
    expect(() => createLlmClient({})).toThrow(/\.env/);
  });
  it("anthropic 默认型号 claude-opus-5", () => {
    expect(createLlmClient({ LLM_API_KEY: "k" }).model).toBe("claude-opus-5");
    expect(createLlmClient({ LLM_API_KEY: "k", LLM_MODEL: "claude-sonnet-5" }).model).toBe("claude-sonnet-5");
  });
  it("openai-compatible 需要 base url 与型号", () => {
    expect(() => createLlmClient({ LLM_PROVIDER: "openai-compatible", LLM_API_KEY: "k", LLM_MODEL: "m" })).toThrow(/LLM_BASE_URL/);
    expect(createLlmClient({ LLM_PROVIDER: "openai-compatible", LLM_API_KEY: "k", LLM_MODEL: "m", LLM_BASE_URL: "https://x/v1" }).model).toBe("m");
  });
  it("未知供应商报错", () => {
    expect(() => createLlmClient({ LLM_PROVIDER: "foo", LLM_API_KEY: "k" })).toThrow(/未知/);
  });
});
