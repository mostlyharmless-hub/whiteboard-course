import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ingest } from "../../src/generator/ingest";
import { loadGlossary } from "../../src/generator/glossary";
import { createFixtureClient } from "../../src/generator/llm";
import { chunkParagraphs, outlineIssues } from "../../src/generator/outline";
import { generate } from "../../src/generator/pipeline";
import { renderReport } from "../../src/generator/report";
import { parseScript } from "../../src/shared/schema";

const transcript = () => ingest(JSON.parse(readFileSync("tests/fixtures/mini.transcript.json", "utf8")));
const glossary = loadGlossary("config/glossary.json");
const now = () => new Date("2026-09-15T00:00:00Z");

describe("generate（fixture 冒充 LLM）", () => {
  it("大纲 + 两节：第 1 节打回 1 轮后通过，脚本通过 parseScript", async () => {
    const log: string[] = [];
    const r = await generate({ transcript: transcript(), glossary, llm: createFixtureClient("tests/fixtures/llm/mini"), onProgress: (m) => log.push(m), now });
    expect(parseScript(r.script).ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.script.meta).toMatchObject({ title: "三个要点", duration_ms: 20000, source_track_id: "mini", model: "fixture", generated_at: "2026-09-15T00:00:00.000Z" });
    expect(r.script.sections.map((s) => [s.id, s.begin_ms, s.end_ms])).toEqual([
      ["s1", 0, 10000],
      ["s2", 10000, 20000],
    ]);
    expect(r.results[0]).toMatchObject({ rounds: 1, errors: [], dropped: [] });
    expect(r.results[1]).toMatchObject({ rounds: 0, errors: [] });
    expect(r.usage.calls).toBe(4);
    expect(log.some((m) => /\[s1\] 校验未通过/.test(m))).toBe(true);

    const types = r.script.actions.map((a) => a.type);
    expect(types).toEqual(["new_page", "board", "board", "new_column", "mermaid", "board", "circle"]);
    expect(r.script.actions.map((a) => a.id)).toEqual(["a001", "a002", "a003", "a004", "a005", "a006", "a007"]);
    const cards = r.script.actions.filter((a) => a.type === "board" || a.type === "mermaid").map((a) => a.card_id);
    expect(cards).toEqual(["c01", "c02", "c03", "c04"]);
    const circle = r.script.actions[6];
    expect(circle).toMatchObject({ type: "circle", target_card_id: "c04", at: expect.any(Number) as number, until: 20000 });
    for (let i = 1; i < r.script.actions.length; i++) expect(r.script.actions[i]!.at).toBeGreaterThanOrEqual(r.script.actions[i - 1]!.at);

    const report = renderReport(r, { source: "mini", out: "out/mini.script.json" });
    expect(report).toMatch(/error 0/);
    expect(report).toMatch(/\| s1 \| 三个要点 \| 10 \| 2 \| 0 \| 5 \| 1 \|/);
  });

  it("两轮修正仍失败 → 丢弃出错动作并记 error；非 JSON 输出走打回", async () => {
    const r = await generate({ transcript: transcript(), glossary, llm: createFixtureClient("tests/fixtures/llm/mini-fail"), now });
    expect(parseScript(r.script).ok).toBe(true);
    const s1 = r.results[0]!;
    expect(s1.rounds).toBe(2);
    expect(s1.dropped).toHaveLength(1);
    expect(s1.errors.join()).toMatch(/超过上限 140/);
    expect(s1.actions.map((a) => a.type)).toEqual(["new_page", "board"]);
    const s2 = r.results[1]!;
    expect(s2.rounds).toBe(1);
    expect(s2.errors).toEqual([]);
    expect(r.usage.calls).toBe(1 + 3 + 2);
    const report = renderReport(r, { source: "mini", out: "out/mini.script.json" });
    expect(report).toMatch(/## 被丢弃的动作\n\n- \[s1\]/);
    expect(report).toMatch(/\*\*error 2，/);
  });
});

describe("outline 辅助", () => {
  it("连续覆盖检查", () => {
    const ps = transcript().paragraphs;
    expect(outlineIssues({ title: "t", sections: [{ id: "s1", title: "a", intent: "", paragraph_ids: ["p1", "p2"] }] }, ps)).toEqual([]);
    expect(outlineIssues({ title: "t", sections: [{ id: "s1", title: "a", intent: "", paragraph_ids: ["p2"] }] }, ps).join()).toMatch(/覆盖/);
    expect(outlineIssues({ title: "一二三四五六七八九十一二三四五六七", sections: [{ id: "s1", title: "a", intent: "", paragraph_ids: ["p1", "p2"] }] }, ps).join()).toMatch(/16 字/);
  });
  it("按字数分块，不拆段", () => {
    const ps = transcript().paragraphs;
    expect(chunkParagraphs(ps, 8000)).toHaveLength(1);
    expect(chunkParagraphs(ps, 10).map((c) => c.length)).toEqual([1, 1]);
  });
});
