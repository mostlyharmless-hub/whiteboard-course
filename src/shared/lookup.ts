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

/** 最后一个 begin_ms <= t 的小节；早于首节返回 null */
export function sectionAt(sections: Section[], t: number): Section | null {
  const i = lastIndexAtOrBefore(sections, t, (s) => s.begin_ms);
  return sections[i] ?? null;
}
