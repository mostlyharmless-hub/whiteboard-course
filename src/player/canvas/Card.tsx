import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { revealProgress, type CardState, type MarkState } from "../../shared/reducer";
import { renderMarkdown } from "../render/markdown";
import { renderMermaid } from "../render/mermaid";
import { rectOfUnit, setRevealed, splitChars } from "../render/reveal";
import { hashRotation } from "./layout";
import { Marks } from "./Marks";

interface CardProps {
  card: CardState;
  t: number;
  marks: MarkState[];
  registerEl: (id: string, el: HTMLElement | null) => void;
}

const EMPTY: HTMLElement[] = [];

/** 板书卡片：board 逐字揭示，mermaid 整体淡入；按 card_id 微旋转 */
export function Card({ card, t, marks, registerEl }: CardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const penRef = useRef<HTMLDivElement>(null);
  const [units, setUnits] = useState<HTMLElement[]>(EMPTY);
  const [svg, setSvg] = useState<string | null>(null);
  const html = useMemo(() => (card.kind === "board" ? renderMarkdown(card.content) : ""), [card.kind, card.content]);
  const progress = revealProgress(card, t);

  // board：渲染后把字符拆成单元
  useLayoutEffect(() => {
    if (card.kind !== "board" || !bodyRef.current) return;
    setUnits(splitChars(bodyRef.current));
  }, [card.kind, html]);

  // mermaid：异步渲染，先占位再替换
  useEffect(() => {
    if (card.kind !== "mermaid") return;
    let alive = true;
    void renderMermaid(card.id, card.content).then((s) => {
      if (alive) setSvg(s);
    });
    return () => {
      alive = false;
    };
  }, [card.kind, card.id, card.content]);

  // 每帧按 progress 揭示，并移动笔尖
  useLayoutEffect(() => {
    if (card.kind !== "board" || units.length === 0) return;
    const shown = Math.floor(progress * units.length);
    setRevealed(units, shown);
    const pen = penRef.current;
    const root = ref.current;
    if (!pen || !root) return;
    if (progress >= 1) {
      pen.style.display = "none";
      return;
    }
    pen.style.display = "";
    const unit = units[Math.max(0, shown - 1)];
    if (!unit) return;
    const r = rectOfUnit(unit, root);
    const x = shown === 0 ? r.x : r.x + r.w;
    pen.style.transform = `translate(${x}px, ${r.y + r.h * 0.15}px)`;
  }, [card.kind, units, progress]);

  useLayoutEffect(() => {
    registerEl(card.id, ref.current);
    return () => registerEl(card.id, null);
  }, [card.id, registerEl]);

  const style = { "--rot": `${hashRotation(card.id)}deg` } as CSSProperties;

  return (
    <div ref={ref} className={`card card-${card.kind}`} style={style} data-card-id={card.id}>
      <div className="card-frame" />
      {card.kind === "board" ? (
        <div ref={bodyRef} className="card-body" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="card-body mermaid-body" style={{ opacity: progress }}>
          {card.title !== undefined && <div className="mermaid-title">{card.title}</div>}
          {svg !== null ? <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="mermaid-placeholder">绘制中…</div>}
        </div>
      )}
      {card.kind === "board" && (
        <div ref={penRef} className="pen" aria-hidden="true">
          <svg viewBox="0 0 20 20" width="20" height="20">
            <path d="M3 17 L13 7 L16 10 L6 20 Z" fill="#1e1e1e" />
            <path d="M14 6 L17 3 L20 6 L17 9 Z" fill="#7a5c2e" />
            <circle cx="4" cy="18" r="1.4" fill="#1e1e1e" />
          </svg>
        </div>
      )}
      <Marks marks={marks} t={t} units={units} containerRef={ref} />
    </div>
  );
}
