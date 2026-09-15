import { parseScript, type ParseResult } from "../shared/schema";

/** URL 参数：?script=<脚本路径>&audio=<音频路径>；无 audio 时进入计时器模式 */
export function readParams(): { script: string; audio: string | null } {
  const q = new URLSearchParams(location.search);
  return { script: q.get("script") ?? "tests/fixtures/demo.script.json", audio: q.get("audio") };
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
