import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CORES_PER_JOB,
  MAX_AUTO_JOBS,
  defaultFramesDir,
  frameFileName,
  planSegments,
  resolveJobs,
} from "../../src/render/segments";

describe("planSegments", () => {
  it("整除时均分", () => {
    expect(planSegments(8, 4)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
      { start: 4, end: 6 },
      { start: 6, end: 8 },
    ]);
  });
  it("余数分给前几段", () => {
    expect(planSegments(10, 4)).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 6 },
      { start: 6, end: 8 },
      { start: 8, end: 10 },
    ]);
  });
  it("jobs 大于帧数时段数收敛到帧数，不产生空段", () => {
    expect(planSegments(3, 8)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2, end: 3 },
    ]);
  });
  it("jobs = 1 返回单段", () => {
    expect(planSegments(7717, 1)).toEqual([{ start: 0, end: 7717 }]);
  });
  it("0 帧返回空数组", () => {
    expect(planSegments(0, 8)).toEqual([]);
  });
  it("样例全片：首尾相接、无重叠、总帧数守恒、段长相差不超过 1", () => {
    const segs = planSegments(7717, 8);
    expect(segs).toHaveLength(8);
    expect(segs[0]!.start).toBe(0);
    expect(segs.at(-1)!.end).toBe(7717);
    for (let k = 1; k < segs.length; k++) expect(segs[k]!.start).toBe(segs[k - 1]!.end);
    const lens = segs.map((s) => s.end - s.start);
    expect(Math.max(...lens) - Math.min(...lens)).toBeLessThanOrEqual(1);
  });
});

describe("resolveJobs", () => {
  it("auto = floor(逻辑核数 / CORES_PER_JOB)，不超过 MAX_AUTO_JOBS", () => {
    expect(resolveJobs("auto", 32)).toBe(Math.min(MAX_AUTO_JOBS, Math.floor(32 / CORES_PER_JOB)));
    expect(resolveJobs("auto", 1024)).toBe(MAX_AUTO_JOBS);
  });
  it("auto 至少为 1", () => {
    expect(resolveJobs("auto", 1)).toBe(1);
  });
  it("正整数原样返回，可超过 auto 上限", () => {
    expect(resolveJobs("12", 32)).toBe(12);
    expect(resolveJobs("1", 32)).toBe(1);
  });
  it("非法值报错", () => {
    for (const v of ["0", "-1", "1.5", "abc", ""]) expect(() => resolveJobs(v, 32)).toThrow(/--jobs/);
  });
});

describe("帧文件命名", () => {
  it("6 位补零，与 FRAME_PATTERN（%06d.jpg）一致", () => {
    expect(frameFileName(0)).toBe("000000.jpg");
    expect(frameFileName(7716)).toBe("007716.jpg");
  });
  it("默认帧目录在输出文件旁边", () => {
    expect(defaultFramesDir("out/aigc-career.mp4")).toBe(join("out", "aigc-career.frames"));
    expect(defaultFramesDir(join("out", "verify", "a.b.mp4"))).toBe(join("out", "verify", "a.b.frames"));
  });
});
