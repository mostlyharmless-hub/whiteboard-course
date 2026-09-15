import { describe, expect, it } from "vitest";
import { parseScript, validateSemantics, type BoardScript } from "../../src/shared/schema";

const P = (id: string, begin: number, end: number) => ({ paragraph_id: id, text: `段落${id}`, begin_time: begin, end_time: end });
const anchor = { paragraph_id: "p1", quote: "段落p1" };

export function baseScript(): BoardScript {
  return {
    version: "1.0",
    meta: { title: "测试", duration_ms: 20000, generated_at: "2026-09-15T00:00:00Z", model: "fixture" },
    paragraphs: [P("p1", 0, 10000), P("p2", 10000, 20000)],
    sections: [
      { id: "s1", title: "一", intent: "x", paragraph_ids: ["p1"], begin_ms: 0, end_ms: 10000 },
      { id: "s2", title: "二", intent: "y", paragraph_ids: ["p2"], begin_ms: 10000, end_ms: 20000 },
    ],
    actions: [
      { id: "a001", type: "new_page", title: "首页", at: 0, anchor },
      { id: "a002", type: "board", card_id: "c01", content: "# 标题", reveal_ms: 600, at: 1000, anchor },
      { id: "a003", type: "highlight", target_card_id: "c01", snippet: "标题", at: 2000, until: 5000, anchor },
    ],
  };
}

const messages = (s: BoardScript) => validateSemantics(s).map((i) => i.message).join("\n");

describe("parseScript", () => {
  it("接受合法脚本", () => {
    const r = parseScript(baseScript());
    expect(r.ok).toBe(true);
  });
  it("拒绝 version 不为 1.0", () => {
    const r = parseScript({ ...baseScript(), version: "2.0" });
    expect(r.ok).toBe(false);
  });
  it("拒绝未知 action type，并指出动作下标", () => {
    const s = baseScript();
    s.actions.push({ id: "a004", type: "explode", at: 3000, anchor } as unknown as BoardScript["actions"][number]);
    const r = parseScript(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.path[0] === "actions" && i.path[1] === 3)).toBe(true);
  });
  it("页标题超过 16 字被拒绝", () => {
    const s = baseScript();
    (s.actions[0] as { title: string }).title = "一二三四五六七八九十一二三四五六七";
    expect(parseScript(s).ok).toBe(false);
  });
  it("语义错误也通过 parseScript 报出", () => {
    const s = baseScript();
    s.actions.shift();
    const r = parseScript(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.message).toMatch(/new_page/);
  });
});

describe("validateSemantics", () => {
  it("actions[0] 必须是 new_page", () => {
    const s = baseScript();
    s.actions.shift();
    const issues = validateSemantics(s);
    expect(issues.some((i) => i.path[0] === "actions" && i.path[1] === 0)).toBe(true);
  });
  it("at 必须单调不减", () => {
    const s = baseScript();
    s.actions[2]!.at = 500;
    expect(messages(s)).toMatch(/单调/);
  });
  it("at 不得超出 duration_ms", () => {
    const s = baseScript();
    s.actions[2]!.at = 99999;
    (s.actions[2] as { until: number }).until = 100000;
    expect(messages(s)).toMatch(/duration/);
  });
  it("until 必须大于 at", () => {
    const s = baseScript();
    (s.actions[2] as { until: number }).until = 2000;
    expect(messages(s)).toMatch(/until/);
  });
  it("target_card_id 必须指向已出现的卡片", () => {
    const s = baseScript();
    (s.actions[2] as { target_card_id: string }).target_card_id = "c99";
    expect(messages(s)).toMatch(/c99/);
  });
  it("不得跨页标注", () => {
    const s = baseScript();
    s.actions.splice(2, 0, { id: "a00x", type: "new_page", title: "第二页", at: 1500, anchor });
    expect(messages(s)).toMatch(/跨页/);
  });
  it("card_id 不得重复", () => {
    const s = baseScript();
    s.actions.push({ id: "a004", type: "board", card_id: "c01", content: "x", reveal_ms: 600, at: 6000, anchor });
    expect(messages(s)).toMatch(/c01/);
  });
  it("anchor.paragraph_id 必须存在", () => {
    const s = baseScript();
    s.actions[1]!.anchor = { paragraph_id: "nope", quote: "x" };
    expect(messages(s)).toMatch(/nope/);
  });
  it("sections 必须连续且恰好覆盖全部段落", () => {
    const s = baseScript();
    s.sections[1]!.paragraph_ids = [];
    expect(validateSemantics(s).some((i) => i.path[0] === "sections")).toBe(true);
    const s2 = baseScript();
    s2.sections[0]!.paragraph_ids = ["p2"];
    s2.sections[1]!.paragraph_ids = ["p1"];
    expect(validateSemantics(s2).some((i) => i.path[0] === "sections")).toBe(true);
  });
  it("section 的 begin_ms / end_ms 必须与首末段一致", () => {
    const s = baseScript();
    s.sections[0]!.end_ms = 9000;
    expect(messages(s)).toMatch(/end_ms/);
  });
  it("合法脚本无问题", () => {
    expect(validateSemantics(baseScript())).toEqual([]);
  });
});
