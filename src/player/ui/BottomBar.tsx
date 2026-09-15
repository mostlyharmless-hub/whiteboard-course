import { useRef } from "react";
import type { Section } from "../../shared/schema";
import type { Clock } from "../clock/useClock";
import { formatTime } from "./format";

interface BottomBarProps {
  clock: Clock;
  sections: Section[];
  subtitleOn: boolean;
  onSubtitle: (v: boolean) => void;
}

const RATES = [0.75, 1, 1.25, 1.5, 2];

export function BottomBar({ clock, sections, subtitleOn, onSubtitle }: BottomBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const seekFromEvent = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    clock.seek(ratio * clock.duration);
  };

  const ratio = clock.duration > 0 ? clock.t / clock.duration : 0;

  return (
    <footer className="bottombar">
      <button className="btn play" onClick={clock.toggle} title={clock.playing ? "暂停" : "播放"}>
        {clock.playing ? "❚❚" : "▶"}
      </button>
      <div
        ref={trackRef}
        className="track"
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromEvent(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging.current) seekFromEvent(e.clientX);
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
      >
        <div className="track-fill" style={{ width: `${ratio * 100}%` }} />
        {sections.map((s) => (
          <div key={s.id} className="tick" style={{ left: `${(s.begin_ms / clock.duration) * 100}%` }} title={s.title} />
        ))}
        <div className="knob" style={{ left: `${ratio * 100}%` }} />
      </div>
      <span className="time">
        {formatTime(clock.t)} / {formatTime(clock.duration)}
      </span>
      <select className="rate" value={clock.rate} onChange={(e) => clock.setRate(Number(e.target.value))} title="倍速">
        {RATES.map((r) => (
          <option key={r} value={r}>
            {r}×
          </option>
        ))}
      </select>
      <button className={`btn toggle${subtitleOn ? " on" : ""}`} onClick={() => onSubtitle(!subtitleOn)}>
        字幕
      </button>
      <span className="mode">{clock.mode === "audio" ? "音频" : "计时器"}</span>
    </footer>
  );
}
