/** 卡片本地坐标系中的矩形（未缩放的 CSS 像素） */
export interface LocalRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 把 root 内每个非空白字符包成 <span class="ch">；KaTeX 公式整体视为一个单元。
 * 幂等：已拆分过则直接返回现有单元。返回按文档顺序排列的单元数组。
 */
export function splitChars(root: HTMLElement): HTMLElement[] {
  const existing = root.querySelectorAll<HTMLElement>(".ch");
  if (existing.length > 0) return Array.from(existing);
  const units: HTMLElement[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.classList.contains("katex")) {
        el.classList.add("ch");
        units.push(el);
        return;
      }
      for (const child of Array.from(el.childNodes)) walk(child);
      return;
    }
    if (node.nodeType !== Node.TEXT_NODE) return;
    const text = node.textContent ?? "";
    if (text.trim() === "") return;
    const frag = document.createDocumentFragment();
    for (const ch of Array.from(text)) {
      if (/\s/.test(ch)) {
        frag.appendChild(document.createTextNode(ch));
        continue;
      }
      const span = document.createElement("span");
      span.className = "ch";
      span.textContent = ch;
      frag.appendChild(span);
      units.push(span);
    }
    node.parentNode?.replaceChild(frag, node);
  };
  walk(root);
  return units;
}

/** 前 count 个单元可见，其余隐藏（占位不重排） */
export function setRevealed(units: HTMLElement[], count: number): void {
  for (let i = 0; i < units.length; i++) units[i]!.classList.toggle("on", i < count);
}

const STRIP = /[\s\p{P}\p{S}]/gu;

/**
 * 在单元序列中定位 snippet，返回 [start, endExclusive] 单元下标。
 * 先精确匹配；失败则两边都去掉空白、标点与符号后再匹配。
 */
export function locateSnippet(units: HTMLElement[], snippet: string): [number, number] | null {
  const chars = units.map((u) => u.textContent ?? "");
  const full = chars.join("");
  const exact = full.indexOf(snippet);
  if (exact >= 0) return mapRange(chars, exact, exact + snippet.length);

  const keep: number[] = [];
  let stripped = "";
  chars.forEach((c, i) => {
    const s = c.replace(STRIP, "");
    for (let k = 0; k < s.length; k++) keep.push(i);
    stripped += s;
  });
  const target = snippet.replace(STRIP, "");
  if (target === "") return null;
  const j = stripped.indexOf(target);
  if (j < 0) return null;
  return [keep[j]!, keep[j + target.length - 1]! + 1];
}

/** 把拼接字符串的 [a, b) 映射为单元下标区间（单元可能多字符，如 KaTeX） */
function mapRange(chars: string[], a: number, b: number): [number, number] {
  let pos = 0;
  let start = -1;
  let end = -1;
  for (let i = 0; i < chars.length; i++) {
    const next = pos + chars[i]!.length;
    if (start < 0 && next > a) start = i;
    if (end < 0 && next >= b) {
      end = i + 1;
      break;
    }
    pos = next;
  }
  return [start, end];
}

/** 单元区间的包围盒，按行合并，转换为 container 本地坐标 */
export function rectsOf(units: HTMLElement[], [a, b]: [number, number], container: HTMLElement): LocalRect[] {
  if (a < 0 || b <= a || b > units.length) return [];
  const range = document.createRange();
  range.setStartBefore(units[a]!);
  range.setEndAfter(units[b - 1]!);
  const box = container.getBoundingClientRect();
  const scale = container.offsetWidth > 0 ? box.width / container.offsetWidth : 1;
  const lines: LocalRect[] = [];
  for (const r of Array.from(range.getClientRects())) {
    if (r.width === 0 || r.height === 0) continue;
    const local = { x: (r.left - box.left) / scale, y: (r.top - box.top) / scale, w: r.width / scale, h: r.height / scale };
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - local.y) < 4) {
      const right = Math.max(last.x + last.w, local.x + local.w);
      last.x = Math.min(last.x, local.x);
      last.w = right - last.x;
      last.h = Math.max(last.h, local.h);
    } else {
      lines.push(local);
    }
  }
  return lines;
}

/** 单个单元在 container 本地坐标中的矩形 */
export function rectOfUnit(unit: HTMLElement, container: HTMLElement): LocalRect {
  const box = container.getBoundingClientRect();
  const scale = container.offsetWidth > 0 ? box.width / container.offsetWidth : 1;
  const r = unit.getBoundingClientRect();
  return { x: (r.left - box.left) / scale, y: (r.top - box.top) / scale, w: r.width / scale, h: r.height / scale };
}
