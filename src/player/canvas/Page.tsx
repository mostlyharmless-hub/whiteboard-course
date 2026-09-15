import type { CardState, MarkState, PageState } from "../../shared/reducer";
import { Column } from "./Column";

export interface PageProps {
  page: PageState;
  pageIndex: number;
  cards: Record<string, CardState>;
  t: number;
  marks: MarkState[];
  registerEl: (id: string, el: HTMLElement | null) => void;
}

/** 一块 1600 × 900 的白板页：米白底 + 点阵，内含至多 3 栏 */
export function Page({ page, pageIndex, cards, t, marks, registerEl }: PageProps) {
  return (
    <div className="page" data-page-index={pageIndex}>
      {page.columns.map((col, i) => (
        <Column key={i} index={i} pageIndex={pageIndex} cardIds={col.cards} cards={cards} t={t} marks={marks} registerEl={registerEl} />
      ))}
    </div>
  );
}
