import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Action, BoardScript } from "../../src/shared/schema";
import { parseScript } from "../../src/shared/schema";
import { PRE_SPEECH_LEAD_MS, emptyBoardIntervals, ensureBoardNotEmpty, totalEmptyMs } from "../../src/generator/timeline";

const paragraphs = [
  { paragraph_id: "p1", text: "一".repeat(20), begin_time: 10000, end_time: 30000 },
  { paragraph_id: "p2", text: "二".repeat(20), begin_time: 30500, end_time: 50000 },
  { paragraph_id: "p3", text: "三".repeat(20), begin_time: 56000, end_time: 70000 },
];
const a = (id: string, paragraph_id: string) => ({ paragraph_id, quote: id });

const actions: Action[] = [
  { id: "a001", type: "new_page", title: "一", at: 10000, anchor: a("q", "p1") },
  { id: "a002", type: "board", card_id: "c01", content: "x", reveal_ms: 1000, at: 16000, anchor: a("q", "p1") },
  { id: "a003", type: "highlight", target_card_id: "c01", snippet: "x", at: 20000, until: 30000, anchor: a("q", "p1") },
  { id: "a004", type: "new_page", title: "二", at: 30500, anchor: a("q", "p2") },
  { id: "a005", type: "new_column", at: 35000, anchor: a("q", "p2") },
  { id: "a006", type: "mermaid", card_id: "c02", code: "flowchart LR\nA-->B", reveal_ms: 800, at: 38000, anchor: a("q", "p2") },
  { id: "a007", type: "board", card_id: "c03", content: "y", reveal_ms: 600, at: 45000, anchor: a("q", "p2") },
  { id: "a008", type: "new_page", title: "三", at: 56000, anchor: a("q", "p3") },
  { id: "a009", type: "board", card_id: "c04", content: "z", reveal_ms: 600, at: 60000, anchor: a("q", "p3") },
];

describe("emptyBoardIntervals", () => {
  it("找出有语音但当前页没有卡片的区间", () => {
    const empty = emptyBoardIntervals(actions, paragraphs);
    expect(empty).toEqual([
      { paragraph_id: "p1", from: 10000, to: 16000 },
      { paragraph_id: "p2", from: 30500, to: 38000 },
      { paragraph_id: "p3", from: 56000, to: 60000 },
    ]);
    expect(totalEmptyMs(empty)).toBe(6000 + 7500 + 4000);
  });
});

describe("ensureBoardNotEmpty", () => {
  const fixed = ensureBoardNotEmpty(actions, paragraphs);
  it("不修改输入", () => {
    expect(actions[1]!.at).toBe(16000);
  });
  it("首页提前 2 秒进入静默；第一张卡随翻页落笔", () => {
    expect(fixed.actions[0]!.at).toBe(10000 - PRE_SPEECH_LEAD_MS);
    expect(fixed.actions[1]!.at).toBe(10000 - PRE_SPEECH_LEAD_MS);
    expect(fixed.actions[2]!.at).toBe(20000);
  });
  it("上一段刚结束时翻页只能提前到上一段结束；分栏与第一张卡一起提前，之后的卡不动", () => {
    expect(fixed.actions[3]!.at).toBe(30000);
    expect(fixed.actions[4]!.at).toBe(30000);
    expect(fixed.actions[5]!.at).toBe(30000);
    expect(fixed.actions[6]!.at).toBe(45000);
  });
  it("有足够静默时提前满 2 秒", () => {
    expect(fixed.actions[7]!.at).toBe(56000 - PRE_SPEECH_LEAD_MS);
    expect(fixed.actions[8]!.at).toBe(56000 - PRE_SPEECH_LEAD_MS);
  });
  it("修正后有语音无板书为 0，且 at 单调、记录了修改", () => {
    expect(totalEmptyMs(emptyBoardIntervals(fixed.actions, paragraphs))).toBe(0);
    for (let i = 1; i < fixed.actions.length; i++) expect(fixed.actions[i]!.at).toBeGreaterThanOrEqual(fixed.actions[i - 1]!.at);
    expect(fixed.changes.length).toBe(7);
  });
  it("锚在段中间的翻页不提前（不打断上一句）", () => {
    const mid: Action[] = [
      { id: "a001", type: "new_page", title: "一", at: 10000, anchor: a("q", "p1") },
      { id: "a002", type: "board", card_id: "c01", content: "x", reveal_ms: 1000, at: 10000, anchor: a("q", "p1") },
      { id: "a003", type: "new_page", title: "中", at: 20000, anchor: a("q", "p1") },
      { id: "a004", type: "board", card_id: "c02", content: "y", reveal_ms: 1000, at: 22000, anchor: a("q", "p1") },
    ];
    const r = ensureBoardNotEmpty(mid, paragraphs);
    expect(r.actions[2]!.at).toBe(20000);
    expect(r.actions[3]!.at).toBe(20000);
  });
  it("套用到 demo fixture 后仍通过 parseScript 且空板为 0", () => {
    const demo = JSON.parse(readFileSync("tests/fixtures/demo.script.json", "utf8")) as BoardScript;
    const r = ensureBoardNotEmpty(demo.actions, demo.paragraphs);
    expect(parseScript({ ...demo, actions: r.actions }).ok).toBe(true);
    expect(totalEmptyMs(emptyBoardIntervals(r.actions, demo.paragraphs))).toBe(0);
  });
});
