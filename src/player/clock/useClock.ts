import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface Clock {
  /** 当前时刻，毫秒 */
  t: number;
  playing: boolean;
  rate: number;
  duration: number;
  mode: "audio" | "timer";
  play(): void;
  pause(): void;
  toggle(): void;
  seek(ms: number): void;
  setRate(r: number): void;
}

/**
 * 时钟源二选一：有音频时以 HTMLAudioElement.currentTime 为准，
 * 否则用内部计时器（base + 经过时间 × 倍速）。对外只暴露一个 t。
 */
export function useClock(opts: { audioUrl: string | null; duration: number }): Clock {
  const { audioUrl, duration } = opts;
  const mode: Clock["mode"] = audioUrl ? "audio" : "timer";
  const [t, setTState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRateState] = useState(1);
  const tRef = useRef(0);
  const rateRef = useRef(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timer = useRef({ base: 0, startedAt: 0 });

  const setT = useCallback((ms: number) => {
    tRef.current = ms;
    setTState(ms);
  }, []);

  useEffect(() => {
    if (!audioUrl) return;
    const audio = new Audio(audioUrl);
    audio.preload = "auto";
    audioRef.current = audio;
    const onEnded = () => setPlaying(false);
    const onError = () => console.error(`音频加载失败：${audioUrl}`);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.pause();
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audioRef.current = null;
    };
  }, [audioUrl]);

  // 播放中每帧刷新 t
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      if (mode === "audio") {
        const a = audioRef.current;
        if (a) setT(Math.min(duration, Math.round(a.currentTime * 1000)));
      } else {
        const { base, startedAt } = timer.current;
        const next = base + (performance.now() - startedAt) * rateRef.current;
        if (next >= duration) {
          setT(duration);
          setPlaying(false);
          return;
        }
        setT(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, mode, duration, setT]);

  const play = useCallback(() => {
    const from = tRef.current >= duration ? 0 : tRef.current;
    if (mode === "audio") {
      const a = audioRef.current;
      if (a) {
        if (tRef.current >= duration) a.currentTime = 0;
        void a.play().catch((e: unknown) => console.error("音频播放失败", e));
      }
    }
    timer.current = { base: from, startedAt: performance.now() };
    setPlaying(true);
  }, [mode, duration]);

  const pause = useCallback(() => {
    if (mode === "audio") audioRef.current?.pause();
    setPlaying(false);
  }, [mode]);

  const seek = useCallback(
    (ms: number) => {
      const clamped = Math.max(0, Math.min(duration, ms));
      if (mode === "audio" && audioRef.current) audioRef.current.currentTime = clamped / 1000;
      timer.current = { base: clamped, startedAt: performance.now() };
      setT(clamped);
    },
    [mode, duration, setT],
  );

  const setRate = useCallback(
    (r: number) => {
      if (mode === "audio" && audioRef.current) audioRef.current.playbackRate = r;
      timer.current = { base: tRef.current, startedAt: performance.now() };
      rateRef.current = r;
      setRateState(r);
    },
    [mode],
  );

  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);

  return useMemo<Clock>(
    () => ({ t, playing, rate, duration, mode, play, pause, toggle, seek, setRate }),
    [t, playing, rate, duration, mode, play, pause, toggle, seek, setRate],
  );
}
