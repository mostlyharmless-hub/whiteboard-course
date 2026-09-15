import { describe, expect, it } from "vitest";
import type { Paragraph } from "../../src/shared/schema";
import { countChars, plainText } from "../../src/shared/budget";
import { LEAD_MS, locate, resolveAt, resolveSection, revealMs, untilMs } from "../../src/generator/resolve";

const p1: Paragraph = {
  paragraph_id: "p1",
  text: "大家好，本节课程将系统讲解如何借助aig c工具高效制定职业规划。我们将聚焦三大核心环节，岗位信息智能采集、核心能力AI分析、行业背景挖掘。通过引导RPA deep seek等工具实战演示，帮助大家掌握科学求职方法论。",
  begin_time: 10080,
  end_time: 32588,
};
const p2: Paragraph = { paragraph_id: "p2", text: "按住CTR再点击要采集的数据元素，再点击捕获相似元素。", begin_time: 40000, end_time: 50000 };
const byId = new Map([p1, p2].map((p) => [p.paragraph_id, p]));

describe("locate", () => {
  it("精确匹配", () => {
    expect(locate(p1.text, "我们将聚焦三大核心环节")).toEqual({ index: p1.text.indexOf("我们将聚焦"), exact: true });
  });
  it("去标点空白后模糊匹配，返回原文下标", () => {
    expect(locate(p2.text, "按住 CTR，再点击要采集")).toEqual({ index: 0, exact: false });
    expect(locate(p2.text, "再点击捕获相似元素。")).toEqual({ index: p2.text.indexOf("再点击捕获"), exact: true });
    expect(locate(p2.text, "点击捕获相似元素")?.index).toBe(p2.text.indexOf("点击捕获"));
  });
  it("匹配失败返回 null；只有标点的引用返回 null", () => {
    expect(locate(p1.text, "这句话不存在")).toBeNull();
    expect(locate(p1.text, "，。")).toBeNull();
  });
});

describe("resolveAt", () => {
  it("按字符位置线性插值并提前 LEAD_MS（§5.5 的 c01）", () => {
    const quote = "我们将聚焦三大核心环节";
    const idx = p1.text.indexOf(quote);
    const expected = Math.round(p1.begin_time + (idx / p1.text.length) * (p1.end_time - p1.begin_time) - LEAD_MS);
    expect(resolveAt({ paragraph_id: "p1", quote }, { paragraphById: byId, prevAt: -1 })).toEqual({ at: expected });
    expect(expected).toBeGreaterThan(16000);
    expect(expected).toBeLessThan(17000);
  });
  it("段首引用减 LEAD_MS 后钳到 begin_time", () => {
    expect(resolveAt({ paragraph_id: "p1", quote: "大家好，本节课程" }, { paragraphById: byId, prevAt: -1 })).toEqual({ at: 10080 });
  });
  it("不早于前一动作；相同时刻 +200", () => {
    expect(resolveAt({ paragraph_id: "p1", quote: "大家好，本节课程" }, { paragraphById: byId, prevAt: 20000 }).at).toBe(20200);
    expect(resolveAt({ paragraph_id: "p1", quote: "大家好，本节课程" }, { paragraphById: byId, prevAt: 10080 }).at).toBe(10280);
  });
  it("引用找不到：按段首处理并给出警告", () => {
    const r = resolveAt({ paragraph_id: "p1", quote: "不存在的引用" }, { paragraphById: byId, prevAt: -1 });
    expect(r.at).toBe(10080);
    expect(r.warning).toMatch(/未在段落/);
  });
  it("段落不存在抛错", () => {
    expect(() => resolveAt({ paragraph_id: "nope", quote: "x" }, { paragraphById: byId, prevAt: -1 })).toThrow(/nope/);
  });
});

describe("revealMs / untilMs", () => {
  it("board 按纯文本字数 × 60，下限 600", () => {
    expect(revealMs("board", "# 标题\n\n1. 一二三", 10080, p1)).toBe(600);
  });
  it("上限 8000", () => {
    expect(revealMs("board", "一".repeat(200), 10080, p1)).toBe(8000);
  });
  it("不超过段落剩余时长", () => {
    expect(revealMs("board", "一".repeat(50), p1.end_time - 1000, p1)).toBe(1000);
    expect(revealMs("board", "一".repeat(50), p1.end_time - 100, p1)).toBe(600);
  });
  it("§5.5 的 c01 ≈ 2460", () => {
    const content = "# AIGC 助力职业规划\n\n**三大核心环节**\n1. 岗位信息智能采集\n2. 核心能力 AI 分析\n3. 行业背景挖掘\n\n工具：RPA · DeepSeek";
    expect(revealMs("board", content, 16388, p1)).toBe(countChars(plainText(content)) * 60);
  });
  it("mermaid 固定 800", () => {
    expect(revealMs("mermaid", "flowchart LR\nA-->B", 0, p1)).toBe(800);
  });
  it("until = 段落 end_time，且不早于 at + 1500", () => {
    expect(untilMs(20000, p1)).toBe(32588);
    expect(untilMs(32000, p1)).toBe(33500);
  });
});

describe("resolveSection", () => {
  it("逐条换算并保持单调；锚点段落不存在的动作占位并记错", () => {
    const r = resolveSection(
      [
        { type: "new_page", title: "P", anchor: { paragraph_id: "p1", quote: "大家好，本节课程" } },
        { type: "board", card_id: "c1", content: "# 标题", anchor: { paragraph_id: "p1", quote: "我们将聚焦三大核心环节" } },
        { type: "highlight", target_card_id: "c1", snippet: "标题", anchor: { paragraph_id: "nope", quote: "x" } },
        { type: "circle", target_card_id: "c1", snippet: "标题", anchor: { paragraph_id: "p2", quote: "按住CTR" } },
      ],
      { paragraphById: byId, prevAt: -1 },
    );
    expect(r.actions.map((a) => a.type)).toEqual(["new_page", "board", "highlight", "circle"]);
    expect(r.actions[0]!.at).toBe(10080);
    expect(r.actions[1]).toMatchObject({ reveal_ms: 600 });
    expect(r.errors).toEqual([{ index: 2, message: expect.stringMatching(/nope/) as string }]);
    expect(r.actions[2]!.at).toBe(r.actions[1]!.at);
    expect(r.actions[3]).toMatchObject({ at: 40000, until: 50000 });
    expect(r.lastAt).toBe(40000);
    for (let i = 1; i < r.actions.length; i++) expect(r.actions[i]!.at).toBeGreaterThanOrEqual(r.actions[i - 1]!.at);
  });
});
