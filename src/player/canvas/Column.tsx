import { useLayoutEffect, useRef } from "react";
import type { CardState, MarkState } from "../../shared/reducer";
import { Card } from "./Card";
import { PAGE, columnX } from "./layout";

interface ColumnProps {
  index: number;
  pageIndex: number;
  cardIds: string[];
  cards: Record<string, CardState>;
  t: number;
  marks: MarkState[];
  registerEl: (id: string, el: HTMLElement | null) => void;
}

/** 栏：卡片自上而下堆叠；实际高度超出 804 时整体缩放到容纳为止（兜底，生成器预算是第一道防线） */
export function Column({ index, pageIndex, cardIds, cards, t, marks, registerEl }: ColumnProps) {
  const ref = useRef<HTMLDivElement>(null);
  const warned = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const h = el.scrollHeight;
      if (h > PAGE.COL_MAX_H) {
        el.style.transform = `scale(${PAGE.COL_MAX_H / h})`;
        if (!warned.current) {
          warned.current = true;
          console.warn(`栏高超出 ${PAGE.COL_MAX_H}，已缩放`, { page: pageIndex, column: index, height: h });
        }
      } else {
        el.style.transform = "";
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [cardIds, index, pageIndex]);

  return (
    <div ref={ref} className="column" style={{ left: columnX(index), top: PAGE.PAD, width: PAGE.COL_W }}>
      {cardIds.map((id) => {
        const card = cards[id];
        if (!card) return null;
        return <Card key={id} card={card} t={t} marks={marks.filter((m) => m.target_card_id === id)} registerEl={registerEl} />;
      })}
    </div>
  );
}
