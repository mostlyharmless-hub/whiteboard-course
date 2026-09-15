import { chromium } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const USAGE = `用法：pnpm render --script <script.json> --out <video.mp4> [--audio <mp3>] [--subtitles <transcript.json>] [--fps 25] [--width 1920] [--height 1080] [--from 0] [--until <ms>] [--tail 2000] [--port 5175]

按帧把播放器画面（?render=1 模式）截图后用 ffmpeg 与配音合成 mp4；画面与音频按脚本时间严格对齐。
--until 只渲染到指定毫秒（先渲染 10 秒验证：--until 10000）；--tail 在课程结束后多停留的毫秒数（板书晚于语音消失）。端口已有服务器时直接复用。
`;

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
}

function parseArgs(argv: string[]): Args {
  const a: Partial<Args> = { fps: 25, width: 1920, height: 1080, from: 0, tail: 2000, port: 5175 };
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
  const vite = spawn(join("node_modules", ".bin", "vite"), ["--port", String(port), "--strictPort"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await portAlive(port)) return vite;
  }
  vite.kill();
  throw new Error(`vite 在 ${port} 端口 30 秒内未就绪`);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.audio && !existsSync(args.audio)) throw new Error(`音频不存在：${args.audio}`);
  const script = JSON.parse(readFileSync(args.script, "utf8")) as { meta: { duration_ms: number; title: string } };
  // 课程结束后多停 tail 毫秒（播放器把 t 钳到 duration，画面保持最后状态；音频用 apad 补静音）
  const until = args.until !== undefined ? Math.min(args.until, script.meta.duration_ms) : script.meta.duration_ms + args.tail;
  const frames = Math.ceil(((until - args.from) / 1000) * args.fps);
  mkdirSync(dirname(args.out), { recursive: true });

  const vite = await ensureServer(args.port);
  const browser = await chromium.launch();
  let ffmpeg: ChildProcess | null = null;
  try {
    const page = await browser.newPage({ viewport: { width: args.width, height: args.height }, deviceScaleFactor: 1 });
    page.on("pageerror", (e) => console.error("页面错误：", e.message));
    const q = new URLSearchParams({ script: args.script, render: "1" });
    if (args.subtitles) q.set("subtitles", args.subtitles);
    await page.goto(`http://localhost:${args.port}/?${q.toString()}`);
    await page.waitForFunction(() => window.__player !== undefined, null, { timeout: 30_000 });
    await page.evaluate(() => window.__player!.waitReady());

    const ffArgs = ["-y", "-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(args.fps), "-i", "-"];
    if (args.audio) ffArgs.push("-ss", (args.from / 1000).toFixed(3), "-i", args.audio);
    ffArgs.push("-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(args.fps));
    if (args.audio) ffArgs.push("-af", "apad", "-c:a", "aac", "-b:a", "160k", "-shortest");
    ffArgs.push(args.out);
    ffmpeg = spawn("ffmpeg", ffArgs, { stdio: ["pipe", "inherit", "inherit"] });
    const stdin = ffmpeg.stdin!;

    console.error(`渲染「${script.meta.title}」：${frames} 帧 @ ${args.fps} fps，${args.width}×${args.height}，${(args.from / 1000).toFixed(1)}–${(until / 1000).toFixed(1)} 秒`);
    const startedAt = Date.now();
    for (let i = 0; i < frames; i++) {
      const t = args.from + (i * 1000) / args.fps;
      await page.evaluate((ms) => window.__player!.setTime(ms), t);
      await page.evaluate(() => window.__player!.waitReady());
      const jpeg = await page.screenshot({ type: "jpeg", quality: 92 });
      if (!stdin.write(jpeg)) await once(stdin, "drain");
      if (i % 250 === 0 || i === frames - 1) {
        const elapsed = (Date.now() - startedAt) / 1000;
        const eta = i > 0 ? ((frames - i - 1) * elapsed) / (i + 1) : 0;
        console.error(`  ${i + 1}/${frames} 帧（t = ${(t / 1000).toFixed(1)} s，已用 ${elapsed.toFixed(0)} s，预计还需 ${eta.toFixed(0)} s）`);
      }
    }
    stdin.end();
    const [code] = (await once(ffmpeg, "exit")) as [number | null];
    if (code !== 0) throw new Error(`ffmpeg 退出码 ${code}`);
    console.error(`已写出 ${args.out}`);
    return 0;
  } finally {
    await browser.close();
    vite?.kill();
    if (ffmpeg && ffmpeg.exitCode === null) ffmpeg.kill();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  });
