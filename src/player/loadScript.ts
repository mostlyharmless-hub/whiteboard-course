import { parseScript, type ParseResult } from "../shared/schema";

/** URL 参数：?script=<脚本路径>&audio=<音频路径>&t=<初始毫秒>；无 audio 时进入计时器模式 */
export function readParams(): { script: string; audio: string | null; t: number } {
  const q = new URLSearchParams(location.search);
  const t = Number(q.get("t") ?? "0");
  return { script: q.get("script") ?? "tests/fixtures/demo.script.json", audio: q.get("audio"), t: Number.isFinite(t) && t > 0 ? t : 0 };
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
