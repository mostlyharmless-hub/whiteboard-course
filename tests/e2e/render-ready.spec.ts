import { expect, test } from "@playwright/test";

const SCRIPT = "tests/fixtures/minimal.script.json";

/**
 * 多个浏览器同时冷启动时，Mermaid 按需加载图表代码可能排队数十秒。
 * 渲染模式的 waitReady 必须一直等到图画好，不能超时后放行、截到「绘制中…」占位符。
 */
test("渲染模式：Mermaid 迟迟未就绪时 waitReady 继续等待，不放行占位符", async ({ page }) => {
  test.setTimeout(90_000);
  // 人为把 Mermaid 流程图代码的加载拖慢 12 秒（超过原先 8 秒的等待上限）
  await page.route(/flowDiagram-[^/]*\.js/, async (route) => {
    await new Promise((r) => setTimeout(r, 12_000));
    await route.continue();
  });
  await page.goto(`/?script=${SCRIPT}&render=1`);
  await page.waitForFunction(() => window.__player !== undefined);
  await page.evaluate(() => window.__player!.waitReady());

  await page.evaluate(() => window.__player!.setTime(12_000));
  await page.evaluate(() => window.__player!.waitReady());
  // 立即检查（不用会自动重试的断言），反映截图那一刻的 DOM
  const state = await page.evaluate(() => ({
    placeholder: document.querySelector(".mermaid-placeholder") !== null,
    svg: document.querySelector(".mermaid-svg svg") !== null,
  }));
  expect(state).toEqual({ placeholder: false, svg: true });
});
