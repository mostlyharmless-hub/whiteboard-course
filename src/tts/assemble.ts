import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildMixFilter, type Placement } from "./placement";

const run = promisify(execFile);

/** ffprobe 取音频时长（毫秒） */
export async function probeDurationMs(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  const secs = Number(stdout.trim());
  if (!Number.isFinite(secs)) throw new Error(`ffprobe 无法读取时长：${file}`);
  return Math.round(secs * 1000);
}

/** 按排布把各段 WAV 混成一条 mp3，总长 = 课程时长 */
export async function mixToMp3(clips: string[], placements: Placement[], totalMs: number, out: string): Promise<void> {
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const c of clips) args.push("-i", c);
  args.push("-filter_complex", buildMixFilter(placements, totalMs), "-map", "[out]", "-c:a", "libmp3lame", "-q:a", "2", out);
  await run("ffmpeg", args, { maxBuffer: 16 * 1024 * 1024 });
}
