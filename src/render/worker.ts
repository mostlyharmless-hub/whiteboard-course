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
  process.stdin.on("error", () => abort.abort(new Error("主进程要求中止")));
  process.stdin.resume();
  await renderRange({
    ...config,
    signal: abort.signal,
    onProgress: (done) => process.stdout.write(`${JSON.stringify({ done })}\n`),
  });
  return 0;
}

/** 让 stdout / stderr 的管道写入排空后再退出（POSIX 上管道写入是异步的，直接 process.exit 可能丢掉最后的进度或错误信息） */
function finish(code: number): void {
  process.exitCode = code;
  // stdin.resume() 会一直占住事件循环，必须释放
  process.stdin.destroy();
  // 兜底：若仍有句柄占住事件循环，2 秒后强制退出，保证主进程不会一直等
  setTimeout(() => process.exit(code), 2000).unref();
}

main()
  .then(finish)
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    finish(2);
  });
