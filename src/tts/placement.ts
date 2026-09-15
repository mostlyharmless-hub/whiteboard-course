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

/** 紧凑时间轴：段与段之间固定留 gap，开头留 start；语音总长决定课程时长 */
export const COMPACT_GAP_MS = 700;
export const COMPACT_START_MS = 2000;

export interface CompactPlan {
  placements: Placement[];
  /** 新时间轴下的段落（文本沿用输入） */
  paragraphs: Paragraph[];
  totalMs: number;
}

/**
 * 由 TTS 时长驱动时间轴（ADR 006）：每段紧接上一段结束 + gap，不再保留原录播的停顿。
 * 板书脚本随后用 remapToTranscript 按段内相对位置映射到新时间轴。
 */
export function planCompact(paragraphs: Paragraph[], clipMs: number[], opts: { gapMs?: number; startMs?: number } = {}): CompactPlan {
  const gap = opts.gapMs ?? COMPACT_GAP_MS;
  let cursor = opts.startMs ?? COMPACT_START_MS;
  const placements: Placement[] = [];
  const out: Paragraph[] = [];
  paragraphs.forEach((p, i) => {
    const clip = clipMs[i] ?? 0;
    const begin = cursor;
    const end = begin + clip;
    placements.push({ paragraph_id: p.paragraph_id, begin_ms: begin, clip_ms: clip, available_ms: clip, atempo: 1, end_ms: end });
    out.push({ ...p, begin_time: begin, end_time: end });
    cursor = end + gap;
  });
  const totalMs = out.length > 0 ? out[out.length - 1]!.end_time : 0;
  return { placements, paragraphs: out, totalMs };
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
