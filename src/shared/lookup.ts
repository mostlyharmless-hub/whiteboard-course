import type { Paragraph, Section } from "./schema";

/** 最后一个 key(item) <= t 的下标；无则 -1（items 按 key 升序） */
function lastIndexAtOrBefore<T>(items: T[], t: number, key: (item: T) => number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(items[mid]!) <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** begin_time <= t < end_time 的段落；段落间隙返回 null */
export function paragraphAt(paragraphs: Paragraph[], t: number): Paragraph | null {
  const i = lastIndexAtOrBefore(paragraphs, t, (p) => p.begin_time);
  const p = paragraphs[i];
  return p && t < p.end_time ? p : null;
}

const SENTENCE_END = /[。！？；!?;]/;

/**
 * 段落内时刻 t 正在说的那一句：按句末标点切句，段内时间按字符位置线性插值
 * （与生成器换算锚点时间的规则一致）。t 不在段内返回 null。
 */
export function sentenceAt(paragraph: Paragraph, t: number): string | null {
  const { text, begin_time, end_time } = paragraph;
  if (t < begin_time || t >= end_time || text.length === 0) return null;
  const ratio = (t - begin_time) / (end_time - begin_time);
  const pos = Math.min(text.length - 1, Math.floor(ratio * text.length));
  let start = pos;
  while (start > 0 && !SENTENCE_END.test(text[start - 1]!)) start--;
  let end = pos;
  while (end < text.length && !SENTENCE_END.test(text[end]!)) end++;
  return text.slice(start, Math.min(text.length, end + 1)).trim() || null;
}

/** 最后一个 begin_ms <= t 的小节；早于首节返回 null */
export function sectionAt(sections: Section[], t: number): Section | null {
  const i = lastIndexAtOrBefore(sections, t, (s) => s.begin_ms);
  return sections[i] ?? null;
}
