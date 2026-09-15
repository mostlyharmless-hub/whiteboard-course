import { describe, expect, it } from "vitest";
import { BUDGET, countChars, estimateLines, plainText } from "../../src/shared/budget";

describe("plainText", () => {
  it("剥离标题、加粗、列表、行内代码、引用、表格标记", () => {
    const md = "# 标题\n\n**加粗** 与 `code`\n- 项一\n1. 项二\n> 引用\n| a | b |\n|---|---|\n| 1 | 2 |";
    expect(plainText(md)).toBe("标题\n加粗 与 code\n项一\n项二\n引用\na b\n1 2");
  });
  it("保留 KaTeX 原文", () => {
    expect(plainText("公式 $x^2$")).toBe("公式 $x^2$");
  });
  it("嵌套列表与斜体", () => {
    expect(plainText("- 外层\n  - *内层*")).toBe("外层\n内层");
  });
});

describe("countChars", () => {
  it("CJK 一字计 1，英文单词计 1，标点不计", () => {
    expect(countChars("岗位信息 AI 分析，RPA · DeepSeek")).toBe(4 + 1 + 2 + 1 + 1);
  });
  it("数字串计 1", () => {
    expect(countChars("2024年")).toBe(2);
  });
  it("空串为 0", () => {
    expect(countChars("")).toBe(0);
    expect(countChars("，。！")).toBe(0);
  });
});

describe("estimateLines", () => {
  it("每行按 20 字折算，空行不计", () => {
    expect(estimateLines("一".repeat(45) + "\n\n短")).toBe(3 + 1);
  });
  it("预算常量", () => {
    expect(BUDGET.CARD_CHARS).toBe(140);
    expect(BUDGET.CARD_LINES).toBe(9);
  });
});
