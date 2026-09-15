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

/** 字体加载完、没有待渲染的 Mermaid 占位 */
export async function waitAssetsReady(timeoutMs = 8000): Promise<void> {
  await document.fonts.ready;
  const deadline = Date.now() + timeoutMs;
  while (document.querySelector(".mermaid-placeholder") && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  await afterPaint();
}
