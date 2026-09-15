import type { Action, Paragraph } from "../shared/schema";

/** 翻页最多比该段语音提前多少进入（只能提前进静默，不打断上一段） */
export const PRE_SPEECH_LEAD_MS = 2000;

export interface TimelineFix {
  actions: Action[];
  /** 人可读的修改记录，进报告 */
  changes: string[];
}

/**
 * 保证"有语音时白板不为空"（ADR 005）：
 * 1. new_page 若锚在某段开头，允许提前进入前面的静默，最多 PRE_SPEECH_LEAD_MS，且不早于上一段结束；
 * 2. 翻页后到第一张卡片之间的动作（分栏、卡片本身）一律提前到 new_page 时刻，让新页一开就有字在写。
 */
export function ensureBoardNotEmpty(actions: Action[], paragraphs: Paragraph[]): TimelineFix {
  const out: Action[] = actions.map((a) => ({ ...a }));
  const changes: string[] = [];
  const byId = new Map(paragraphs.map((p, i) => [p.paragraph_id, i]));

  for (let i = 0; i < out.length; i++) {
    const page = out[i]!;
    if (page.type !== "new_page") continue;

    const pi = byId.get(page.anchor.paragraph_id);
    const p = pi === undefined ? undefined : paragraphs[pi];
    if (p && page.at <= p.begin_time) {
      const prevEnd = pi !== undefined && pi > 0 ? paragraphs[pi - 1]!.end_time : 0;
      const prevActionAt = i > 0 ? out[i - 1]!.at : 0;
      const leadAt = Math.max(prevEnd, p.begin_time - PRE_SPEECH_LEAD_MS, prevActionAt, 0);
      if (leadAt < page.at) {
        changes.push(`${page.id} new_page「${page.title}」提前 ${page.at - leadAt} ms 到 ${leadAt}（进入语音前的静默）`);
        page.at = leadAt;
      }
    }

    // 翻页后到第一张卡片：全部提前到翻页时刻
    for (let k = i + 1; k < out.length; k++) {
      const a = out[k]!;
      if (a.type === "new_page") break;
      if (a.at > page.at) {
        changes.push(`${a.id} ${a.type}${a.type === "board" || a.type === "mermaid" ? `（卡片 ${a.card_id}）` : ""}提前 ${a.at - page.at} ms 到 ${page.at}（随翻页同时落笔）`);
        a.at = page.at;
      }
      if (a.type === "board" || a.type === "mermaid") break;
    }
  }
  return { actions: out, changes };
}

export interface EmptyInterval {
  paragraph_id: string;
  from: number;
  to: number;
}

/** 有语音（段落窗口内）但当前页没有任何卡片的区间，用于报告与验收 */
export function emptyBoardIntervals(actions: Action[], paragraphs: Paragraph[]): EmptyInterval[] {
  // 页上"出现第一张卡"的时刻序列：翻页清空，卡片填充
  const events: { at: number; hasCard: boolean }[] = [];
  let hasCard = false;
  for (const a of actions) {
    if (a.type === "new_page") {
      hasCard = false;
      events.push({ at: a.at, hasCard: false });
    } else if ((a.type === "board" || a.type === "mermaid") && !hasCard) {
      hasCard = true;
      events.push({ at: a.at, hasCard: true });
    }
  }
  const hasCardAt = (t: number): boolean => {
    let state = false;
    for (const e of events) {
      if (e.at > t) break;
      state = e.hasCard;
    }
    return state;
  };
  const result: EmptyInterval[] = [];
  for (const p of paragraphs) {
    // 段内按事件切分，找出无卡片的子区间
    const cuts = [p.begin_time, ...events.map((e) => e.at).filter((t) => t > p.begin_time && t < p.end_time), p.end_time];
    for (let i = 0; i < cuts.length - 1; i++) {
      const from = cuts[i]!;
      const to = cuts[i + 1]!;
      if (to - from <= 0) continue;
      if (!hasCardAt(from)) {
        const last = result[result.length - 1];
        if (last && last.paragraph_id === p.paragraph_id && last.to === from) last.to = to;
        else result.push({ paragraph_id: p.paragraph_id, from, to });
      }
    }
  }
  return result;
}

export function totalEmptyMs(intervals: EmptyInterval[]): number {
  return intervals.reduce((n, i) => n + (i.to - i.from), 0);
}
