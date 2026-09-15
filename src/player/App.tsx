import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardScript } from "../shared/schema";
import { paragraphAt, sectionAt, sentenceAt } from "../shared/lookup";
import { useClock } from "./clock/useClock";
import { useBoardState } from "./state/useBoardState";
import { PanZoom, type PanZoomHandle } from "./canvas/PanZoom";
import { Page } from "./canvas/Page";
import { PAGE, columnX } from "./canvas/layout";
import { TopBar } from "./ui/TopBar";
import { Sidebar } from "./ui/Sidebar";
import { BottomBar } from "./ui/BottomBar";
import { Subtitle } from "./ui/Subtitle";

interface AppProps {
  script: BoardScript;
  audioUrl: string | null;
  /** 初始定位（毫秒），来自 URL 参数 t；用于调试与端到端截图 */
  initialT?: number;
}

const FOLLOW_PAUSE_MS = 8000;
const PAGE_RECT = { x: 0, y: 0, w: PAGE.W, h: PAGE.H };
/** 整页适配后的比例低于此值时，文字太小，改为聚焦当前栏 */
const MIN_READABLE_SCALE = 0.5;

/** 一栏（含左右各 24 的留白）在 world 坐标系中的矩形 */
function columnRect(column: number) {
  return { x: columnX(Math.max(0, column)) - 24, y: 0, w: PAGE.COL_W + 48, h: PAGE.H };
}

export function App({ script, audioUrl, initialT = 0 }: AppProps) {
  const clock = useClock({ audioUrl, duration: script.meta.duration_ms, initialT });
  const state = useBoardState(script.actions, clock.t);

  // 初始值取当前页：带 ?t= 打开时首屏可能已经在第 N 页
  const [viewPage, setViewPage] = useState(Math.max(0, state.currentPage));
  const [follow, setFollow] = useState(true);
  const [scale, setScale] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [subtitleOn, setSubtitleOn] = useState(true);
  const pausedUntil = useRef(0);
  const panRef = useRef<PanZoomHandle>(null);
  const cardEls = useRef(new Map<string, HTMLElement>());

  const registerEl = useCallback((id: string, el: HTMLElement | null) => {
    if (el) cardEls.current.set(id, el);
    else cardEls.current.delete(id);
  }, []);

  // 播放中翻页 → 视图跟到当前页（渲染期调整状态，避免多一次 effect 渲染）
  const [trackedPage, setTrackedPage] = useState(state.currentPage);
  if (state.currentPage !== trackedPage) {
    setTrackedPage(state.currentPage);
    if (state.currentPage >= 0) setViewPage(state.currentPage);
  }

  const pageCount = state.pages.length;
  const shownPage = Math.max(0, Math.min(viewPage, pageCount - 1));
  const page = state.pages[shownPage];
  const isCurrent = shownPage === state.currentPage;

  // 优先整页可见；页放不进视口（比例过小）时聚焦当前栏
  const focusPage = useCallback((column: number, animate = true) => {
    const pan = panRef.current;
    if (!pan) return;
    if (pan.fitScale(PAGE_RECT) >= MIN_READABLE_SCALE) pan.fitRect(PAGE_RECT, animate);
    else pan.fitRect(columnRect(column), animate);
  }, []);

  // 视图页变化 → 适配该页
  useEffect(() => {
    if (pageCount === 0) return;
    const raf = requestAnimationFrame(() => focusPage(isCurrent ? state.currentColumn : 0));
    return () => cancelAnimationFrame(raf);
    // 只在页变化时适配；栏变化由新卡片的 ensureVisible 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownPage, pageCount, focusPage]);

  // 新卡片出现 → 相机确保可见（跟随开启且未被用户操作暂停）
  useEffect(() => {
    const action = script.actions[state.applied - 1];
    if (!action || (action.type !== "board" && action.type !== "mermaid")) return;
    if (!follow || Date.now() < pausedUntil.current) return;
    const raf = requestAnimationFrame(() => {
      const el = cardEls.current.get(action.card_id);
      const pan = panRef.current;
      if (el && pan) pan.ensureVisible(pan.worldRectOf(el));
    });
    return () => cancelAnimationFrame(raf);
  }, [script.actions, state.applied, follow]);

  // 窗口尺寸变化 → 重新适配
  useEffect(() => {
    const onResize = () => focusPage(state.currentColumn, false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [focusPage, state.currentColumn]);

  // 键盘：空格播放/暂停，左右键 ±5 秒
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === "SELECT") return;
      if (e.code === "Space") {
        e.preventDefault();
        clock.toggle();
      } else if (e.code === "ArrowLeft") {
        clock.seek(clock.t - 5000);
      } else if (e.code === "ArrowRight") {
        clock.seek(clock.t + 5000);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clock]);

  const onUserInteract = useCallback(() => {
    pausedUntil.current = Date.now() + FOLLOW_PAUSE_MS;
  }, []);

  const onFollow = (v: boolean) => {
    setFollow(v);
    if (v) {
      pausedUntil.current = 0;
      focusPage(state.currentColumn);
    }
  };

  const section = sectionAt(script.sections, clock.t);
  const paragraph = paragraphAt(script.paragraphs, clock.t);

  return (
    <div className="app">
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <filter id="wobble" x="-15%" y="-15%" width="130%" height="130%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <TopBar
        title={script.meta.title}
        scale={scale}
        onZoom={(f) => panRef.current?.zoomBy(f)}
        onReset={() => panRef.current?.reset()}
        pageIndex={shownPage}
        pageCount={pageCount}
        pageTitle={page?.title ?? null}
        onPage={setViewPage}
        follow={follow}
        onFollow={onFollow}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
      />
      <Sidebar sections={script.sections} currentId={section?.id ?? null} open={sidebarOpen} onJump={clock.seek} />
      <main className="stage">
        <PanZoom ref={panRef} onUserInteract={onUserInteract} onScaleChange={setScale}>
          {page && (
            <Page
              key={shownPage}
              page={page}
              pageIndex={shownPage}
              cards={state.cards}
              t={clock.t}
              marks={isCurrent ? state.marks : []}
              registerEl={registerEl}
            />
          )}
        </PanZoom>
        {subtitleOn && <Subtitle text={paragraph ? sentenceAt(paragraph, clock.t) : null} />}
      </main>
      <BottomBar clock={clock} sections={script.sections} subtitleOn={subtitleOn} onSubtitle={setSubtitleOn} />
    </div>
  );
}
