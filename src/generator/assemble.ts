import { plainText } from "../shared/budget";
import type { Action } from "../shared/schema";
import type { LocalAction, SectionResult } from "./types";

export interface CardSummary {
  id: string;
  summary: string;
}

/** 当前页 / 栏占用情况：校验器用它做自动分栏翻页，提示词用它告诉模型白板现状 */
export interface LayoutState {
  hasPage: boolean;
  columns: number;
  cardsInColumn: number;
  pageCards: CardSummary[];
}

export const initialLayout: LayoutState = { hasPage: false, columns: 0, cardsInColumn: 0, pageCards: [] };

export function summarizeCard(a: LocalAction | Action): string {
  if (a.type === "mermaid") return `流程图${a.title ? `「${a.title}」` : ""}`;
  if (a.type !== "board") return "";
  const first = plainText(a.content).split("\n")[0] ?? "";
  return first.length > 40 ? `${first.slice(0, 40)}…` : first;
}

/** 模拟一条动作后的布局（纯函数） */
export function stepLayout(l: LayoutState, a: LocalAction | Action): LayoutState {
  switch (a.type) {
    case "new_page":
      return { hasPage: true, columns: 1, cardsInColumn: 0, pageCards: [] };
    case "new_column":
      return { ...l, columns: l.columns + 1, cardsInColumn: 0 };
    case "board":
    case "mermaid":
      return { ...l, cardsInColumn: l.cardsInColumn + 1, pageCards: [...l.pageCards, { id: a.card_id, summary: summarizeCard(a) }] };
    default:
      return l;
  }
}

/** 注入提示词 {{board_state}} 的中文描述 */
export function boardStateSummary(l: LayoutState): string {
  if (!l.hasPage) return "尚无页面：本节第一条动作必须是 new_page。";
  const lines = [`当前页已有 ${l.columns} 栏（上限 3），当前栏已有 ${l.cardsInColumn} 张卡片（上限 3）。`];
  if (l.pageCards.length > 0) {
    lines.push("当前页已有的卡片（不要重复写同样的内容；这些卡片不能被本节标注）：");
    for (const c of l.pageCards) lines.push(`- ${c.id}：${c.summary}`);
  }
  return lines.join("\n");
}

/** 合并各节：动作 id a001… 全局递增，卡片 id c01… 全局递增，节内 target_card_id 同步映射 */
export function assemble(results: SectionResult[]): Action[] {
  const out: Action[] = [];
  let actionSeq = 0;
  let cardSeq = 0;
  for (const r of results) {
    const cardMap = new Map<string, string>();
    for (const a of r.actions) {
      const id = `a${String(++actionSeq).padStart(3, "0")}`;
      switch (a.type) {
        case "board":
        case "mermaid": {
          const gid = `c${String(++cardSeq).padStart(2, "0")}`;
          cardMap.set(a.card_id, gid);
          out.push({ ...a, id, card_id: gid });
          break;
        }
        case "highlight":
        case "circle":
          out.push({ ...a, id, target_card_id: cardMap.get(a.target_card_id) ?? a.target_card_id });
          break;
        default:
          out.push({ ...a, id });
      }
    }
  }
  return out;
}
