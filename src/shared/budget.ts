/** CLAUDE.md 第 5.4 节内容预算 */
export const BUDGET = {
  CARD_CHARS: 140,
  CARD_LINES: 9,
  CHARS_PER_LINE: 20,
  TITLE_CHARS: 12,
  COLUMN_CARDS: 3,
  PAGE_COLUMNS: 3,
  MERMAID_NODES: 8,
  MERMAID_NODE_CHARS: 10,
  MARKS_PER_CARD: 2,
  SNIPPET_CHARS: 20,
} as const;

const TABLE_SEPARATOR = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

/** 去掉 Markdown 标记，保留文字与 KaTeX 原文；行与行之间用 \n，空行丢弃 */
export function plainText(markdown: string): string {
  const lines: string[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    let line = raw.trim();
    if (line === "") continue;
    if (TABLE_SEPARATOR.test(line)) continue;
    line = line.replace(/^#{1,6}\s+/, "");
    line = line.replace(/^>\s?/, "");
    line = line.replace(/^([-*+]|\d+\.)\s+/, "");
    if (line.startsWith("|")) {
      line = line
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim())
        .join(" ");
    }
    line = line.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1");
    line = line.replace(/(^|[^*])\*([^*]+?)\*/g, "$1$2").replace(/(^|[^_])_([^_]+?)_/g, "$1$2");
    line = line.replace(/`([^`]+)`/g, "$1");
    lines.push(line.trim());
  }
  return lines.join("\n");
}

const CJK = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/gu;
const WORD = /[A-Za-z]+(?:['’-][A-Za-z]+)*|\d+(?:[.,]\d+)*/g;

/** CJK 一字计 1，英文单词 / 数字串计 1，标点与空白不计 */
export function countChars(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  const words = text.replace(CJK, " ").match(WORD)?.length ?? 0;
  return cjk + words;
}

/** 按行折算：每行 ceil(字数 / 20)，空行不计 */
export function estimateLines(text: string): number {
  let lines = 0;
  for (const line of text.split("\n")) {
    const n = countChars(line);
    if (n === 0) continue;
    lines += Math.ceil(n / BUDGET.CHARS_PER_LINE);
  }
  return lines;
}
