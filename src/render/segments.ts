import { basename, dirname, extname, join } from "node:path";

/** --jobs auto 时每路 worker 预留的逻辑核数；取 floor(32 / MAX_AUTO_JOBS)，使本机 i9-14900KF（32 逻辑核）auto 恰为 MAX_AUTO_JOBS */
export const CORES_PER_JOB = 2;
/** --jobs auto 的上限。本机实测 1000 帧截图：1 路 9.5 帧/秒、4 路 37.9、8 路 68.0、12 路 84.7、16 路 91.7（12/16 取 3 次均值）→ 取不低于最高值 90% 的最小路数 */
export const MAX_AUTO_JOBS = 12;
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
