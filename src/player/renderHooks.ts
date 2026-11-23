/** 渲染模式（?render=1）下暴露给 Playwright 的钩子：逐帧设置时间、等待字体与 Mermaid 就绪 */
export interface PlayerHooks {
  duration: number;
  setTime(ms: number): Promise<void>;
  waitReady(): Promise<void>;
}

declare global {
  interface Window {
    __player?: PlayerHooks;
  }
}

export function installPlayerHooks(hooks: PlayerHooks): void {
  window.__player = hooks;
}

/** 等两帧，保证 React 提交与浏览器绘制都已完成 */
export function afterPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/** 等待上限：多个浏览器同时冷启动时，Mermaid 按需加载图表代码实测可排队 25–45 秒 */
export const ASSETS_TIMEOUT_MS = 120_000;

/** 字体加载完、没有待渲染的 Mermaid 占位；超时抛错——宁可渲染失败，也不能截到未就绪的画面 */
export async function waitAssetsReady(timeoutMs = ASSETS_TIMEOUT_MS): Promise<void> {
  await document.fonts.ready;
  const deadline = Date.now() + timeoutMs;
  while (document.querySelector(".mermaid-placeholder")) {
    if (Date.now() >= deadline) throw new Error(`等待 Mermaid 渲染超过 ${timeoutMs / 1000} 秒，画面未就绪`);
    await new Promise((r) => setTimeout(r, 50));
  }
  await afterPaint();
}
