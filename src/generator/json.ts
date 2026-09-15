export type JsonExtract = { ok: true; value: unknown } | { ok: false; error: string };

/** 从 LLM 文本中取出 JSON：剥离代码围栏；仍失败则取首个 [ / { 到最后一个 ] / } 之间的部分 */
export function extractJson(text: string): JsonExtract {
  const candidates: string[] = [];
  const trimmed = text.trim();
  candidates.push(trimmed);
  const fenced = /```[a-zA-Z]*\s*\n([\s\S]*?)\n\s*```/.exec(trimmed);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const firstArr = trimmed.indexOf("[");
  const firstObj = trimmed.indexOf("{");
  const starts = [firstArr, firstObj].filter((i) => i >= 0);
  if (starts.length > 0) {
    const start = Math.min(...starts);
    const closer = trimmed[start] === "[" ? "]" : "}";
    const end = trimmed.lastIndexOf(closer);
    if (end > start) candidates.push(trimmed.slice(start, end + 1));
  }
  let lastError = "空输出";
  for (const c of candidates) {
    if (c === "") continue;
    try {
      return { ok: true, value: JSON.parse(c) as unknown };
    } catch (e) {
      lastError = (e as Error).message;
    }
  }
  return { ok: false, error: `输出不是合法 JSON：${lastError}` };
}
