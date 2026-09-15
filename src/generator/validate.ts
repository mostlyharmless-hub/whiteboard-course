import { BUDGET, countChars, estimateLines, plainText } from "../shared/budget";
import { initialLayout, stepLayout, type LayoutState } from "./assemble";
import { locate } from "./resolve";
import { MARK_MIN_MS } from "./resolve";
import type { LocalAction, ValidationError } from "./types";

export interface ValidateCtx {
  sectionTitle: string;
  sectionParagraphIds: Set<string>;
  sectionSeconds: number;
  layout: LayoutState;
}

export interface ValidateResult {
  actions: LocalAction[];
  warnings: string[];
  /** 需要打回的错误；index 指向输入数组下标 */
  errors: ValidationError[];
  layout: LayoutState;
}

const PAGE_TITLE_MAX = 16;
const MERMAID_TITLE_MAX = 12;
const DENSITY_SECONDS = 15;

/** 每节允许的卡片数：平均每 15 秒 1 张，再放宽 1 张 */
export function maxCardsFor(sectionSeconds: number): number {
  return Math.ceil(sectionSeconds / DENSITY_SECONDS) + 1;
}

// ---------- Mermaid ----------
const MERMAID_HEADER = /^(flowchart|graph)\s+(LR|TD|TB|RL|BT)\b/;
const MERMAID_STYLE_LINE = /^(style|classDef|class|linkStyle|click)\b/;
const NODE = /^([A-Za-z0-9_一-鿿]+)\s*(?:\[\[?([^\]]*)\]\]?|\(\(?([^)]*)\)\)?|\{\{?([^}]*)\}\}?|>([^\]]*)\])?$/;

export type MermaidCheck = { ok: true; code: string; warnings: string[] } | { ok: false; error: string };

/** 正则级检查（不引入 jsdom）：头部、样式行、subgraph、节点数与节点文字 */
export function checkMermaid(code: string): MermaidCheck {
  const lines = code
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("%%"));
  const header = lines[0] ?? "";
  if (!MERMAID_HEADER.test(header)) return { ok: false, error: `Mermaid 必须以 flowchart/graph + LR/TD 开头，实际为「${header}」` };
  const warnings: string[] = [];
  const body = lines.slice(1).filter((l) => {
    if (MERMAID_STYLE_LINE.test(l)) {
      warnings.push(`已删除 Mermaid 样式/事件行：${l}`);
      return false;
    }
    return true;
  });
  if (body.some((l) => /^subgraph\b/.test(l) || /^end$/.test(l))) return { ok: false, error: "Mermaid 不允许 subgraph" };
  const nodes = new Map<string, string>();
  for (const line of body) {
    const normalized = line
      .replace(/-->\|[^|]*\|/g, "-->")
      .replace(/--\s+[^-]+?\s+-->/g, "-->")
      .replace(/-\.\s*[^-]+?\s*\.->/g, "-->");
    const fragments = normalized.split(/\s*(?:-{2,}>|-{3,}|-\.->|-\.-|={2,}>|={3,}|--[xo]|&)\s*/);
    for (const frag of fragments) {
      const f = frag.trim();
      if (f === "") continue;
      const m = NODE.exec(f);
      if (!m) return { ok: false, error: `Mermaid 无法解析节点「${f}」（只允许 A[文字] / A(文字) / A{文字} 形式）` };
      const id = m[1]!;
      const label = (m[2] ?? m[3] ?? m[4] ?? m[5])?.replace(/^"|"$/g, "").trim();
      if (label !== undefined) nodes.set(id, label);
      else if (!nodes.has(id)) nodes.set(id, id);
    }
  }
  if (nodes.size > BUDGET.MERMAID_NODES) return { ok: false, error: `Mermaid 节点 ${nodes.size} 个，超过上限 ${BUDGET.MERMAID_NODES}` };
  for (const [id, label] of nodes) {
    const n = countChars(label);
    if (n > BUDGET.MERMAID_NODE_CHARS) return { ok: false, error: `Mermaid 节点 ${id} 的文字「${label}」${n} 字，超过上限 ${BUDGET.MERMAID_NODE_CHARS}` };
  }
  return { ok: true, code: [header, ...body].join("\n"), warnings };
}

// ---------- board ----------
const FORBIDDEN: [RegExp, string][] = [
  [/!\[/, "图片"],
  [/\]\(/, "链接"],
  [/<[a-zA-Z][^>]*>/, "HTML"],
  [/```|~~~/, "代码块"],
];
const TABLE_SEPARATOR = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

export function checkBoard(content: string, isFirstOfPage: boolean): string[] {
  const errors: string[] = [];
  for (const [re, name] of FORBIDDEN) if (re.test(content)) errors.push(`卡片使用了禁止的 Markdown：${name}`);
  const lines = content.split(/\r?\n/);
  const h1s = lines.filter((l) => /^#\s+\S/.test(l));
  if (h1s.length > 1) errors.push("一张卡片只能有一个一级标题 #");
  if (h1s.length === 1) {
    if (!isFirstOfPage) errors.push("一级标题 # 只能用于页首卡片，其余卡片请用 ## 或加粗");
    const n = countChars(h1s[0]!.replace(/^#\s+/, ""));
    if (n > BUDGET.TITLE_CHARS) errors.push(`一级标题 ${n} 字，超过上限 ${BUDGET.TITLE_CHARS}`);
  }
  const plain = plainText(content);
  const chars = countChars(plain);
  if (chars > BUDGET.CARD_CHARS) errors.push(`卡片纯文本 ${chars} 字，超过上限 ${BUDGET.CARD_CHARS}`);
  const est = estimateLines(plain);
  if (est > BUDGET.CARD_LINES) errors.push(`卡片估算 ${est} 行，超过上限 ${BUDGET.CARD_LINES}`);
  const tableRows = lines.map((l) => l.trim()).filter((l) => l.startsWith("|") && !TABLE_SEPARATOR.test(l));
  if (tableRows.length > 5) errors.push(`表格 ${tableRows.length} 行，超过上限 5`);
  const cols = Math.max(0, ...tableRows.map((r) => r.replace(/^\||\|$/g, "").split("|").length));
  if (cols > 4) errors.push(`表格 ${cols} 列，超过上限 4`);
  if (lines.some((l) => /^(?: {4,}|\t{2,})(?:[-*+]|\d+\.)\s/.test(l))) errors.push("列表嵌套超过 2 层");
  return errors;
}

interface SeenCard {
  plain: string;
  marks: number;
  /** 卡片所在页的序号（本节内计数），标注不得跨页 */
  page: number;
}

/** 语义校验 + 自动修正；返回修正后的动作（可能多出自动插入的 new_column / new_page）与需打回的错误 */
export function validateSection(input: LocalAction[], ctx: ValidateCtx): ValidateResult {
  const out: LocalAction[] = [];
  const warnings: string[] = [];
  const errors: ValidationError[] = [];
  const seen = new Map<string, SeenCard>();
  let layout = ctx.layout;
  let cardCount = 0;
  let currentPage = 0;
  const maxCards = maxCardsFor(ctx.sectionSeconds);

  const push = (a: LocalAction) => {
    out.push(a);
    layout = stepLayout(layout, a);
    if (a.type === "new_page") currentPage += 1;
  };
  const insertPage = (a: LocalAction, why: string) => {
    warnings.push(`${why}，已自动插入 new_page「${ctx.sectionTitle}」`);
    push({ type: "new_page", title: ctx.sectionTitle.slice(0, PAGE_TITLE_MAX), at: a.at, anchor: a.anchor });
  };

  input.forEach((orig, index) => {
    const nth = `第 ${index + 1} 条动作`;
    if (!ctx.sectionParagraphIds.has(orig.anchor.paragraph_id)) {
      errors.push({ index, message: `${nth}的锚点段落 ${orig.anchor.paragraph_id} 不属于本节` });
    }
    const a: LocalAction = { ...orig };
    switch (a.type) {
      case "new_page": {
        if (a.title.length > PAGE_TITLE_MAX) {
          warnings.push(`${nth}页标题「${a.title}」超过 ${PAGE_TITLE_MAX} 字，已截断`);
          a.title = a.title.slice(0, PAGE_TITLE_MAX);
        }
        push(a);
        break;
      }
      case "new_column": {
        if (!layout.hasPage) {
          insertPage(a, `${nth}在尚无页面时 new_column`);
          break;
        }
        if (layout.columns >= BUDGET.PAGE_COLUMNS) {
          warnings.push(`${nth}是第 ${layout.columns + 1} 栏，已改为 new_page「${ctx.sectionTitle}」`);
          push({ type: "new_page", title: ctx.sectionTitle.slice(0, PAGE_TITLE_MAX), at: a.at, anchor: a.anchor });
          break;
        }
        push(a);
        break;
      }
      case "board":
      case "mermaid": {
        if (!layout.hasPage) insertPage(a, `${nth}在尚无页面时写卡片`);
        else if (layout.cardsInColumn >= BUDGET.COLUMN_CARDS) {
          if (layout.columns < BUDGET.PAGE_COLUMNS) {
            warnings.push(`${nth}是当前栏第 ${layout.cardsInColumn + 1} 张卡片，已自动插入 new_column`);
            push({ type: "new_column", at: a.at, anchor: a.anchor });
          } else {
            insertPage(a, `${nth}是第 ${layout.columns} 栏的第 ${layout.cardsInColumn + 1} 张卡片`);
          }
        }
        const isFirstOfPage = layout.columns === 1 && layout.cardsInColumn === 0;
        if (a.type === "board") {
          for (const e of checkBoard(a.content, isFirstOfPage)) errors.push({ index, message: `${nth}（卡片 ${a.card_id}）：${e}` });
          seen.set(a.card_id, { plain: plainText(a.content), marks: 0, page: currentPage });
        } else {
          if (a.title !== undefined && a.title.length > MERMAID_TITLE_MAX) {
            warnings.push(`${nth}图标题「${a.title}」超过 ${MERMAID_TITLE_MAX} 字，已截断`);
            a.title = a.title.slice(0, MERMAID_TITLE_MAX);
          }
          const m = checkMermaid(a.code);
          if (m.ok) {
            a.code = m.code;
            for (const w of m.warnings) warnings.push(`${nth}（卡片 ${a.card_id}）：${w}`);
          } else {
            errors.push({ index, message: `${nth}（卡片 ${a.card_id}）：${m.error}` });
          }
          seen.set(a.card_id, { plain: `${a.title ?? ""}\n${a.code}`, marks: 0, page: currentPage });
        }
        cardCount += 1;
        if (cardCount === maxCards + 1) {
          errors.push({ index, message: `${nth}：本节已有 ${cardCount} 张卡片，超过上限 ${maxCards}（时长 ${ctx.sectionSeconds} 秒，平均每 15 秒不多于 1 张），请合并或删减卡片` });
        }
        push(a);
        break;
      }
      case "highlight":
      case "circle": {
        const target = seen.get(a.target_card_id);
        if (!target) {
          errors.push({ index, message: `${nth}的 target_card_id ${a.target_card_id} 不是本节此前出现的卡片` });
          push(a);
          break;
        }
        if (target.page !== currentPage) {
          warnings.push(`${nth}：卡片 ${a.target_card_id} 已不在当前页（中途翻页），标注已丢弃`);
          break;
        }
        if (target.marks >= BUDGET.MARKS_PER_CARD) {
          warnings.push(`${nth}：卡片 ${a.target_card_id} 已有 ${BUDGET.MARKS_PER_CARD} 次标注，本条已丢弃`);
          break;
        }
        if (a.snippet.length > BUDGET.SNIPPET_CHARS) {
          warnings.push(`${nth}的 snippet 超过 ${BUDGET.SNIPPET_CHARS} 字，已截断`);
          a.snippet = a.snippet.slice(0, BUDGET.SNIPPET_CHARS);
        }
        const loc = locate(target.plain, a.snippet);
        if (!loc) {
          errors.push({ index, message: `${nth}的 snippet「${a.snippet}」不是卡片 ${a.target_card_id} 纯文本的子串` });
          push(a);
          break;
        }
        if (!loc.exact) warnings.push(`${nth}的 snippet「${a.snippet}」在去掉标点后才匹配到`);
        if (a.until <= a.at) {
          warnings.push(`${nth}的 until 不大于 at，已改为 at + ${MARK_MIN_MS}`);
          a.until = a.at + MARK_MIN_MS;
        }
        target.marks += 1;
        push(a);
        break;
      }
    }
  });

  return { actions: out, warnings, errors, layout };
}

/** 丢弃打回失败的动作，连带丢弃引用被丢卡片的标注 */
export function dropFailed(input: LocalAction[], errors: ValidationError[]): { actions: LocalAction[]; dropped: LocalAction[] } {
  const bad = new Set(errors.map((e) => e.index));
  const droppedCards = new Set<string>();
  const actions: LocalAction[] = [];
  const dropped: LocalAction[] = [];
  input.forEach((a, i) => {
    let drop = bad.has(i);
    if (!drop && (a.type === "highlight" || a.type === "circle") && droppedCards.has(a.target_card_id)) drop = true;
    if (drop) {
      dropped.push(a);
      if (a.type === "board" || a.type === "mermaid") droppedCards.add(a.card_id);
    } else {
      actions.push(a);
    }
  });
  return { actions, dropped };
}

export { initialLayout };
