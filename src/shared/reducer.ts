import type { Action } from "./schema";

export interface CardState {
  id: string;
  kind: "board" | "mermaid";
  at: number;
  reveal_ms: number;
  /** board：Markdown；mermaid：源码 */
  content: string;
  title?: string;
  page: number;
  column: number;
}
export interface ColumnState {
  cards: string[];
}
export interface PageState {
  title: string;
  columns: ColumnState[];
}
export interface MarkState {
  id: string;
  kind: "highlight" | "circle";
  target_card_id: string;
  snippet: string;
  at: number;
  until: number;
  page: number;
}
export interface BoardState {
  pages: PageState[];
  cards: Record<string, CardState>;
  currentPage: number;
  currentColumn: number;
  /** 已触发且未被翻页清除的标注；是否仍活动由 until 与 t 决定 */
  marks: MarkState[];
  /** 已应用的动作数 */
  applied: number;
}

export const initialState: BoardState = {
  pages: [],
  cards: {},
  currentPage: -1,
  currentColumn: -1,
  marks: [],
  applied: 0,
};

function withCard(state: BoardState, card: CardState): BoardState {
  const pages = state.pages.map((p, pi) =>
    pi !== state.currentPage
      ? p
      : { ...p, columns: p.columns.map((c, ci) => (ci !== state.currentColumn ? c : { cards: [...c.cards, card.id] })) },
  );
  return { ...state, pages, cards: { ...state.cards, [card.id]: card } };
}

/** 纯函数：返回新状态，不修改输入 */
export function apply(state: BoardState, action: Action): BoardState {
  const applied = state.applied + 1;
  switch (action.type) {
    case "new_page":
      return {
        ...state,
        pages: [...state.pages, { title: action.title, columns: [{ cards: [] }] }],
        currentPage: state.pages.length,
        currentColumn: 0,
        marks: [],
        applied,
      };
    case "new_column": {
      if (state.currentPage < 0) throw new Error(`动作 ${action.id}：尚无页面，不能 new_column`);
      const pages = state.pages.map((p, pi) => (pi !== state.currentPage ? p : { ...p, columns: [...p.columns, { cards: [] }] }));
      return { ...state, pages, currentColumn: pages[state.currentPage]!.columns.length - 1, applied };
    }
    case "board":
    case "mermaid": {
      if (state.currentPage < 0) throw new Error(`动作 ${action.id}：尚无页面，不能写卡片`);
      const card: CardState = {
        id: action.card_id,
        kind: action.type,
        at: action.at,
        reveal_ms: action.reveal_ms,
        content: action.type === "board" ? action.content : action.code,
        page: state.currentPage,
        column: state.currentColumn,
      };
      if (action.type === "mermaid" && action.title !== undefined) card.title = action.title;
      return { ...withCard(state, card), applied };
    }
    case "highlight":
    case "circle": {
      const target = state.cards[action.target_card_id];
      if (!target) throw new Error(`动作 ${action.id}：目标卡片 ${action.target_card_id} 不存在`);
      const mark: MarkState = {
        id: action.id,
        kind: action.type,
        target_card_id: action.target_card_id,
        snippet: action.snippet,
        at: action.at,
        until: action.until,
        page: target.page,
      };
      return { ...state, marks: [...state.marks, mark], applied };
    }
  }
}

/** at <= t 的动作数（actions 按 at 升序） */
export function countApplied(actions: Action[], t: number): number {
  let lo = 0;
  let hi = actions.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (actions[mid]!.at <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** at <= t < until 的标注 */
export function activeMarks(marks: MarkState[], t: number): MarkState[] {
  return marks.filter((m) => m.at <= t && t < m.until);
}

/** 时刻 t 的板书状态：从头折叠 at <= t 的动作，再去掉已到 until 的标注 */
export function stateAt(actions: Action[], t: number): BoardState {
  const n = countApplied(actions, t);
  let s = initialState;
  for (let i = 0; i < n; i++) s = apply(s, actions[i]!);
  return { ...s, marks: s.marks.filter((m) => m.until > t) };
}

/** 揭示进度 clamp((t - at) / reveal_ms, 0, 1) */
export function revealProgress(card: CardState, t: number): number {
  const p = (t - card.at) / card.reveal_ms;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}
