import { describe, expect, it } from "vitest";
import { loadGlossary } from "../../src/generator/glossary";
import { applyGlossary } from "../../src/tts/glossary-apply";
import { GAP_MS, MAX_ATEMPO, buildMixFilter, planPlacement } from "../../src/tts/placement";

describe("applyGlossary", () => {
  it("把 ASR 错误替换为正确写法", () => {
    const g = loadGlossary("config/glossary.json");
    const text = "借助aig c工具，通过引导RPA deep seek等工具，运用n lp技术；第22个指令是到boss直聘，按住CTR再按住CTL，命名为职位描述element。";
    expect(applyGlossary(text, g)).toBe("借助AIGC工具，通过引导 RPA DeepSeek等工具，运用NLP技术；第二个指令是到BOSS 直聘，按住Ctrl再按住Ctrl，命名为职位描述元素。");
  });
  it("空术语表原样返回", () => {
    expect(applyGlossary("abc", { rules: [] })).toBe("abc");
  });
});

const ps = [
  { paragraph_id: "p1", text: "a", begin_time: 1000, end_time: 5000 },
  { paragraph_id: "p2", text: "b", begin_time: 6000, end_time: 9000 },
  { paragraph_id: "p3", text: "c", begin_time: 9000, end_time: 12000 },
];

describe("planPlacement", () => {
  it("放得下：不变速，放在原 begin_time", () => {
    const [a] = planPlacement(ps, [3000, 2000, 2000], 12000);
    expect(a).toMatchObject({ begin_ms: 1000, clip_ms: 3000, available_ms: 6000 - 1000 - GAP_MS, atempo: 1, end_ms: 4000 });
  });
  it("放不下：按比例加速到可用窗口", () => {
    const [, b] = planPlacement(ps, [3000, 3300, 2000], 12000);
    expect(b!.available_ms).toBe(9000 - 6000 - GAP_MS);
    expect(b!.atempo).toBeCloseTo(3300 / 2700, 4);
    expect(b!.end_ms).toBe(6000 + Math.round(3300 / (3300 / 2700)));
  });
  it("最后一段以课程结束为界；加速上限 2×", () => {
    const [, , c] = planPlacement(ps, [3000, 2000, 9000], 12000);
    expect(c!.available_ms).toBe(12000 - 9000 - GAP_MS);
    expect(c!.atempo).toBe(MAX_ATEMPO);
  });
});

describe("buildMixFilter", () => {
  it("每路 adelay（需要时 atempo），最后 amix + 裁齐 + 补齐", () => {
    const f = buildMixFilter(planPlacement(ps, [3000, 3300, 2000], 12000), 12000);
    expect(f).toContain("[0:a]adelay=1000|1000[a0]");
    expect(f).toContain("[1:a]atempo=1.2222,adelay=6000|6000[a1]");
    expect(f).toContain("[2:a]adelay=9000|9000[a2]");
    expect(f).toMatch(/\[a0\]\[a1\]\[a2\]amix=inputs=3:normalize=0:duration=longest,atrim=end=12\.000,apad=whole_dur=12\.000\[out\]$/);
  });
});
