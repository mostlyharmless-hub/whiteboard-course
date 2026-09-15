import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from "react";
import { PAGE } from "./layout";

/** world 坐标系（页逻辑像素）中的矩形 */
export interface WorldRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PanZoomHandle {
  /** 把矩形完整放进视口并居中 */
  fitRect(r: WorldRect, animate?: boolean): void;
  /** 矩形已在视口内则不动；能放下则最小平移；否则 fitRect */
  ensureVisible(r: WorldRect): void;
  /** DOM 元素在 world 坐标系中的矩形 */
  worldRectOf(el: HTMLElement): WorldRect;
  /** 以视口中心为基准缩放 */
  zoomBy(factor: number): void;
  /** 复位：整页可见 */
  reset(): void;
  getScale(): number;
  /** 把矩形完整放进视口所需的缩放比例（不改变相机） */
  fitScale(r: WorldRect): number;
}

interface Props {
  children: ReactNode;
  /** 用户滚轮 / 拖拽时触发（用于暂停相机跟随） */
  onUserInteract?: () => void;
  onScaleChange?: (scale: number) => void;
  /** 渲染模式：所有相机移动瞬间完成，不做 300 ms 动画（逐帧截图时不能依赖墙钟） */
  instant?: boolean;
}

interface Camera {
  x: number;
  y: number;
  s: number;
}

const MIN_SCALE = 0.15;
const MAX_SCALE = 4;
const ANIM_MS = 300;
const MARGIN = 24;
const PAGE_RECT: WorldRect = { x: 0, y: 0, w: PAGE.W, h: PAGE.H };

/**
 * 自写平移 / 缩放容器：transform 作用于 world 层，相机状态存 ref、直接写样式，不经 React 状态。
 * screen = world × s + (x, y)
 */
export const PanZoom = forwardRef<PanZoomHandle, Props>(function PanZoom({ children, onUserInteract, onScaleChange, instant = false }, ref) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const cam = useRef<Camera>({ x: 0, y: 0, s: 1 });
  const anim = useRef<number | null>(null);
  /** 进行中动画的目标；连续缩放操作以它为基准叠加，而不是以中间态为基准 */
  const animTarget = useRef<Camera | null>(null);
  const lastReportedPct = useRef(-1);
  const interactRef = useRef(onUserInteract);
  const scaleChangeRef = useRef(onScaleChange);
  const instantRef = useRef(instant);
  interactRef.current = onUserInteract;
  scaleChangeRef.current = onScaleChange;
  instantRef.current = instant;

  const applyCamera = (c: Camera) => {
    cam.current = c;
    const world = worldRef.current;
    if (world) world.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.s})`;
    const pct = Math.round(c.s * 100);
    if (pct !== lastReportedPct.current) {
      lastReportedPct.current = pct;
      scaleChangeRef.current?.(c.s);
    }
  };

  const stopAnim = () => {
    if (anim.current !== null) cancelAnimationFrame(anim.current);
    anim.current = null;
    animTarget.current = null;
  };

  const animateTo = (target: Camera, animate: boolean) => {
    stopAnim();
    if (!animate || instantRef.current) {
      applyCamera(target);
      return;
    }
    animTarget.current = target;
    const from = { ...cam.current };
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ANIM_MS);
      const e = 1 - Math.pow(1 - p, 3);
      applyCamera({ x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, s: from.s + (target.s - from.s) * e });
      if (p < 1) {
        anim.current = requestAnimationFrame(step);
      } else {
        anim.current = null;
        animTarget.current = null;
      }
    };
    anim.current = requestAnimationFrame(step);
  };

  /** 连续操作的基准相机：有动画在飞则取其目标 */
  const baseCamera = () => animTarget.current ?? cam.current;

  const viewportSize = () => {
    const vp = viewportRef.current;
    return { vw: vp?.clientWidth ?? 1, vh: vp?.clientHeight ?? 1 };
  };

  const fitCamera = (r: WorldRect): Camera => {
    const { vw, vh } = viewportSize();
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(vw / r.w, vh / r.h) * 0.92));
    return { x: (vw - r.w * s) / 2 - r.x * s, y: (vh - r.h * s) / 2 - r.y * s, s };
  };

  useImperativeHandle(ref, () => ({
    fitRect(r, animate = true) {
      animateTo(fitCamera(r), animate);
    },
    ensureVisible(r) {
      const { x, y, s } = cam.current;
      const { vw, vh } = viewportSize();
      const sx = r.x * s + x;
      const sy = r.y * s + y;
      const sw = r.w * s;
      const sh = r.h * s;
      const inside = sx >= MARGIN && sy >= MARGIN && sx + sw <= vw - MARGIN && sy + sh <= vh - MARGIN;
      if (inside) return;
      if (sw <= vw - 2 * MARGIN && sh <= vh - 2 * MARGIN) {
        const dx = sx < MARGIN ? MARGIN - sx : sx + sw > vw - MARGIN ? vw - MARGIN - (sx + sw) : 0;
        const dy = sy < MARGIN ? MARGIN - sy : sy + sh > vh - MARGIN ? vh - MARGIN - (sy + sh) : 0;
        animateTo({ x: x + dx, y: y + dy, s }, true);
      } else {
        animateTo(fitCamera(r), true);
      }
    },
    worldRectOf(el) {
      const { x, y, s } = cam.current;
      const vp = viewportRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const r = el.getBoundingClientRect();
      return { x: (r.left - vp.left - x) / s, y: (r.top - vp.top - y) / s, w: r.width / s, h: r.height / s };
    },
    zoomBy(factor) {
      const { vw, vh } = viewportSize();
      animateTo(zoomAround(baseCamera(), factor, vw / 2, vh / 2), true);
    },
    reset() {
      animateTo(fitCamera(PAGE_RECT), true);
    },
    getScale() {
      return cam.current.s;
    },
    fitScale(r) {
      return fitCamera(r).s;
    },
  }));

  // 初始：整页可见
  useEffect(() => {
    applyCamera(fitCamera(PAGE_RECT));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 滚轮缩放（需要 non-passive 才能 preventDefault）
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopAnim();
      const rect = vp.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0015);
      applyCamera(zoomAround(cam.current, factor, e.clientX - rect.left, e.clientY - rect.top));
      interactRef.current?.();
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, []);

  // 拖拽平移
  const drag = useRef<{ id: number; startX: number; startY: number; camX: number; camY: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    stopAnim();
    drag.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, camX: cam.current.x, camY: cam.current.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.classList.add("dragging");
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) > 3) {
      d.moved = true;
      interactRef.current?.();
    }
    if (d.moved) applyCamera({ ...cam.current, x: d.camX + dx, y: d.camY + dy });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    e.currentTarget.classList.remove("dragging");
  };

  return (
    <div
      ref={viewportRef}
      className="viewport"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => animateTo(fitCamera(PAGE_RECT), true)}
    >
      <div ref={worldRef} className="world">
        {children}
      </div>
    </div>
  );
});

function zoomAround(c: Camera, factor: number, px: number, py: number): Camera {
  const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, c.s * factor));
  const k = s / c.s;
  return { x: px - (px - c.x) * k, y: py - (py - c.y) * k, s };
}
