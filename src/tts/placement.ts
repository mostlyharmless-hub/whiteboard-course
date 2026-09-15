import type { Paragraph } from "../shared/schema";

/** 段与段之间至少留的静音 */
export const GAP_MS = 300;
/** ffmpeg atempo 上限；超过 2× 语音已不可听 */
export const MAX_ATEMPO = 2;

export interface Placement {
  paragraph_id: string;
  /** 放置位置 = 原段落 begin_time */
  begin_ms: number;
  /** TTS 原始时长 */
  clip_ms: number;
  /** 到下一段开始（或课程结束）之前可用的时长 */
  available_ms: number;
  /** 1 = 不变速 */
  atempo: number;
  /** 变速后的结束时刻 */
  end_ms: number;
}

/**
 * 每段音频放在原 begin_time；若比可用窗口长，按需加速（不超过 MAX_ATEMPO）。
 * 这样整体时长仍等于课程时长，板书脚本与字幕的时间轴完全不变。
 */
export function planPlacement(paragraphs: Paragraph[], clipMs: number[], totalMs: number): Placement[] {
  return paragraphs.map((p, i) => {
    const clip = clipMs[i] ?? 0;
    const nextBegin = paragraphs[i + 1]?.begin_time ?? totalMs;
    const available = Math.max(1, nextBegin - p.begin_time - GAP_MS);
    const atempo = clip > available ? Math.min(MAX_ATEMPO, clip / available) : 1;
    return { paragraph_id: p.paragraph_id, begin_ms: p.begin_time, clip_ms: clip, available_ms: available, atempo, end_ms: p.begin_time + Math.round(clip / atempo) };
  });
}

/** ffmpeg filter_complex：每路 atempo + adelay，再 amix 求和、裁齐到课程总长 */
export function buildMixFilter(placements: Placement[], totalMs: number): string {
  const total = (totalMs / 1000).toFixed(3);
  const chains = placements.map((pl, i) => {
    const tempo = pl.atempo !== 1 ? `atempo=${pl.atempo.toFixed(4)},` : "";
    return `[${i}:a]${tempo}adelay=${pl.begin_ms}|${pl.begin_ms}[a${i}]`;
  });
  const labels = placements.map((_, i) => `[a${i}]`).join("");
  const mix = `${labels}amix=inputs=${placements.length}:normalize=0:duration=longest,atrim=end=${total},apad=whole_dur=${total}[out]`;
  return [...chains, mix].join(";");
}
