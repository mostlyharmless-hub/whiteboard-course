import { describe, expect, it } from "vitest";
import { paragraphAt, sectionAt } from "../../src/shared/lookup";

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

describe("sectionAt", () => {
  it("返回最后一个 begin_ms <= t 的小节", () => {
    expect(sectionAt(sections, 500)).toBeNull();
    expect(sectionAt(sections, 1000)?.id).toBe("s1");
    expect(sectionAt(sections, 2200)?.id).toBe("s1");
    expect(sectionAt(sections, 2500)?.id).toBe("s2");
    expect(sectionAt(sections, 9999)?.id).toBe("s2");
  });
});
