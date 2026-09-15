import { describe, expect, it } from "vitest";
import { extractJson } from "../../src/generator/json";

describe("extractJson", () => {
  it("直接 JSON", () => {
    expect(extractJson('[{"a":1}]')).toEqual({ ok: true, value: [{ a: 1 }] });
  });
  it("剥离 ```json 围栏", () => {
    expect(extractJson("```json\n[1,2]\n```")).toEqual({ ok: true, value: [1, 2] });
  });
  it("前后有解释文字时取首个 [ 到最后一个 ]", () => {
    expect(extractJson("好的，如下：\n[1]\n以上。")).toEqual({ ok: true, value: [1] });
  });
  it("对象也可以", () => {
    expect(extractJson('输出：{"x":[1]}')).toEqual({ ok: true, value: { x: [1] } });
  });
  it("解析失败返回错误", () => {
    const r = extractJson("不是 JSON");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/JSON/);
  });
});
