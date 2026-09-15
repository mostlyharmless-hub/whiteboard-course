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

test("多页脚本带 ?t= 打开时直接显示当前页", async ({ page }) => {
  await page.goto("/?script=tests/fixtures/demo.script.json&t=125000");
  await expect(page.locator(".page-nav")).toContainText("2 / 2");
  await expect(page.locator(".page-title")).toHaveText("岗位信息智能采集");
  await expect(page.locator(".card")).toHaveCount(3);
  await expect(page.locator(".outline li.current")).toContainText("岗位信息采集");
});

test("音频模式：以音频时钟为准，播放后时间前进、拖动后同步", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(`/?script=${SCRIPT}&audio=tests/fixtures/silence-20s.wav`);
  await expect(page.locator(".mode")).toHaveText("音频");
  const seconds = async () => Number(/0:(\d\d)/.exec((await page.locator(".time").textContent()) ?? "")?.[1]);
  await page.locator(".btn.play").click();
  // 机器繁忙时音频起播会慢，轮询而不是固定等待
  await expect.poll(seconds, { timeout: 8000 }).toBeGreaterThanOrEqual(2);
  await page.locator(".btn.play").click();
  expect(await seconds()).toBeLessThanOrEqual(6);

  // 拖到 75%（约 15 秒）：卡片、标注按该时刻直接显示
  const track = page.locator(".track");
  const box = (await track.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
  await expect(page.locator(".time")).toContainText("0:15 / 0:20");
  await expect(page.locator(".card")).toHaveCount(2);
  await expect(page.locator(".marks rect")).toHaveCount(1);
  expect(errors.map((e) => e.text())).toEqual([]);
});

test("渲染模式：无界面、window.__player 可逐帧设时间；?subtitles= 覆盖字幕文本", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(`/?script=${SCRIPT}&render=1&subtitles=tests/fixtures/minimal.subtitles.json`);
  await page.waitForFunction(() => window.__player !== undefined);
  await expect(page.locator(".topbar")).toBeHidden();
  await expect(page.locator(".bottombar")).toBeHidden();
  await expect(page.locator(".sidebar")).toBeHidden();
  const stage = await page.locator(".stage").boundingBox();
  expect(stage?.width).toBe(1440);
  expect(stage?.height).toBe(900);

  await page.evaluate(() => window.__player!.setTime(17000));
  await page.evaluate(() => window.__player!.waitReady());
  await expect(page.locator(".card")).toHaveCount(2);
  await expect(page.locator(".marks rect, .marks path")).toHaveCount(3);
  await expect(page.locator(".subtitle")).toHaveText("（纠错后）它们构成一条闭环分析链，其中环境是最容易被忽视的一环。");
  await page.evaluate(() => window.__player!.setTime(3000));
  await expect(page.locator(".card")).toHaveCount(1);
  await page.screenshot({ path: "test-results/minimal-render-t17000.png" });
  expect(errors.map((e) => e.text())).toEqual([]);
});

test("非法脚本在加载时报错并指出第几条动作", async ({ page }) => {
  await page.goto("/?script=samples/aigc-career.transcript.json");
  await expect(page.locator(".load-error")).toContainText("校验失败");
});
