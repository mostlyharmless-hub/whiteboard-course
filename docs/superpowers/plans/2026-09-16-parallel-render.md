# 分段并行渲染（pnpm render --jobs）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm render` 用多个 chromium 进程并行逐帧截图，再由单个 ffmpeg 按序编码，全片渲染从约 11 分钟降到 2 分钟以内，产物与 `--jobs 1` 逐字节一致。

**Architecture:** 纯函数 `planSegments` 把帧区间均分给 N 个 worker 子进程；每个 worker 起独立 chromium，调用共用的 `renderRange` 把本段帧写成 `<帧下标 6 位>.jpg`；主进程汇总进度，全部成功后用一次 `ffmpeg -f image2` 读整个序列编码混音。原先截图经 stdin 管道喂 ffmpeg 的实现删除，`--jobs 1` 也走「帧文件 → 单次编码」，只是不起子进程。

**Tech Stack:** Node 24（`node:child_process`、`os.availableParallelism`）、tsx 4.23（`node --import tsx`）、@playwright/test 1.61 chromium、ffmpeg 8.1、vitest。

**Spec:** `docs/superpowers/specs/2026-09-16-parallel-render-design.md`

## Global Constraints

- 代码注释与日志文案用中文，标识符用英文；TypeScript strict，禁止 `any`（CLAUDE.md 第 9、10 节）。
- 不改播放器、不改 BoardScript 契约；不新增依赖。
- 编码参数与现状完全一致：`libx264 -preset medium -crf 18 -pix_fmt yuv420p -r <fps>`；有音频时 `-ss <from 秒> -i <audio>`、`-af apad -c:a aac -b:a 160k -shortest`。
- 子进程一律 `spawn(process.execPath, [...])`，不用 `node_modules/.bin/*`（Windows 上是无扩展名 sh 脚本，spawn 必然 ENOENT，见 f69de91）。
- 所有命令在仓库根目录、Git Bash 下执行。验证产物写到 `out/verify/`（`out/` 已被 git 忽略）。
- 每个 Task 结束前 `pnpm check` 必须通过。

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/render/segments.ts` | 新建 | 纯函数与常量：`planSegments`、`resolveJobs`、`frameFileName`、`defaultFramesDir`、`FRAME_PATTERN`、`MAX_AUTO_JOBS`、`CORES_PER_JOB` |
| `tests/render/segments.test.ts` | 新建 | 上述纯函数的单测 |
| `src/render/frames.ts` | 新建 | `renderRange`：起 chromium，把 `[start, end)` 帧写成 JPEG；类型 `RenderTarget`、`RangeOptions` |
| `src/render/worker.ts` | 新建 | 子进程入口：配置走环境变量，进度按行写 stdout，stdin 关闭即中止 |
| `src/render/cli.ts` | 改写 | 参数解析、起 vite、派发 worker、汇总进度、帧数核对、单次编码、清理 |
| `README.md`、`CLAUDE.md`、spec | 修改 | 文档回填 |

---

### Task 1: 分段与参数纯函数（TDD）

**Files:**
- Create: `src/render/segments.ts`
- Test: `tests/render/segments.test.ts`

- [ ] **Step 1: 写失败的测试**

`tests/render/segments.test.ts`：

```ts
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CORES_PER_JOB,
  MAX_AUTO_JOBS,
  defaultFramesDir,
  frameFileName,
  planSegments,
  resolveJobs,
} from "../../src/render/segments";

describe("planSegments", () => {
  it("整除时均分", () => {
    expect(planSegments(8, 4)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
      { start: 4, end: 6 },
      { start: 6, end: 8 },
    ]);
  });
  it("余数分给前几段", () => {
    expect(planSegments(10, 4)).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 6 },
      { start: 6, end: 8 },
      { start: 8, end: 10 },
    ]);
  });
  it("jobs 大于帧数时段数收敛到帧数，不产生空段", () => {
    expect(planSegments(3, 8)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2, end: 3 },
    ]);
  });
  it("jobs = 1 返回单段", () => {
    expect(planSegments(7717, 1)).toEqual([{ start: 0, end: 7717 }]);
  });
  it("0 帧返回空数组", () => {
    expect(planSegments(0, 8)).toEqual([]);
  });
  it("样例全片：首尾相接、无重叠、总帧数守恒、段长相差不超过 1", () => {
    const segs = planSegments(7717, 8);
    expect(segs).toHaveLength(8);
    expect(segs[0]!.start).toBe(0);
    expect(segs.at(-1)!.end).toBe(7717);
    for (let k = 1; k < segs.length; k++) expect(segs[k]!.start).toBe(segs[k - 1]!.end);
    const lens = segs.map((s) => s.end - s.start);
    expect(Math.max(...lens) - Math.min(...lens)).toBeLessThanOrEqual(1);
  });
});

describe("resolveJobs", () => {
  it("auto = floor(逻辑核数 / CORES_PER_JOB)，不超过 MAX_AUTO_JOBS", () => {
    expect(resolveJobs("auto", 32)).toBe(Math.min(MAX_AUTO_JOBS, Math.floor(32 / CORES_PER_JOB)));
    expect(resolveJobs("auto", 1024)).toBe(MAX_AUTO_JOBS);
  });
  it("auto 至少为 1", () => {
    expect(resolveJobs("auto", 1)).toBe(1);
  });
  it("正整数原样返回，可超过 auto 上限", () => {
    expect(resolveJobs("12", 32)).toBe(12);
    expect(resolveJobs("1", 32)).toBe(1);
  });
  it("非法值报错", () => {
    for (const v of ["0", "-1", "1.5", "abc", ""]) expect(() => resolveJobs(v, 32)).toThrow(/--jobs/);
  });
});

describe("帧文件命名", () => {
  it("6 位补零，与 FRAME_PATTERN（%06d.jpg）一致", () => {
    expect(frameFileName(0)).toBe("000000.jpg");
    expect(frameFileName(7716)).toBe("007716.jpg");
  });
  it("默认帧目录在输出文件旁边", () => {
    expect(defaultFramesDir("out/aigc-career.mp4")).toBe(join("out", "aigc-career.frames"));
    expect(defaultFramesDir(join("out", "verify", "a.b.mp4"))).toBe(join("out", "verify", "a.b.frames"));
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm vitest run tests/render/segments.test.ts`
Expected: FAIL，报错 `Failed to resolve import "../../src/render/segments"`。

- [ ] **Step 3: 实现**

`src/render/segments.ts`：

```ts
import { basename, dirname, extname, join } from "node:path";

/** --jobs auto 时每路 worker 预留的逻辑核数（chromium 渲染 + JPEG 编码 + Node 主线程） */
export const CORES_PER_JOB = 4;
/** --jobs auto 的上限；按本机实测吞吐确定（计划 Task 5） */
export const MAX_AUTO_JOBS = 8;
/** ffmpeg image2 的帧文件名模式，须与 frameFileName 一致 */
export const FRAME_PATTERN = "%06d.jpg";

/** 帧下标区间 [start, end) */
export interface Segment {
  start: number;
  end: number;
}

/** 把 [0, totalFrames) 均分成至多 jobs 段；余数分给前几段；不产生空段 */
export function planSegments(totalFrames: number, jobs: number): Segment[] {
  if (totalFrames <= 0) return [];
  const n = Math.max(1, Math.min(jobs, totalFrames));
  const base = Math.floor(totalFrames / n);
  const extra = totalFrames % n;
  const segments: Segment[] = [];
  let start = 0;
  for (let k = 0; k < n; k++) {
    const end = start + base + (k < extra ? 1 : 0);
    segments.push({ start, end });
    start = end;
  }
  return segments;
}

/** 解析 --jobs：auto → clamp(floor(parallelism / CORES_PER_JOB), 1, MAX_AUTO_JOBS)；否则须为正整数 */
export function resolveJobs(value: string, parallelism: number): number {
  if (value === "auto") return Math.min(MAX_AUTO_JOBS, Math.max(1, Math.floor(parallelism / CORES_PER_JOB)));
  const n = Number(value);
  if (value.trim() === "" || !Number.isInteger(n) || n < 1) throw new Error(`--jobs 须为正整数或 auto，收到「${value}」`);
  return n;
}

/** 第 index 帧的文件名（渲染窗口内的帧下标，从 0 开始） */
export function frameFileName(index: number): string {
  return `${String(index).padStart(6, "0")}.jpg`;
}

/** 默认临时帧目录：与输出文件同目录，名为 <输出文件名去扩展名>.frames */
export function defaultFramesDir(out: string): string {
  return join(dirname(out), `${basename(out, extname(out))}.frames`);
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm vitest run tests/render/segments.test.ts`
Expected: PASS，12 个用例全部通过。

- [ ] **Step 5: 全量检查并提交**

Run: `pnpm check`
Expected: 退出码 0（原 127 个用例 + 新 12 个 = 139 个通过）。

```bash
git add src/render/segments.ts tests/render/segments.test.ts
git commit -m "feat(render): 并行渲染的分段、--jobs 解析与帧文件命名纯函数

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: renderRange——把一段帧写成 JPEG

**Files:**
- Create: `src/render/frames.ts`

依赖浏览器，不写单测；由 Task 3 的冒烟与 Task 5 的等价性验收覆盖。逐帧逻辑（`t` 计算、`setTime` → `waitReady` → `screenshot`、JPEG quality 92、`deviceScaleFactor: 1`）从现有 `src/render/cli.ts` 原样搬过来，**不得改动**，否则等价性不成立。

- [ ] **Step 1: 实现**

`src/render/frames.ts`：

```ts
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
```

- [ ] **Step 2: 检查并提交**

Run: `pnpm check`
Expected: 退出码 0。

```bash
git add src/render/frames.ts
git commit -m "feat(render): renderRange 把一段帧截图写成 JPEG 文件（串行与并行共用）

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: worker 子进程入口

**Files:**
- Create: `src/render/worker.ts`

协议：
- 配置：环境变量 `RENDER_WORKER_CONFIG`，内容为 `RenderTarget & Segment` 的 JSON（走环境变量而不是 argv，避免 Windows 命令行对 JSON 引号的转义问题）。
- 进度：stdout 每行一个 `{"done": n}`（本段累计）。
- 中止：主进程关闭该 worker 的 stdin → `end` 事件 → `AbortController.abort()` → `renderRange` 在下一帧前抛错并关闭浏览器。父进程意外退出时管道同样关闭，因此不会留下孤儿 chromium。
- 退出码：成功 0，失败 2（错误信息写 stderr）。

- [ ] **Step 1: 实现**

`src/render/worker.ts`：

```ts
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
```

- [ ] **Step 2: 类型检查**

Run: `pnpm check`
Expected: 退出码 0。

- [ ] **Step 3: 冒烟——单独跑一个 worker**

先在后台起 vite（后续 Task 复用；`ensureServer` 发现端口已有服务会直接用）：

```bash
mkdir -p out/verify
node node_modules/vite/bin/vite.js --port 5175 --strictPort > out/verify-vite.log 2>&1 &
sleep 4 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5175/
```

Expected: `200`

**中止路径**：`< /dev/null` 让 stdin 立即 EOF，等价于主进程要求中止。

```bash
rm -rf out/verify/smoke.frames && mkdir -p out/verify/smoke.frames
RENDER_WORKER_CONFIG='{"url":"http://localhost:5175/?script=out%2Faigc-career-compact.script.json&render=1","width":1920,"height":1080,"from":24000,"fps":25,"dir":"out/verify/smoke.frames","start":10,"end":40}' \
  node --import tsx src/render/worker.ts < /dev/null; echo "EXIT=$?"
ls out/verify/smoke.frames | wc -l
```

Expected: stderr 输出 `主进程要求中止`，`EXIT=2`，帧数 `0`（中止在第一帧开始前生效）。

**正常路径**：用 `sleep 45 |` 让 stdin 保持打开 45 秒（worker 约 10 秒完成；bash 会等 sleep 结束才返回，所以命令约 45 秒后才回到提示符）。

```bash
rm -rf out/verify/smoke.frames && mkdir -p out/verify/smoke.frames
sleep 45 | RENDER_WORKER_CONFIG='{"url":"http://localhost:5175/?script=out%2Faigc-career-compact.script.json&render=1","width":1920,"height":1080,"from":24000,"fps":25,"dir":"out/verify/smoke.frames","start":10,"end":40}' \
  node --import tsx src/render/worker.ts; echo "EXIT=${PIPESTATUS[1]}"
ls out/verify/smoke.frames | head -1; ls out/verify/smoke.frames | tail -1; ls out/verify/smoke.frames | wc -l
```

Expected: stdout 两行 `{"done":25}`、`{"done":30}`；`EXIT=0`；文件从 `000010.jpg` 到 `000039.jpg`，共 `30` 个。

- [ ] **Step 4: 提交**

```bash
rm -rf out/verify/smoke.frames
git add src/render/worker.ts
git commit -m "feat(render): 并行渲染 worker 子进程（环境变量传配置、stdout 回报进度、stdin 关闭即中止）

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: cli.ts 编排——派发 worker、核对帧数、单次编码

**Files:**
- Modify: `src/render/cli.ts`（整文件替换；`portAlive`、`ensureServer` 原样保留）

- [ ] **Step 1: 整文件替换为以下内容**

`src/render/cli.ts`：

```ts
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
```

- [ ] **Step 2: 检查**

Run: `pnpm check`
Expected: 退出码 0。

- [ ] **Step 3: 带音频的 10 秒样片（串行与并行各一次）**

```bash
pnpm render --script out/aigc-career-compact.script.json --audio samples/aigc-career.tts-compact.mp3 --subtitles samples/aigc-career.tts-compact.transcript.json --until 10000 --jobs 1 --out out/verify/s10-j1.mp4; echo "EXIT=$?"
pnpm render --script out/aigc-career-compact.script.json --audio samples/aigc-career.tts-compact.mp3 --subtitles samples/aigc-career.tts-compact.transcript.json --until 10000 --jobs 8 --out out/verify/s10-j8.mp4; echo "EXIT=$?"
md5sum out/verify/s10-j1.mp4 out/verify/s10-j8.mp4
ffprobe -v error -show_entries format=duration -show_entries stream=codec_name,width,height,r_frame_rate -of default=noprint_wrappers=1 out/verify/s10-j8.mp4
ls out/verify
```

Expected:
- 两次 `EXIT=0`，第二次日志含 `250 帧 … 8 路`。
- 两个 md5 **相同**。
- ffprobe：`h264`、`1920`、`1080`、`25/1`、`aac`，`duration=10.000000`。
- `out/verify` 下没有残留的 `*.frames` 目录。

- [ ] **Step 4: 提交**

```bash
git add src/render/cli.ts
git commit -m "feat(render): pnpm render --jobs 分段并行渲染——worker 写帧文件、核对帧数、单个 ffmpeg 按序编码

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 等价性验收、吞吐实测与默认并行数

**Files:**
- Modify: `src/render/segments.ts`（仅 `CORES_PER_JOB`、`MAX_AUTO_JOBS` 两个常量及注释，视实测结果）

后台 vite 仍在 5175 端口运行（Task 3 Step 3 启动），以下计时不含 vite 启动。

- [ ] **Step 1: 与改动前管道实现等价（基线 md5）**

```bash
pnpm render --script out/aigc-career-compact.script.json --from 24000 --until 26000 --jobs 1 --out out/verify/eq-j1.mp4
pnpm render --script out/aigc-career-compact.script.json --from 24000 --until 26000 --jobs 8 --out out/verify/eq-j8.mp4
md5sum out/verify/eq-j1.mp4 out/verify/eq-j8.mp4
```

Expected: 两个 md5 都等于 `7cf94d7936eb430750f0dbb76ed37172`（f69de91 时用管道实现渲染同一窗口的结果）。8 路时每段约 6 帧，每个 worker 都在 Mermaid 卡片（c02，22728 ms 出现）已在画面上的时刻冷启动。

若 `eq-j1` 与 `eq-j8` 相同但不等于基线，比对解码帧确认只是容器层差异：

```bash
git worktree add ../wb-baseline f69de91
(cd ../wb-baseline && pnpm install --frozen-lockfile --prefer-offline)
mkdir -p ../wb-baseline/out && cp out/aigc-career-compact.script.json ../wb-baseline/out/
(cd ../wb-baseline && pnpm render --script out/aigc-career-compact.script.json --from 24000 --until 26000 --port 5176 --out out/eq-baseline.mp4)
ffmpeg -v error -i ../wb-baseline/out/eq-baseline.mp4 -f framemd5 - > out/verify/eq-baseline.framemd5
ffmpeg -v error -i out/verify/eq-j1.mp4 -f framemd5 - > out/verify/eq-j1.framemd5
diff <(grep -v '^#' out/verify/eq-baseline.framemd5) <(grep -v '^#' out/verify/eq-j1.framemd5) && echo "解码帧一致"
git worktree remove --force ../wb-baseline
```

Expected: `解码帧一致`。有不同则转 Step 3 排查。

- [ ] **Step 2: 跨翻页、多张 Mermaid 的长窗口，jobs 1 与 8 一致**

窗口 255–275 s 含 c14（260888 ms）与 c16（267745 ms）两张 Mermaid，共 500 帧。

```bash
pnpm render --script out/aigc-career-compact.script.json --from 255000 --until 275000 --jobs 1 --out out/verify/mm-j1.mp4
pnpm render --script out/aigc-career-compact.script.json --from 255000 --until 275000 --jobs 8 --out out/verify/mm-j8.mp4
md5sum out/verify/mm-j1.mp4 out/verify/mm-j8.mp4
```

Expected: 两个 md5 相同。

- [ ] **Step 3: （仅当 Step 1 或 2 不一致时）定位第一处不同的帧**

```bash
ffmpeg -v error -i out/verify/mm-j1.mp4 -f framemd5 - > out/verify/mm-j1.framemd5
ffmpeg -v error -i out/verify/mm-j8.mp4 -f framemd5 - > out/verify/mm-j8.framemd5
diff out/verify/mm-j1.framemd5 out/verify/mm-j8.framemd5 | head -5
```

framemd5 第 2 列是帧的 pts（即帧下标）。拿到下标 `i` 后，用 `--keep-frames` 重跑两次，对比 `out/verify/mm-j1.frames/` 与 `out/verify/mm-j8.frames/` 下同名 JPEG 的画面差异。若差异只在 Mermaid 图上、且 `i` 恰为某段的起始帧附近，说明 Mermaid 渲染依赖历史（首要嫌疑：`src/player/render/mermaid.ts` 中渲染 id 里的全局自增 `seq`）——按 superpowers:systematic-debugging 排查修复，修复后从 Step 1 重新验收。**不一致时不得进入 Step 4。**

- [ ] **Step 4: 吞吐实测**

固定 40 秒窗口（1000 帧、无音频），读日志中「帧截图完成，用时 X s」：

```bash
for j in 1 4 8 12 16; do
  echo "== jobs $j =="
  pnpm render --script out/aigc-career-compact.script.json --from 100000 --until 140000 --jobs $j --out out/verify/bench-j$j.mp4 2>&1 | grep -E "帧截图完成|已写出"
done
md5sum out/verify/bench-j*.mp4
```

Expected: 5 个 md5 全部相同；记录每个 jobs 的截图用时，计算帧/秒（1000 / 用时）。

- [ ] **Step 5: 定默认值**

规则：取帧/秒不低于最高值 90% 的**最小** jobs，记为 `J`。然后：
- `MAX_AUTO_JOBS = J`
- `CORES_PER_JOB = Math.max(1, Math.floor(32 / J))`（32 为本机 `os.availableParallelism()`），使本机 `auto` 恰好等于 `J`

改 `src/render/segments.ts` 中这两个常量，并把它们的注释改为写明实测数据，例如：

```ts
/** --jobs auto 时每路 worker 预留的逻辑核数；本机 i9-14900KF（32 逻辑核）实测见 MAX_AUTO_JOBS */
export const CORES_PER_JOB = 4;
/** --jobs auto 的上限。本机实测 1000 帧：1 路 11 帧/秒、4 路 43、8 路 82、12 路 88、16 路 86 → 取 90% 拐点 */
export const MAX_AUTO_JOBS = 8;
```

（数字换成实测值。）

Run: `pnpm check`
Expected: 退出码 0（`resolveJobs` 单测按常量计算期望值，改常量不需要改测试）。

- [ ] **Step 6: 全片渲染（auto）**

```bash
pnpm render --script out/aigc-career-compact.script.json --audio samples/aigc-career.tts-compact.mp3 --subtitles samples/aigc-career.tts-compact.transcript.json --out out/verify/aigc-career-parallel.mp4 2>&1 | grep -vE "^\s+[0-9]+/[0-9]+ 帧"; echo "EXIT=${PIPESTATUS[0]}"
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1 out/verify/aigc-career-parallel.mp4
```

Expected: `EXIT=0`；日志含 `7717 帧 … J 路`；总用时显著低于串行（串行实测约 90 ms/帧 ≈ 11.6 分钟）；ffprobe `duration` ≈ `308.7`（306.68 s + 2 s tail）。

- [ ] **Step 7: 提交**

提交信息正文写入 Step 4 的实测表与 Step 6 的全片总用时：

```bash
git add src/render/segments.ts
git commit -m "perf(render): 按本机实测吞吐确定 --jobs auto 默认并行数

1000 帧窗口截图吞吐（i9-14900KF）：1 路 X 帧/秒、4 路 X、8 路 X、12 路 X、16 路 X；
全片 7717 帧 auto（J 路）总用时 X s。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

（`X`、`J` 换成实测值后再执行。）

---

### Task 6: 失败路径验收

**Files:** 无代码改动（发现问题则修复并补提交）

注入方式：`--subtitles` 指向不存在的文件 → 播放器 `boot()` 失败、不安装 `window.__player` → 每个 worker 在 30 秒后 `waitForFunction` 超时。

- [ ] **Step 1: 记录当前 chromium 相关进程数**

```bash
tasklist | grep -ciE "chrome|headless"
```

记下数字 `N0`。

- [ ] **Step 2: 触发失败**

```bash
pnpm render --script out/aigc-career-compact.script.json --subtitles out/verify/missing.json --until 2000 --jobs 4 --out out/verify/fail.mp4; echo "EXIT=$?"
ls -d out/verify/fail.frames; ls out/verify/fail.mp4
sleep 3; tasklist | grep -ciE "chrome|headless"
```

Expected:
- 约 30 秒后退出，pnpm 显示 `Command failed with exit code 2`，`EXIT` 非 0。
- 错误信息形如 `第 k/4 段（帧 a–b）渲染失败，退出码 2`，下一行起是该 worker 的 stderr（含 `Timeout 30000ms exceeded`）。
- `out/verify/fail.frames` 存在（失败时保留）；`ls out/verify/fail.mp4` 报 `No such file or directory`。
- 进程数回到 `N0`（没有孤儿 chromium）。

- [ ] **Step 3: 清理**

```bash
rm -rf out/verify/fail.frames
```

---

### Task 7: 文档回填与收尾

**Files:**
- Modify: `README.md`（`pnpm render` 说明那一条，约第 48 行）
- Modify: `CLAUDE.md`（第 2 节、第 8 节 `src/render/` 行、第 12 节 M5 条目）
- Modify: `docs/superpowers/specs/2026-09-16-parallel-render-design.md`（状态行）

以下 `<J>`、`<总用时>` 换成 Task 5 实测值。

- [ ] **Step 1: README**

把以 `` - `pnpm render`：在 `?render=1` 模式下用 Playwright 逐帧 `` 开头的那一条整行替换为：

```markdown
- `pnpm render`：在 `?render=1` 模式下多个 chromium 并行逐帧 `setTime` 截图成 JPEG，再由一个 ffmpeg 按序合成 1920×1080 @ 25 fps 的 mp4（libx264 + aac）。`--jobs` 默认 `auto`（本机 i9-14900KF 为 <J> 路，样例全片约 <总用时>）；`--jobs 1` 串行，产物与并行逐字节一致。临时帧写在输出文件旁的 `<名>.frames/`（`--frames-dir` 可改，成功后删除，`--keep-frames` 保留）。`--until 10000` 先渲染 10 秒验证；`--subtitles` 用配音版讲解稿覆盖字幕。
```

- [ ] **Step 2: CLAUDE.md**

1. 第 2 节「v1 之外」段落：`` `pnpm render` 把播放器逐帧渲染为 mp4 视频课 `` 改为 `` `pnpm render` 把播放器逐帧渲染为 mp4 视频课（多 chromium 并行截图、单 ffmpeg 编码，`--jobs`） ``。
2. 第 8 节目录树中 `src/render/` 一行改为：
   ```
   │   ├── render/                    # pnpm render：Playwright 多进程并行截图（segments / frames / worker）→ 单个 ffmpeg 合成 mp4（ADR 004）
   ```
3. 第 12 节 M5 条目末尾追加：`2026-09-16 追加分段并行渲染（设计见 docs/superpowers/specs/2026-09-16-parallel-render-design.md）：<J> 路并行，样例全片 <总用时>（串行约 11.6 分钟），与串行产物逐字节一致。`

- [ ] **Step 3: spec 状态**

`docs/superpowers/specs/2026-09-16-parallel-render-design.md` 中 `- 状态：已确认，待实施` 改为 `- 状态：已实施（2026-09-16）`。

- [ ] **Step 4: 最终验证**

```bash
pnpm check; echo "CHECK=$?"
pnpm e2e 2>&1 | tail -3; echo "E2E=${PIPESTATUS[0]}"
```

Expected: `CHECK=0`（139 个用例）；e2e `9 passed`、`E2E=0`。

- [ ] **Step 5: 停掉后台 vite、清理验证产物、提交**

```bash
netstat -ano | grep ":5175 .*LISTENING"
```

取最后一列 PID，然后：

```bash
taskkill //PID <PID> //F
rm -rf out/verify out/verify-vite.log
git add README.md CLAUDE.md docs/superpowers/specs/2026-09-16-parallel-render-design.md
git commit -m "docs: 回填分段并行渲染（README、CLAUDE.md 第 2/8/12 节、spec 状态）

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
