import { countChars, plainText } from "../shared/budget";
import type { Anchor, Paragraph } from "../shared/schema";
import type { RawAction } from "./raw";
import type { LocalAction, ValidationError } from "./types";

/** CLAUDE.md 6.4：老师先落笔再开口 */
export const LEAD_MS = 300;
export const SAME_AT_STEP_MS = 200;
export const REVEAL_MIN_MS = 600;
export const REVEAL_MAX_MS = 8000;
export const REVEAL_PER_CHAR_MS = 60;
export const MERMAID_REVEAL_MS = 800;
export const MARK_MIN_MS = 1500;

const STRIP_ONE = /[\s\p{P}\p{S}]/u;
const STRIP_ALL = /[\s\p{P}\p{S}]/gu;

/** 在原文中定位引用：先精确匹配，失败则两边去掉空白、标点与符号后匹配并映射回原下标 */
export function locate(text: string, quote: string): { index: number; exact: boolean } | null {
  const exact = text.indexOf(quote);
  if (exact >= 0) return { index: exact, exact: true };
  const keep: number[] = [];
  let stripped = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (STRIP_ONE.test(ch)) continue;
    keep.push(i);
    stripped += ch;
  }
  const target = quote.replace(STRIP_ALL, "");
  if (target === "") return null;
  const j = stripped.indexOf(target);
  if (j < 0) return null;
  return { index: keep[j]!, exact: false };
}

export interface ResolveCtx {
  paragraphById: Map<string, Paragraph>;
  /** 前一动作的 at；尚无动作时为 -1 */
  prevAt: number;
}

/** 锚点 → 毫秒；段落不存在抛错，引用找不到则按段首处理并返回警告 */
export function resolveAt(anchor: Anchor, ctx: ResolveCtx): { at: number; warning?: string } {
  const p = ctx.paragraphById.get(anchor.paragraph_id);
  if (!p) throw new Error(`锚点段落 ${anchor.paragraph_id} 不存在`);
  const loc = locate(p.text, anchor.quote);
  const idx = loc?.index ?? 0;
  const ratio = idx / p.text.length;
  const raw = p.begin_time + ratio * (p.end_time - p.begin_time) - LEAD_MS;
  let at = Math.round(Math.max(raw, p.begin_time, ctx.prevAt));
  if (at === ctx.prevAt) at += SAME_AT_STEP_MS;
  if (loc) return { at };
  return { at, warning: `锚点「${anchor.quote}」未在段落 ${anchor.paragraph_id} 中找到，按段首处理` };
}

export function revealMs(kind: "board" | "mermaid", content: string, at: number, p: Paragraph): number {
  if (kind === "mermaid") return MERMAID_REVEAL_MS;
  const chars = countChars(plainText(content));
  return Math.max(REVEAL_MIN_MS, Math.min(chars * REVEAL_PER_CHAR_MS, REVEAL_MAX_MS, p.end_time - at));
}

export function untilMs(at: number, p: Paragraph): number {
  return Math.max(p.end_time, at + MARK_MIN_MS);
}

export interface ResolvedSection {
  actions: LocalAction[];
  warnings: string[];
  errors: ValidationError[];
  lastAt: number;
}

/** 逐条换算一节的原始动作；锚点段落不存在的动作保留占位（at = prevAt）并记入 errors，便于打回时按下标报错 */
export function resolveSection(raw: RawAction[], ctx: ResolveCtx): ResolvedSection {
  const actions: LocalAction[] = [];
  const warnings: string[] = [];
  const errors: ValidationError[] = [];
  let prevAt = ctx.prevAt;
  raw.forEach((a, index) => {
    const p = ctx.paragraphById.get(a.anchor.paragraph_id);
    let at: number;
    if (!p) {
      errors.push({ index, message: `第 ${index + 1} 条动作的锚点段落 ${a.anchor.paragraph_id} 不存在` });
      at = Math.max(prevAt, 0);
    } else {
      const r = resolveAt(a.anchor, { paragraphById: ctx.paragraphById, prevAt });
      at = r.at;
      if (r.warning) warnings.push(`第 ${index + 1} 条动作：${r.warning}`);
    }
    const fallback: Paragraph = p ?? { paragraph_id: a.anchor.paragraph_id, text: "", begin_time: at, end_time: at };
    switch (a.type) {
      case "new_page":
        actions.push({ type: "new_page", title: a.title, at, anchor: a.anchor });
        break;
      case "new_column":
        actions.push({ type: "new_column", at, anchor: a.anchor });
        break;
      case "board":
        actions.push({ type: "board", card_id: a.card_id, content: a.content, reveal_ms: revealMs("board", a.content, at, fallback), at, anchor: a.anchor });
        break;
      case "mermaid": {
        const m: LocalAction = { type: "mermaid", card_id: a.card_id, code: a.code, reveal_ms: MERMAID_REVEAL_MS, at, anchor: a.anchor };
        if (a.title !== undefined) m.title = a.title;
        actions.push(m);
        break;
      }
      case "highlight":
      case "circle":
        actions.push({ type: a.type, target_card_id: a.target_card_id, snippet: a.snippet, until: untilMs(at, fallback), at, anchor: a.anchor });
        break;
    }
    prevAt = at;
  });
  return { actions, warnings, errors, lastAt: prevAt };
}
