import { useLayoutEffect, useState, type RefObject } from "react";
import type { MarkState } from "../../shared/reducer";
import { locateSnippet, rectsOf, type LocalRect } from "../render/reveal";
import { seededRandom } from "./layout";

interface MarksProps {
  marks: MarkState[];
  t: number;
  units: HTMLElement[];
  containerRef: RefObject<HTMLDivElement | null>;
}

const HIGHLIGHT_MS = 400;
const CIRCLE_MS = 600;
const FADE_MS = 300;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 高亮 / 画圈 overlay：在卡片纯文本中定位 snippet，按 t 计算绘制进度与淡出 */
export function Marks({ marks, t, units, containerRef }: MarksProps) {
  const [located, setLocated] = useState<Map<string, LocalRect[]>>(new Map());
  const [fontsVersion, setFontsVersion] = useState(0);
  const idsKey = marks.map((m) => m.id).join(",");

  // 字体异步加载会改变排版，加载完成后重新定位
  useLayoutEffect(() => {
    let alive = true;
    void document.fonts.ready.then(() => {
      if (alive) setFontsVersion((v) => v + 1);
    });
    return () => {
      alive = false;
    };
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || units.length === 0 || marks.length === 0) {
      setLocated(new Map());
      return;
    }
    const next = new Map<string, LocalRect[]>();
    for (const m of marks) {
      const range = locateSnippet(units, m.snippet);
      if (!range) {
        console.warn(`标注 ${m.id} 的 snippet 未在卡片 ${m.target_card_id} 中找到：${m.snippet}`);
        continue;
      }
      next.set(m.id, rectsOf(units, range, container));
    }
    setLocated(next);
    // marks 数组每帧都是新引用，用 id 串做依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, idsKey, fontsVersion, containerRef]);

  if (marks.length === 0) return null;

  return (
    <svg className="marks" aria-hidden="true">
      {marks.map((m) => {
        const rects = located.get(m.id);
        if (!rects || rects.length === 0) return null;
        const alpha = clamp01((m.until - t) / FADE_MS);
        if (m.kind === "highlight") {
          const draw = clamp01((t - m.at) / HIGHLIGHT_MS);
          return (
            <g key={m.id} opacity={alpha}>
              {rects.map((r, i) => {
                const cx = r.x + r.w / 2;
                const cy = r.y + r.h / 2;
                return (
                  <rect
                    key={i}
                    x={r.x - 4}
                    y={r.y + r.h * 0.12}
                    width={(r.w + 8) * draw}
                    height={r.h * 0.8}
                    rx={3}
                    fill="var(--hl)"
                    transform={`rotate(-0.6 ${cx} ${cy})`}
                  />
                );
              })}
            </g>
          );
        }
        const p = (t - m.at) / CIRCLE_MS;
        const box = union(rects);
        const [d1, d2] = circlePaths(box, m.id);
        return (
          <g key={m.id} opacity={alpha} fill="none" stroke="var(--circle)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d={d1} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - clamp01(p * 2)} />
            <path d={d2} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - clamp01(p * 2 - 1)} />
          </g>
        );
      })}
    </svg>
  );
}

function union(rects: LocalRect[]): LocalRect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** 两圈略错位的手绘椭圆，起点与半径带确定性抖动 */
function circlePaths(box: LocalRect, seed: string): [string, string] {
  const rnd = seededRandom(seed);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rx = box.w / 2 + 10;
  const ry = Math.max(14, box.h / 2 + 7);
  const loop = (rxx: number, ryy: number, start: number) => {
    const n = 60;
    const pts: string[] = [];
    for (let i = 0; i <= n; i++) {
      const a = start + (i / n) * Math.PI * 2 * 1.04;
      const jx = (rnd() - 0.5) * 3;
      const jy = (rnd() - 0.5) * 3;
      const x = cx + Math.cos(a) * rxx + jx;
      const y = cy + Math.sin(a) * ryy + jy;
      pts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return pts.join(" ");
  };
  const start = Math.PI * 0.9 + rnd() * 0.4;
  return [loop(rx, ry, start), loop(rx + 4, ry - 2, start + 0.5)];
}
