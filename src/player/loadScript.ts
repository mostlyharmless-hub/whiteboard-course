import { parseScript, type ParseResult } from "../shared/schema";

export interface Params {
  script: string;
  audio: string | null;
  /** 初始定位，毫秒 */
  t: number;
  /** 渲染模式：隐藏界面、相机瞬移、暴露 window.__player */
  render: boolean;
  /** 覆盖字幕文本的讲解稿（如 TTS 配音版，文本已纠错） */
  subtitles: string | null;
}

/** URL 参数：?script=<脚本>&audio=<音频>&t=<毫秒>&render=1&subtitles=<讲解稿>；无 audio 时进入计时器模式 */
export function readParams(): Params {
  const q = new URLSearchParams(location.search);
  const t = Number(q.get("t") ?? "0");
  return {
    script: q.get("script") ?? "tests/fixtures/demo.script.json",
    audio: q.get("audio"),
    t: Number.isFinite(t) && t > 0 ? t : 0,
    render: q.get("render") === "1",
    subtitles: q.get("subtitles"),
  };
}

/** 从讲解稿 JSON（{data:{paragraphs}} / {paragraphs} / 数组）取 paragraph_id → text */
export async function loadSubtitles(url: string): Promise<Map<string, string>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载字幕 ${url} 失败：HTTP ${res.status}`);
  const json = (await res.json()) as { data?: { paragraphs?: unknown }; paragraphs?: unknown } | unknown[];
  const list = Array.isArray(json) ? json : (json.data?.paragraphs ?? json.paragraphs);
  if (!Array.isArray(list)) throw new Error(`字幕文件 ${url} 里没有 paragraphs`);
  const map = new Map<string, string>();
  for (const p of list as { paragraph_id?: unknown; text?: unknown }[]) {
    if (typeof p.paragraph_id === "string" && typeof p.text === "string") map.set(p.paragraph_id, p.text);
  }
  return map;
}

export async function loadScript(url: string): Promise<ParseResult> {
  let json: unknown;
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, issues: [{ path: [], message: `加载 ${url} 失败：HTTP ${res.status}` }] };
    json = await res.json();
  } catch (e) {
    return { ok: false, issues: [{ path: [], message: `加载 ${url} 失败：${(e as Error).message}` }] };
  }
  return parseScript(json);
}
