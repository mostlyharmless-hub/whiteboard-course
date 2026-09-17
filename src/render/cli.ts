import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderRange, type RenderTarget } from "./frames";
import {
  CORES_PER_JOB,
  FRAME_PATTERN,
  MAX_AUTO_JOBS,
  defaultFramesDir,
  planSegments,
  resolveJobs,
  type Segment,
} from "./segments";

const USAGE = `用法：pnpm render --script <script.json> --out <video.mp4> [--audio <mp3>] [--subtitles <transcript.json>] [--fps 25] [--width 1920] [--height 1080] [--from 0] [--until <ms>] [--tail 2000] [--port 5175] [--jobs auto] [--frames-dir <dir>] [--keep-frames]

多个 chromium 并行把播放器画面（?render=1 模式）逐帧截图成 JPEG，再由一个 ffmpeg 按序编码并与配音合成 mp4；画面与音频按脚本时间严格对齐。
--until 只渲染到指定毫秒（先渲染 10 秒验证：--until 10000）；--tail 在课程结束后多停留的毫秒数（板书晚于语音消失）。端口已有服务器时直接复用。
--jobs 并行路数，auto = 逻辑核数 / ${CORES_PER_JOB}（至少 1，至多 ${MAX_AUTO_JOBS}）；--jobs 1 不起子进程。
--frames-dir 临时帧目录（默认输出文件旁的 <文件名>.frames/，开始前清空、成功后删除）；--keep-frames 成功后也保留。
`;

/** 汇总进度的最短打印间隔 */
const PROGRESS_PRINT_MS = 5000;
/** 要求中止后等 worker 自行关闭浏览器的宽限时间，超时强杀 */
const ABORT_GRACE_MS = 15_000;
const WORKER_ENTRY = fileURLToPath(new URL("./worker.ts", import.meta.url));

interface Args {
  script: string;
  out: string;
  audio?: string;
  subtitles?: string;
  fps: number;
  width: number;
  height: number;
  from: number;
  until?: number;
  tail: number;
  port: number;
  jobs: number;
  framesDir?: string;
  keepFrames: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Partial<Args> = {
    fps: 25,
    width: 1920,
    height: 1080,
    from: 0,
    tail: 2000,
    port: 5175,
    jobs: resolveJobs("auto", availableParallelism()),
    keepFrames: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${k} 缺少参数值`);
      return v;
    };
    switch (k) {
      case "--script":
        a.script = next();
        break;
      case "--out":
        a.out = next();
        break;
      case "--audio":
        a.audio = next();
        break;
      case "--subtitles":
        a.subtitles = next();
        break;
      case "--fps":
        a.fps = Number(next());
        break;
      case "--width":
        a.width = Number(next());
        break;
      case "--height":
        a.height = Number(next());
        break;
      case "--from":
        a.from = Number(next());
        break;
      case "--until":
        a.until = Number(next());
        break;
      case "--tail":
        a.tail = Number(next());
        break;
      case "--port":
        a.port = Number(next());
        break;
      case "--jobs":
        a.jobs = resolveJobs(next(), availableParallelism());
        break;
      case "--frames-dir":
        a.framesDir = next();
        break;
      case "--keep-frames":
        a.keepFrames = true;
        break;
      case "--help":
      case "-h":
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        throw new Error(`未知参数 ${k}\n${USAGE}`);
    }
  }
  if (!a.script || !a.out) throw new Error(`必须提供 --script 与 --out\n${USAGE}`);
  return a as Args;
}

async function portAlive(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** 端口无服务时起一个 vite，等它可访问 */
async function ensureServer(port: number): Promise<ChildProcess | null> {
  if (await portAlive(port)) return null;
  // 直接用 node 执行 vite 的入口，而不是 node_modules/.bin/vite：
  // 后者在 Windows 上是无扩展名的 sh 脚本，CreateProcess 只会补 .exe，spawn 必然 ENOENT；
  // 改用 .CMD 则要 shell:true，kill() 杀掉的是 cmd.exe 而不是 vite 本身。
  const vite = spawn(process.execPath, [join("node_modules", "vite", "bin", "vite.js"), "--port", String(port), "--strictPort"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await portAlive(port)) return vite;
  }
  vite.kill();
  throw new Error(`vite 在 ${port} 端口 30 秒内未就绪`);
}

/** 子进程结束时给出退出码；启动失败（error 事件）视为 null */
function waitExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    child.once("error", () => resolve(null));
    child.once("close", (code) => resolve(code));
  });
}

/** 汇总进度：最多每 PROGRESS_PRINT_MS 打印一行，全部完成时必打一行 */
function progressPrinter(total: number, startedAt: number): (done: number) => void {
  let lastPrint = 0;
  return (done) => {
    const now = Date.now();
    if (done < total && now - lastPrint < PROGRESS_PRINT_MS) return;
    lastPrint = now;
    const elapsed = Math.max(0.001, (now - startedAt) / 1000);
    const eta = done > 0 ? ((total - done) * elapsed) / done : 0;
    console.error(`  ${done}/${total} 帧（已用 ${elapsed.toFixed(0)} s，${(done / elapsed).toFixed(1)} 帧/秒，预计还需 ${eta.toFixed(0)} s）`);
  };
}

/** 每段一个 worker 子进程；任一失败则让其余 worker 中止，全部退出后抛出第一个失败 */
async function runWorkers(segments: Segment[], target: RenderTarget, onProgress: (done: number) => void): Promise<void> {
  const workers = segments.map((segment) => {
    const child = spawn(process.execPath, ["--import", "tsx", WORKER_ENTRY], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, RENDER_WORKER_CONFIG: JSON.stringify({ ...target, ...segment }) },
    });
    return { child, segment, done: 0, stderr: "" };
  });

  for (const w of workers) {
    // worker 已退出后再 end() 其 stdin 会触发 EPIPE，吞掉即可
    w.child.stdin!.on("error", () => {});
    let buf = "";
    w.child.stdout!.setEncoding("utf8");
    w.child.stdout!.on("data", (chunk: string) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop()!;
      for (const line of lines) {
        try {
          w.done = (JSON.parse(line) as { done: number }).done;
        } catch {
          continue;
        }
        onProgress(workers.reduce((sum, x) => sum + x.done, 0));
      }
    });
    w.child.stderr!.setEncoding("utf8");
    w.child.stderr!.on("data", (chunk: string) => {
      w.stderr += chunk;
    });
  }

  const failures: string[] = [];
  await Promise.all(
    workers.map(async (w, k) => {
      const code = await waitExit(w.child);
      if (code === 0 || failures.length > 0) return;
      failures.push(`第 ${k + 1}/${workers.length} 段（帧 ${w.segment.start}–${w.segment.end - 1}）渲染失败，退出码 ${code}\n${w.stderr.trim()}`);
      for (const other of workers) other.child.stdin!.end();
      // 兜底：worker 没在宽限期内自行退出就强杀（可能遗留其 chromium，只在异常情况下发生）
      setTimeout(() => {
        for (const other of workers) if (other.child.exitCode === null) other.child.kill();
      }, ABORT_GRACE_MS).unref();
    }),
  );
  if (failures.length > 0) throw new Error(failures[0]);
}

/** 单个 ffmpeg 按序读取帧文件编码，并与音频合成 */
async function encode(args: Args, framesDir: string): Promise<void> {
  const ffArgs = ["-y", "-hide_banner", "-loglevel", "error", "-f", "image2", "-framerate", String(args.fps), "-start_number", "0", "-i", join(framesDir, FRAME_PATTERN)];
  if (args.audio) ffArgs.push("-ss", (args.from / 1000).toFixed(3), "-i", args.audio);
  ffArgs.push("-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(args.fps));
  if (args.audio) ffArgs.push("-af", "apad", "-c:a", "aac", "-b:a", "160k", "-shortest");
  ffArgs.push(args.out);
  const code = await waitExit(spawn("ffmpeg", ffArgs, { stdio: ["ignore", "inherit", "inherit"] }));
  if (code !== 0) throw new Error(`ffmpeg 退出码 ${code}`);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.audio && !existsSync(args.audio)) throw new Error(`音频不存在：${args.audio}`);
  const script = JSON.parse(readFileSync(args.script, "utf8")) as { meta: { duration_ms: number; title: string } };
  // 课程结束后多停 tail 毫秒（播放器把 t 钳到 duration，画面保持最后状态；音频用 apad 补静音）
  const until = args.until !== undefined ? Math.min(args.until, script.meta.duration_ms) : script.meta.duration_ms + args.tail;
  const frames = Math.ceil(((until - args.from) / 1000) * args.fps);
  if (frames <= 0) throw new Error(`渲染区间为空：from ${args.from} ms，until ${until} ms`);
  const segments = planSegments(frames, args.jobs);

  // 开始前清空：image2 按编号连续读取，残留的旧帧会被编进视频
  const framesDir = args.framesDir ?? defaultFramesDir(args.out);
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  mkdirSync(dirname(args.out), { recursive: true });

  const vite = await ensureServer(args.port);
  try {
    const q = new URLSearchParams({ script: args.script, render: "1" });
    if (args.subtitles) q.set("subtitles", args.subtitles);
    const target: RenderTarget = {
      url: `http://localhost:${args.port}/?${q.toString()}`,
      width: args.width,
      height: args.height,
      from: args.from,
      fps: args.fps,
      dir: framesDir,
    };

    console.error(
      `渲染「${script.meta.title}」：${frames} 帧 @ ${args.fps} fps，${args.width}×${args.height}，${(args.from / 1000).toFixed(1)}–${(until / 1000).toFixed(1)} 秒，${segments.length} 路`,
    );
    const startedAt = Date.now();
    const onProgress = progressPrinter(frames, startedAt);
    if (args.jobs === 1) await renderRange({ ...target, start: 0, end: frames, onProgress });
    else await runWorkers(segments, target, onProgress);

    const written = readdirSync(framesDir).filter((f) => f.endsWith(".jpg")).length;
    if (written !== frames) throw new Error(`帧文件数 ${written} ≠ 应有 ${frames}，帧目录已保留：${framesDir}`);
    const renderedAt = Date.now();
    console.error(`帧截图完成，用时 ${((renderedAt - startedAt) / 1000).toFixed(1)} s；开始编码`);

    await encode(args, framesDir);
    if (!args.keepFrames) rmSync(framesDir, { recursive: true, force: true });
    console.error(`已写出 ${args.out}（编码 ${((Date.now() - renderedAt) / 1000).toFixed(1)} s，总用时 ${((Date.now() - startedAt) / 1000).toFixed(1)} s）`);
    return 0;
  } finally {
    vite?.kill();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  });
