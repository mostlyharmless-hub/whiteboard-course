import { describe, expect, it } from "vitest";
import { assemble, boardStateSummary, initialLayout, stepLayout, summarizeCard } from "../../src/generator/assemble";
import type { LocalAction, SectionResult } from "../../src/generator/types";

const anchor = { paragraph_id: "p1", quote: "q" };
const section = (id: string): SectionResult["section"] => ({ id, title: id, intent: "", paragraph_ids: ["p1"], begin_ms: 0, end_ms: 1 });
const result = (id: string, actions: LocalAction[]): SectionResult => ({ section: section(id), actions, warnings: [], errors: [], dropped: [], rounds: 0 });

describe("stepLayout / boardStateSummary", () => {
  it("模拟页、栏、卡片", () => {
    let l = initialLayout;
    expect(boardStateSummary(l)).toMatch(/尚无页面/);
    l = stepLayout(l, { type: "new_page", title: "P", at: 0, anchor });
    l = stepLayout(l, { type: "board", card_id: "c01", content: "# 标题一\n正文", reveal_ms: 600, at: 0, anchor });
    l = stepLayout(l, { type: "new_column", at: 0, anchor });
    l = stepLayout(l, { type: "mermaid", card_id: "c02", title: "图", code: "flowchart LR\nA-->B", reveal_ms: 800, at: 0, anchor });
    expect(l).toMatchObject({ hasPage: true, columns: 2, cardsInColumn: 1 });
    expect(l.pageCards).toEqual([
      { id: "c01", summary: "标题一" },
      { id: "c02", summary: "流程图「图」" },
    ]);
    const s = boardStateSummary(l);
    expect(s).toMatch(/2 栏/);
    expect(s).toMatch(/c01：标题一/);
    expect(stepLayout(l, { type: "new_page", title: "P2", at: 0, anchor }).pageCards).toEqual([]);
  });
  it("摘要截断到 40 字", () => {
    expect(summarizeCard({ type: "board", card_id: "c", content: "一".repeat(50), reveal_ms: 600, at: 0, anchor })).toHaveLength(41);
  });
});

describe("assemble", () => {
  it("全局编号 a001… / c01…，节内 target_card_id 映射为全局 id", () => {
    const actions = assemble([
      result("s1", [
        { type: "new_page", title: "P1", at: 0, anchor },
        { type: "board", card_id: "c1", content: "x", reveal_ms: 600, at: 100, anchor },
        { type: "highlight", target_card_id: "c1", snippet: "x", at: 200, until: 2000, anchor },
      ]),
      result("s2", [
        { type: "board", card_id: "c1", content: "y", reveal_ms: 600, at: 300, anchor },
        { type: "circle", target_card_id: "c1", snippet: "y", at: 400, until: 2000, anchor },
      ]),
    ]);
    expect(actions.map((a) => a.id)).toEqual(["a001", "a002", "a003", "a004", "a005"]);
    expect(actions[1]).toMatchObject({ card_id: "c01" });
    expect(actions[2]).toMatchObject({ target_card_id: "c01" });
    expect(actions[3]).toMatchObject({ card_id: "c02" });
    expect(actions[4]).toMatchObject({ target_card_id: "c02" });
  });
});
