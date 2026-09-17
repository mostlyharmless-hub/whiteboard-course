import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { frameFileName, type Segment } from "./segments";

/** 每渲染多少帧回报一次进度 */
const PROGRESS_EVERY = 25;

/** 与段无关的渲染参数；主进程经 JSON 传给 worker */
export interface RenderTarget {
  /** 播放器页面完整 URL（含 render=1） */
  url: string;
  width: number;
  height: number;
  /** 渲染窗口起点（毫秒）；第 i 帧的时间 = from + i * 1000 / fps */
  from: number;
  fps: number;
  /** 帧文件目录，文件名见 frameFileName */
  dir: string;
}

export interface RangeOptions extends RenderTarget, Segment {
  /** 本段累计完成帧数；每 PROGRESS_EVERY 帧及最后一帧各回调一次 */
  onProgress?: (done: number) => void;
  /** 中止后在下一帧开始前抛错，finally 里关闭浏览器 */
  signal?: AbortSignal;
}

/** 起一个 chromium，把帧下标 [start, end) 逐帧截图写成 JPEG */
export async function renderRange(o: RangeOptions): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1 });
    page.on("pageerror", (e) => console.error("页面错误：", e.message));
    await page.goto(o.url);
    await page.waitForFunction(() => window.__player !== undefined, null, { timeout: 30_000 });
    await page.evaluate(() => window.__player!.waitReady());
    for (let i = o.start; i < o.end; i++) {
      o.signal?.throwIfAborted();
      const t = o.from + (i * 1000) / o.fps;
      await page.evaluate((ms) => window.__player!.setTime(ms), t);
      await page.evaluate(() => window.__player!.waitReady());
      const jpeg = await page.screenshot({ type: "jpeg", quality: 92 });
      await writeFile(join(o.dir, frameFileName(i)), jpeg);
      const done = i - o.start + 1;
      if (done % PROGRESS_EVERY === 0 || i === o.end - 1) o.onProgress?.(done);
    }
  } finally {
    await browser.close();
  }
}
