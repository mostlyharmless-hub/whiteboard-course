import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ingest } from "../../src/generator/ingest";
import { loadGlossary } from "../../src/generator/glossary";
import { createFixtureClient } from "../../src/generator/llm";
import { generate } from "../../src/generator/pipeline";
import { marksPerSection } from "../../src/generator/script";
import { parseScript } from "../../src/shared/schema";

/**
 * 样例课程验收（CLAUDE.md 第 11 节）：用 2026-09-15 qwen3.8-max 的真实响应作为 fixture 离线复现，
 * 校验器 / 换算 / 装配的任何回归都会在这里暴露。
 */
describe("样例课程（qwen3.8-max 录制响应）", () => {
  it("满足全部结构指标", async () => {
    const transcript = ingest(JSON.parse(readFileSync("samples/aigc-career.transcript.json", "utf8")));
    const glossary = loadGlossary("config/glossary.json");
    const r = await generate({ transcript, glossary, llm: createFixtureClient("tests/fixtures/llm/aigc-career-qwen") });

    expect(parseScript(r.script).ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.results.every((s) => s.errors.length === 0 && s.dropped.length === 0)).toBe(true);
    expect(r.script.meta.title).toBe("AIGC职业规划实战课");
    expect(r.script.sections).toHaveLength(7);

    const { actions } = r.script;
    const cards = actions.filter((a) => a.type === "board" || a.type === "mermaid");
    expect(cards.length).toBeGreaterThanOrEqual(8);
    expect(actions.filter((a) => a.type === "new_page").length).toBeGreaterThanOrEqual(3);
    expect(actions.some((a) => a.type === "mermaid")).toBe(true);
    for (const s of r.script.sections) {
      expect(cards.some((c) => c.at >= s.begin_ms && c.at <= s.end_ms), `小节 ${s.id} 没有卡片`).toBe(true);
    }
    const byId = new Map(transcript.paragraphs.map((p) => [p.paragraph_id, p]));
    for (const a of actions) {
      expect(a.at).toBeGreaterThanOrEqual(0);
      expect(a.at).toBeLessThanOrEqual(transcript.duration_ms);
      if (a.type === "board") expect(a.at + a.reveal_ms, `卡片 ${a.card_id} 超出段落`).toBeLessThanOrEqual(byId.get(a.anchor.paragraph_id)!.end_time);
    }
    for (let i = 1; i < actions.length; i++) expect(actions[i]!.at).toBeGreaterThanOrEqual(actions[i - 1]!.at);
  });

  it("每节标注上限按节数分摊", () => {
    expect(marksPerSection(1)).toBe(2);
    expect(marksPerSection(4)).toBe(2);
    expect(marksPerSection(7)).toBe(1);
    expect(marksPerSection(20)).toBe(1);
  });
});
