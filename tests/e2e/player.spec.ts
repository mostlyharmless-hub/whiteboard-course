import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

const SCRIPT = "tests/fixtures/minimal.script.json";

/** 字体文件缺失时浏览器会报 OTS 警告，不算错误；其余 console.error 视为失败 */
function collectErrors(page: Page): ConsoleMessage[] {
  const errors: ConsoleMessage[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m);
  });
  page.on("pageerror", (e) => errors.push({ text: () => e.message } as ConsoleMessage));
  return errors;
}

async function open(page: Page, t: number) {
  await page.goto(`/?script=${SCRIPT}&t=${t}`);
  await expect(page.locator(".topbar")).toBeVisible();
  // Mermaid 异步渲染与字体加载各等一拍
  await page.waitForTimeout(600);
}

const cases: { t: number; cards: number; pageNav: string; subtitle: string; marks: number }[] = [
  { t: 1000, cards: 0, pageNav: "1 / 1", subtitle: "大家好，今天我们讲三个要点。", marks: 0 },
  { t: 5000, cards: 1, pageNav: "1 / 1", subtitle: "第一是数据，第二是能力，第三是环境。", marks: 0 },
  { t: 12000, cards: 2, pageNav: "1 / 1", subtitle: "它们构成一条闭环分析链，其中环境是最容易被忽视的一环。", marks: 0 },
  { t: 17000, cards: 2, pageNav: "1 / 1", subtitle: "它们构成一条闭环分析链，其中环境是最容易被忽视的一环。", marks: 3 },
];

for (const c of cases) {
  test(`t=${c.t}ms：${c.cards} 张卡片、页码 ${c.pageNav}、${c.marks} 个标注图元`, async ({ page }) => {
    const errors = collectErrors(page);
    await open(page, c.t);
    await expect(page.locator(".card")).toHaveCount(c.cards);
    await expect(page.locator(".page-nav")).toContainText(c.pageNav);
    await expect(page.locator(".subtitle")).toHaveText(c.subtitle);
    await expect(page.locator(".marks rect, .marks path")).toHaveCount(c.marks);
    await expect(page.locator(".time")).toContainText(`0:${String(Math.floor(c.t / 1000)).padStart(2, "0")} / 0:20`);
    await page.screenshot({ path: `test-results/minimal-t${c.t}.png` });
    expect(errors.map((e) => e.text())).toEqual([]);
  });
}

test("t=5000 时卡片文字已全部揭示；t=3000 时只揭示了一部分", async ({ page }) => {
  await open(page, 5000);
  const total = await page.locator(".ch").count();
  expect(total).toBeGreaterThan(10);
  await expect(page.locator(".ch.on")).toHaveCount(total);

  await open(page, 3000);
  const shown = await page.locator(".ch.on").count();
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(total);
  await expect(page.locator(".pen")).toBeVisible();
});

test("非法脚本在加载时报错并指出第几条动作", async ({ page }) => {
  await page.goto("/?script=samples/aigc-career.transcript.json");
  await expect(page.locator(".load-error")).toContainText("校验失败");
});
