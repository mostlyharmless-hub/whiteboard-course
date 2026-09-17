import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { renderRange } from "../../src/render/frames";
import { frameFileName } from "../../src/render/segments";

/**
 * 分段并行渲染的前提：同一帧的像素与渲染历史无关。
 * 串行 worker 从 13 s 逐帧走到 18 s（经历高亮 14 s、画圈 16 s 的逐帧绘制），
 * 冷启动 worker 直接从 17 s 开始；两者在 17–18 s 的帧必须逐字节相同。
 */
test("renderRange：冷启动的分段与串行渲染逐字节一致（高亮、画圈、滤镜边框）", async () => {
  test.setTimeout(180_000);
  // 直接调用 renderRange，用不上 page 的 baseURL，从项目配置取同一地址
  const url = `${test.info().project.use.baseURL}/?script=tests%2Ffixtures%2Fminimal.script.json&render=1`;
  const root = join("test-results", "render-determinism");
  const serialDir = join(root, "serial");
  const coldDir = join(root, "cold");
  rmSync(root, { recursive: true, force: true });
  mkdirSync(serialDir, { recursive: true });
  mkdirSync(coldDir, { recursive: true });

  const target = { url, width: 1920, height: 1080, from: 13_000, fps: 25 };
  await renderRange({ ...target, dir: serialDir, start: 0, end: 125 });
  await renderRange({ ...target, dir: coldDir, start: 100, end: 125 });

  const differing: number[] = [];
  for (let i = 100; i < 125; i++) {
    const a = readFileSync(join(serialDir, frameFileName(i)));
    const b = readFileSync(join(coldDir, frameFileName(i)));
    if (!a.equals(b)) differing.push(i);
  }
  expect(differing).toEqual([]);
});
