import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseScript } from "../../src/shared/schema";

for (const name of ["minimal", "demo"]) {
  describe(`fixtures/${name}.script.json`, () => {
    it("通过 parseScript", () => {
      const json: unknown = JSON.parse(readFileSync(`tests/fixtures/${name}.script.json`, "utf8"));
      const r = parseScript(json);
      if (!r.ok) console.error(r.issues);
      expect(r.ok).toBe(true);
    });
  });
}

describe("minimal 覆盖全部 6 种动作", () => {
  it("每种一条", () => {
    const json = JSON.parse(readFileSync("tests/fixtures/minimal.script.json", "utf8")) as { actions: { type: string }[] };
    expect(json.actions.map((a) => a.type).sort()).toEqual(["board", "circle", "highlight", "mermaid", "new_column", "new_page"]);
  });
});

describe("demo 满足样例验收的结构指标", () => {
  it("≥ 8 张卡片、≥ 3 页、≥ 1 张 Mermaid、每节至少 1 张卡片", () => {
    const json = JSON.parse(readFileSync("tests/fixtures/demo.script.json", "utf8")) as {
      sections: { begin_ms: number; end_ms: number }[];
      actions: { type: string; at: number }[];
    };
    const cards = json.actions.filter((a) => a.type === "board" || a.type === "mermaid");
    expect(cards.length).toBeGreaterThanOrEqual(8);
    expect(json.actions.filter((a) => a.type === "new_page").length).toBeGreaterThanOrEqual(3);
    expect(json.actions.some((a) => a.type === "mermaid")).toBe(true);
    for (const s of json.sections) {
      expect(cards.some((c) => c.at >= s.begin_ms && c.at <= s.end_ms)).toBe(true);
    }
  });
});
