import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardScript } from "../shared/schema";
import { paragraphAt, sectionAt, sentenceAt } from "../shared/lookup";
import { useClock } from "./clock/useClock";
import { useBoardState } from "./state/useBoardState";
import { PanZoom, type PanZoomHandle } from "./canvas/PanZoom";
import { Page } from "./canvas/Page";
import { PAGE } from "./canvas/layout";
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

export function App({ script, audioUrl, initialT = 0 }: AppProps) {
  const clock = useClock({ audioUrl, duration: script.meta.duration_ms, initialT });
  const state = useBoardState(script.actions, clock.t);

  const [viewPage, setViewPage] = useState(0);
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

  // 视图页变化 → 整页可见
  useEffect(() => {
    if (pageCount === 0) return;
    const raf = requestAnimationFrame(() => panRef.current?.fitRect(PAGE_RECT));
    return () => cancelAnimationFrame(raf);
  }, [shownPage, pageCount]);

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

  // 窗口尺寸变化 → 重新适配整页
  useEffect(() => {
    const onResize = () => panRef.current?.fitRect(PAGE_RECT, false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

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
      panRef.current?.fitRect(PAGE_RECT);
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
