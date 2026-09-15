import { describe, expect, it } from "vitest";
import { initialLayout, type LayoutState } from "../../src/generator/assemble";
import { checkBoard, checkMermaid, dropFailed, maxCardsFor, validateSection, type ValidateCtx } from "../../src/generator/validate";
import type { LocalAction } from "../../src/generator/types";

const anchor = { paragraph_id: "p1", quote: "q" };
const page = (title = "页"): LocalAction => ({ type: "new_page", title, at: 0, anchor });
const col = (): LocalAction => ({ type: "new_column", at: 0, anchor });
const board = (id: string, content = `## ${id}\n- 要点`): LocalAction => ({ type: "board", card_id: id, content, reveal_ms: 600, at: 0, anchor });
const mermaid = (id: string, code: string): LocalAction => ({ type: "mermaid", card_id: id, code, reveal_ms: 800, at: 0, anchor });
const hl = (target: string, snippet: string, until = 2000): LocalAction => ({ type: "highlight", target_card_id: target, snippet, at: 0, until, anchor });

const ctx = (layout: LayoutState = initialLayout, seconds = 120): ValidateCtx => ({
  sectionTitle: "本节标题",
  sectionParagraphIds: new Set(["p1"]),
  sectionSeconds: seconds,
  layout,
});

describe("validateSection 自动修正", () => {
  it("尚无页面时写卡片 → 自动插入 new_page", () => {
    const r = validateSection([board("c1")], ctx());
    expect(r.actions.map((a) => a.type)).toEqual(["new_page", "board"]);
    expect(r.actions[0]).toMatchObject({ type: "new_page", title: "本节标题" });
    expect(r.warnings.join()).toMatch(/new_page/);
    expect(r.errors).toEqual([]);
    expect(r.layout).toMatchObject({ hasPage: true, columns: 1, cardsInColumn: 1 });
  });
  it("第 4 张卡片 → 自动插入 new_column", () => {
    const r = validateSection([page(), board("c1"), board("c2"), board("c3"), board("c4")], ctx());
    expect(r.actions.map((a) => a.type)).toEqual(["new_page", "board", "board", "board", "new_column", "board"]);
    expect(r.layout).toMatchObject({ columns: 2, cardsInColumn: 1 });
  });
  it("第 4 栏 → new_column 改为 new_page；第 3 栏满时第 4 张卡 → 自动翻页", () => {
    const r = validateSection([page(), col(), col(), col()], ctx());
    expect(r.actions.map((a) => a.type)).toEqual(["new_page", "new_column", "new_column", "new_page"]);
    const full: LayoutState = { hasPage: true, columns: 3, cardsInColumn: 3, pageCards: [] };
    const r2 = validateSection([board("c1")], ctx(full));
    expect(r2.actions.map((a) => a.type)).toEqual(["new_page", "board"]);
  });
  it("页标题 / 图标题过长截断；样式行删除", () => {
    const r = validateSection(
      [page("一二三四五六七八九十一二三四五六七八"), mermaid("m1", "flowchart LR\n  A[开始] --> B[结束]\n  style A fill:#f9f")],
      ctx(),
    );
    expect(r.errors).toEqual([]);
    expect((r.actions[0] as { title: string }).title).toHaveLength(16);
    expect((r.actions[1] as { code: string }).code).toBe("flowchart LR\nA[开始] --> B[结束]");
    expect(r.warnings.join("\n")).toMatch(/截断/);
    expect(r.warnings.join("\n")).toMatch(/样式/);
  });
  it("snippet 去标点后匹配保留并警告；第 3 次标注丢弃；until ≤ at 修正", () => {
    const r = validateSection(
      [page(), board("c1", "## 核心：数据 + 能力"), hl("c1", "数据+能力"), hl("c1", "核心", 0), hl("c1", "能力")],
      ctx(),
    );
    expect(r.errors).toEqual([]);
    expect(r.actions.filter((a) => a.type === "highlight")).toHaveLength(2);
    expect((r.actions[3] as { until: number }).until).toBe(1500);
    expect(r.warnings.join("\n")).toMatch(/去掉标点/);
    expect(r.warnings.join("\n")).toMatch(/已丢弃/);
  });
});

describe("validateSection 打回错误", () => {
  it("snippet 不存在 → error，指向输入下标", () => {
    const r = validateSection([page(), board("c1"), hl("c1", "根本没有")], ctx());
    expect(r.errors).toEqual([{ index: 2, message: expect.stringMatching(/根本没有/) as string }]);
  });
  it("target_card_id 不存在 → error", () => {
    const r = validateSection([page(), hl("c9", "x")], ctx());
    expect(r.errors[0]?.message).toMatch(/c9/);
  });
  it("锚点段落不属于本节 → error", () => {
    const r = validateSection([{ ...page(), anchor: { paragraph_id: "p2", quote: "q" } }], ctx());
    expect(r.errors[0]?.message).toMatch(/不属于本节/);
  });
  it("卡片超预算 → error", () => {
    const r = validateSection([page(), board("c1", "一".repeat(150))], ctx());
    expect(r.errors[0]?.message).toMatch(/超过上限 140/);
  });
  it("一级标题不在页首卡片 → error", () => {
    const r = validateSection([page(), board("c1", "# 页首"), board("c2", "# 第二张")], ctx());
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.message).toMatch(/页首/);
  });
  it("Mermaid 节点超过 8 个 → error", () => {
    const code = "flowchart TD\n" + "ABCDEFGHI".split("").map((c, i, arr) => (i < arr.length - 1 ? `  ${c}[${c}] --> ${arr[i + 1]}[${arr[i + 1]}]` : "")).join("\n");
    const r = validateSection([page(), mermaid("m1", code)], ctx());
    expect(r.errors[0]?.message).toMatch(/9 个/);
  });
  it("卡片密度超限 → error", () => {
    expect(maxCardsFor(22)).toBe(3);
    const r = validateSection([page(), board("c1"), board("c2"), board("c3"), col(), board("c4")], ctx(initialLayout, 22));
    expect(r.errors.some((e) => /超过上限 3/.test(e.message))).toBe(true);
  });
});

describe("checkBoard / checkMermaid", () => {
  it("禁止的 Markdown", () => {
    expect(checkBoard("![img](x.png)", true).join()).toMatch(/图片/);
    expect(checkBoard("[链接](http://x)", true).join()).toMatch(/链接/);
    expect(checkBoard("<b>x</b>", true).join()).toMatch(/HTML/);
    expect(checkBoard("```js\nx\n```", true).join()).toMatch(/代码块/);
  });
  it("表格与嵌套上限", () => {
    expect(checkBoard("| a | b | c | d | e |\n|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 |", true).join()).toMatch(/5 列/);
    expect(checkBoard("- a\n  - b\n    - c", true).join()).toMatch(/嵌套/);
    expect(checkBoard("- a\n  - b", true)).toEqual([]);
  });
  it("合法 Mermaid：带边标签、多种节点形状、复用节点", () => {
    const r = checkMermaid("graph LR\n  A[新建 Excel] --> B{循环}\n  B -->|是| C((写入))\n  C --> B\n  B -- 否 --> D[完成]");
    expect(r.ok).toBe(true);
  });
  it("头部不合法 / subgraph / 节点文字过长", () => {
    expect(checkMermaid("sequenceDiagram\nA->>B: hi").ok).toBe(false);
    expect(checkMermaid("flowchart LR\nsubgraph S\nA-->B\nend").ok).toBe(false);
    const long = checkMermaid("flowchart LR\nA[这个节点的文字实在是太长了超过十个字] --> B[短]");
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.error).toMatch(/超过上限 10/);
  });
});

describe("dropFailed", () => {
  it("丢弃出错动作并连带丢弃引用被丢卡片的标注", () => {
    const input = [page(), board("c1"), board("c2"), hl("c1", "c1"), hl("c2", "c2")];
    const r = dropFailed(input, [{ index: 1, message: "bad" }]);
    expect(r.actions.map((a) => (a.type === "board" ? a.card_id : a.type === "highlight" ? `hl:${a.target_card_id}` : a.type))).toEqual(["new_page", "c2", "hl:c2"]);
    expect(r.dropped).toHaveLength(2);
  });
});
