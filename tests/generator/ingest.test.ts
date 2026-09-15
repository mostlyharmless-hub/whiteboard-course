import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ingest } from "../../src/generator/ingest";
import { formatGlossary, loadGlossary } from "../../src/generator/glossary";
import { loadPrompt, render } from "../../src/generator/prompts";

const sample = () => JSON.parse(readFileSync("samples/aigc-career.transcript.json", "utf8")) as unknown;

const mini = (paragraphs: object[]) => ({ code: 200, data: { paragraphs }, track_id: "t" });

describe("ingest", () => {
  it("读取样例：11 段、时长、track_id，去掉 speaker_id", () => {
    const t = ingest(sample());
    expect(t.paragraphs).toHaveLength(11);
    expect(t.duration_ms).toBe(420520);
    expect(t.track_id).toBe("c4ae4ace33b18563f8087dbd6ba6faf6");
    expect(Object.keys(t.paragraphs[0]!).sort()).toEqual(["begin_time", "end_time", "paragraph_id", "text"]);
  });
  it("begin >= end 抛错并指出段落", () => {
    expect(() => ingest(mini([{ text: "a", begin_time: 5, end_time: 5, paragraph_id: "p1" }]))).toThrow(/p1/);
  });
  it("乱序抛错", () => {
    expect(() =>
      ingest(
        mini([
          { text: "a", begin_time: 10, end_time: 20, paragraph_id: "p1" },
          { text: "b", begin_time: 5, end_time: 8, paragraph_id: "p2" },
        ]),
      ),
    ).toThrow(/升序/);
  });
  it("重复 id 与空 text 抛错", () => {
    expect(() =>
      ingest(
        mini([
          { text: "a", begin_time: 0, end_time: 1, paragraph_id: "p1" },
          { text: "b", begin_time: 1, end_time: 2, paragraph_id: "p1" },
        ]),
      ),
    ).toThrow(/重复/);
    expect(() => ingest(mini([{ text: "  ", begin_time: 0, end_time: 1, paragraph_id: "p1" }]))).toThrow(/为空/);
  });
  it("缺少 data.paragraphs 抛错", () => {
    expect(() => ingest({ code: 200 })).toThrow(/格式/);
  });
});

describe("glossary", () => {
  it("加载并格式化", () => {
    const g = loadGlossary("config/glossary.json");
    expect(g.rules.some((r) => r.from === "aig c" && r.to === "AIGC")).toBe(true);
    expect(formatGlossary(g)).toMatch(/`aig c` → AIGC/);
    expect(formatGlossary({ rules: [] })).toBe("（无）");
  });
});

describe("prompts", () => {
  it("三个提示词都能加载且含 system / user 两段", () => {
    for (const name of ["outline", "script", "repair"] as const) {
      const p = loadPrompt(name);
      expect(p.system).toMatch(/JSON/);
      expect(p.user.length).toBeGreaterThan(50);
    }
  });
  it("script 提示词包含全部占位符", () => {
    const p = loadPrompt("script");
    for (const key of ["section_title", "section_intent", "section_seconds", "max_cards", "paragraphs", "glossary", "board_state", "max_marks"]) {
      expect(p.user).toContain(`{{${key}}}`);
    }
  });
  it("render 注入与缺失报错", () => {
    expect(render("a {{x}} b {{y}}", { x: 1, y: "z" })).toBe("a 1 b z");
    expect(() => render("{{missing}}", {})).toThrow(/missing/);
  });
});
