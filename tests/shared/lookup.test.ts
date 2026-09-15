import { describe, expect, it } from "vitest";
import { paragraphAt, sectionAt, sentenceAt } from "../../src/shared/lookup";

const paragraphs = [
  { paragraph_id: "p1", text: "a", begin_time: 1000, end_time: 2000 },
  { paragraph_id: "p2", text: "b", begin_time: 2500, end_time: 3000 },
];
const sections = [
  { id: "s1", title: "一", intent: "", paragraph_ids: ["p1"], begin_ms: 1000, end_ms: 2000 },
  { id: "s2", title: "二", intent: "", paragraph_ids: ["p2"], begin_ms: 2500, end_ms: 3000 },
];

describe("paragraphAt", () => {
  it("落在段内返回该段，间隙返回 null，首段前返回 null", () => {
    expect(paragraphAt(paragraphs, 500)).toBeNull();
    expect(paragraphAt(paragraphs, 1000)?.paragraph_id).toBe("p1");
    expect(paragraphAt(paragraphs, 1999)?.paragraph_id).toBe("p1");
    expect(paragraphAt(paragraphs, 2200)).toBeNull();
    expect(paragraphAt(paragraphs, 2999)?.paragraph_id).toBe("p2");
    expect(paragraphAt(paragraphs, 3000)).toBeNull();
    expect(paragraphAt([], 3000)).toBeNull();
  });
});

describe("sentenceAt", () => {
  // 20 字，1000 → 3000 ms，每字 100 ms
  const p = { paragraph_id: "p", text: "第一句话在这里。第二句更长一些！第三句？", begin_time: 1000, end_time: 3000 };
  it("按字符位置线性插值取当前句", () => {
    expect(sentenceAt(p, 1000)).toBe("第一句话在这里。");
    expect(sentenceAt(p, 1700)).toBe("第一句话在这里。");
    expect(sentenceAt(p, 1800)).toBe("第二句更长一些！");
    expect(sentenceAt(p, 2950)).toBe("第三句？");
  });
  it("段外返回 null", () => {
    expect(sentenceAt(p, 999)).toBeNull();
    expect(sentenceAt(p, 3000)).toBeNull();
  });
  it("无句末标点时返回整段", () => {
    expect(sentenceAt({ ...p, text: "没有标点的一段" }, 2000)).toBe("没有标点的一段");
  });
});

describe("sectionAt", () => {
  it("返回最后一个 begin_ms <= t 的小节", () => {
    expect(sectionAt(sections, 500)).toBeNull();
    expect(sectionAt(sections, 1000)?.id).toBe("s1");
    expect(sectionAt(sections, 2200)?.id).toBe("s1");
    expect(sectionAt(sections, 2500)?.id).toBe("s2");
    expect(sectionAt(sections, 9999)?.id).toBe("s2");
  });
});
