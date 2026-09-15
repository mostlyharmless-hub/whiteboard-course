import { describe, expect, it } from "vitest";
import type { Action } from "../../src/shared/schema";
import { activeMarks, apply, countApplied, initialState, revealProgress, stateAt } from "../../src/shared/reducer";

const anchor = { paragraph_id: "p1", quote: "q" };
const actions: Action[] = [
  { id: "a1", type: "new_page", title: "P1", at: 0, anchor },
  { id: "a2", type: "board", card_id: "c1", content: "# A", reveal_ms: 1000, at: 1000, anchor },
  { id: "a3", type: "new_column", at: 2000, anchor },
  { id: "a4", type: "mermaid", card_id: "c2", code: "flowchart LR\n A-->B", reveal_ms: 800, at: 2500, anchor },
  { id: "a5", type: "highlight", target_card_id: "c1", snippet: "A", at: 3000, until: 5000, anchor },
  { id: "a6", type: "circle", target_card_id: "c2", snippet: "B", at: 3500, until: 9000, anchor },
  { id: "a7", type: "new_page", title: "P2", at: 6000, anchor },
  { id: "a8", type: "board", card_id: "c3", content: "B", reveal_ms: 600, at: 6500, anchor },
];

describe("apply", () => {
  it("new_page 隐含第一栏；board 落在当前栏", () => {
    let s = apply(initialState, actions[0]!);
    expect(s.pages).toHaveLength(1);
    expect(s.pages[0]!.title).toBe("P1");
    expect(s.currentPage).toBe(0);
    expect(s.currentColumn).toBe(0);
    expect(s.applied).toBe(1);
    s = apply(s, actions[1]!);
    expect(s.pages[0]!.columns[0]!.cards).toEqual(["c1"]);
    expect(s.cards["c1"]).toMatchObject({ kind: "board", page: 0, column: 0, at: 1000, reveal_ms: 1000, content: "# A" });
  });
  it("new_column 后卡片落在新栏", () => {
    const s = actions.slice(0, 4).reduce(apply, initialState);
    expect(s.pages[0]!.columns).toHaveLength(2);
    expect(s.pages[0]!.columns[1]!.cards).toEqual(["c2"]);
    expect(s.cards["c2"]).toMatchObject({ kind: "mermaid", column: 1, content: "flowchart LR\n A-->B" });
    expect(s.cards["c2"]!.title).toBeUndefined();
  });
  it("mermaid 的 title 会保留", () => {
    const withTitle: Action = { id: "ax", type: "mermaid", card_id: "cx", title: "图", code: "graph LR\nA-->B", reveal_ms: 800, at: 100, anchor };
    const s = apply(apply(initialState, actions[0]!), withTitle);
    expect(s.cards["cx"]!.title).toBe("图");
  });
  it("标注进入 marks 并记录所在页；翻页清空 marks", () => {
    const s6 = actions.slice(0, 6).reduce(apply, initialState);
    expect(s6.marks.map((m) => m.id)).toEqual(["a5", "a6"]);
    expect(s6.marks[0]).toMatchObject({ kind: "highlight", target_card_id: "c1", snippet: "A", at: 3000, until: 5000, page: 0 });
    const s7 = apply(s6, actions[6]!);
    expect(s7.marks).toEqual([]);
    expect(s7.currentPage).toBe(1);
    expect(s7.currentColumn).toBe(0);
  });
  it("无页面时写卡片 / 分栏抛错并指出动作 id", () => {
    expect(() => apply(initialState, actions[1]!)).toThrow(/a2/);
    expect(() => apply(initialState, actions[2]!)).toThrow(/a3/);
  });
  it("标注不存在的卡片抛错", () => {
    const s = apply(initialState, actions[0]!);
    expect(() => apply(s, actions[4]!)).toThrow(/c1/);
  });
  it("不修改输入状态", () => {
    const s0 = apply(initialState, actions[0]!);
    const frozen = structuredClone(s0);
    apply(s0, actions[1]!);
    expect(s0).toEqual(frozen);
  });
});

describe("countApplied / stateAt", () => {
  it("countApplied 是 at <= t 的动作数", () => {
    expect(countApplied(actions, -1)).toBe(0);
    expect(countApplied(actions, 0)).toBe(1);
    expect(countApplied(actions, 2500)).toBe(4);
    expect(countApplied(actions, 99999)).toBe(8);
    expect(countApplied([], 5)).toBe(0);
  });
  it("任意 t 下 stateAt 与逐步应用一致", () => {
    for (const t of [0, 999, 1000, 2600, 3200, 5999, 6000, 7000]) {
      const n = countApplied(actions, t);
      const stepwise = actions.slice(0, n).reduce(apply, initialState);
      const expected = { ...stepwise, marks: stepwise.marks.filter((m) => m.until > t) };
      expect(stateAt(actions, t)).toEqual(expected);
    }
  });
  it("活动标注随 until 消失", () => {
    expect(activeMarks(stateAt(actions, 3600).marks, 3600).map((m) => m.id)).toEqual(["a5", "a6"]);
    expect(activeMarks(stateAt(actions, 5000).marks, 5000).map((m) => m.id)).toEqual(["a6"]);
    expect(stateAt(actions, 5000).marks.map((m) => m.id)).toEqual(["a6"]);
  });
  it("后退重算与前进一致", () => {
    const forward = stateAt(actions, 7000);
    const back = stateAt(actions, 2600);
    expect(back.applied).toBe(4);
    expect(forward.applied).toBe(8);
    expect(stateAt(actions, 7000)).toEqual(forward);
  });
});

describe("revealProgress", () => {
  it("按 (t - at) / reveal_ms 钳在 [0, 1]", () => {
    const s = stateAt(actions, 1500);
    const c = s.cards["c1"]!;
    expect(revealProgress(c, 900)).toBe(0);
    expect(revealProgress(c, 1500)).toBe(0.5);
    expect(revealProgress(c, 5000)).toBe(1);
  });
});
