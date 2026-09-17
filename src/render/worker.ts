import { renderRange, type RenderTarget } from "./frames";
import type { Segment } from "./segments";

/**
 * 并行渲染的 worker 子进程入口（由 cli.ts 派发）。
 * 配置：环境变量 RENDER_WORKER_CONFIG（RenderTarget & Segment 的 JSON）；
 * 进度：stdout 每行一个 {"done": n}；
 * 中止：stdin 关闭即在下一帧前停止并关闭浏览器（主进程要求中止或主进程退出时都会发生）。
 */
async function main(): Promise<number> {
  const raw = process.env.RENDER_WORKER_CONFIG;
  if (!raw) throw new Error("缺少环境变量 RENDER_WORKER_CONFIG");
  const config = JSON.parse(raw) as RenderTarget & Segment;
  const abort = new AbortController();
  process.stdin.on("end", () => abort.abort(new Error("主进程要求中止")));
  process.stdin.resume();
  await renderRange({
    ...config,
    signal: abort.signal,
    onProgress: (done) => process.stdout.write(`${JSON.stringify({ done })}\n`),
  });
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  });
