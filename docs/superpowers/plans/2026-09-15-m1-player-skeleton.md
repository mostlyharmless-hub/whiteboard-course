# M1 播放器骨架 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 不依赖 LLM，把 `shared/schema`、`shared/reducer`、手写 fixture 脚本和浏览器播放器（计时器模式）跑通，可以人工评估"老师边讲边写"的观感。

**Architecture:** `src/shared/` 是 Node / 浏览器共用的纯类型与纯函数（zod schema、语义校验、`apply/stateAt` reducer、时间轴二分查找）。播放器是 Vite + React 18 单页应用：一个时钟源产出 `t`（毫秒），板书状态是 `t` 的纯函数；画布是自写 pan/zoom 容器，页 → 栏 → 卡片用真实 DOM 尺寸布局；Markdown/KaTeX 同步渲染、Mermaid 异步渲染；逐字揭示、荧光笔高亮、手绘画圈全部按 `t` 计算进度，拖动进度条即得对应状态。

**Tech Stack:** TypeScript 5.9（strict，禁 any）、pnpm、React 18.3、Vite 8、vitest 5、zod 4、markdown-it 15 + @vscode/markdown-it-katex 1.1 + katex 0.16、mermaid 12（`look: "handDrawn"`）、eslint 10 + typescript-eslint 8、纯 CSS。

**Spec:** `CLAUDE.md`（第 3、5、7、8、9、10、11、12 节）。

## Global Constraints

- TypeScript `strict: true`，禁止 `any`（eslint `@typescript-eslint/no-explicit-any: error`）。
- `src/shared/` 不得 import Node 或浏览器特有 API；无运行时依赖（zod 除外）。
- React 18 函数组件 + hooks，状态用 `useReducer`/`useState` + context，不引入状态库、不引入 UI 组件库。
- 页逻辑尺寸 1600 × 900，内边距 48，栏间距 32，栏宽 480，卡片间距 24，栏最大高度 804。
- 字号：页首 `#` 30px，`##` 24px，正文 21px。配色：墨色 `#1e1e1e`，白板底 `#fbfaf7` + 点阵，荧光笔 `rgba(255, 214, 0, .45)`，圈选 `#e03131`。
- 界面文案中文，代码注释中文，标识符英文。
- 提交信息：`feat(player): …` / `feat(shared): …` / `test: …` / `chore: …` / `docs: …`，末尾附 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- 播放器不做猜测式布局：脚本合法则一定能渲染；不合法在加载时报错并指出第几条动作。
- 不执行 `playwright install`；M1 不写 Playwright 用例（M4）。
- 字体文件（Xiaolai / Excalifont）不在本计划内下载：只写 `@font-face` 与本机回退栈，`public/fonts/README.md` 说明来源。

---

## 文件结构

```
package.json / pnpm-lock.yaml / tsconfig.json / vite.config.ts / eslint.config.js / index.html / .gitignore / .env.example
public/fonts/README.md                 字体来源说明（文件待用户确认后下载）
src/shared/schema.ts                   zod schema、类型导出、语义校验 validateSemantics
src/shared/budget.ts                   plainText / countChars / estimateLines、预算常量
src/shared/reducer.ts                  BoardState、apply、stateAt、countApplied、activeMarks
src/shared/lookup.ts                   paragraphAt / sectionAt（按 t 二分）
src/player/main.tsx                    入口：读 URL 参数、加载脚本、挂载 App
src/player/App.tsx                     组合：时钟、板书状态、相机跟随、UI
src/player/loadScript.ts               fetch + 校验，产出 BoardScript 或错误清单
src/player/clock/useClock.ts           计时器 / 音频时钟
src/player/state/useBoardState.ts      前进增量、后退重算
src/player/render/markdown.ts          markdown-it + katex，html 关闭
src/player/render/mermaid.ts           mermaid 初始化 + 按 card_id 缓存的异步渲染
src/player/render/reveal.ts            splitChars、setRevealed、locateSnippet、rectsOf
src/player/canvas/PanZoom.tsx          相机（translate/scale）、滚轮缩放、拖拽、双击复位、flyTo、worldRectOf
src/player/canvas/Page.tsx             1600×900 页，渲染各栏
src/player/canvas/Column.tsx           480 宽栏，超 804 高自动缩放
src/player/canvas/Card.tsx             board / mermaid 卡片，逐字揭示，微旋转
src/player/canvas/Marks.tsx            高亮 / 画圈 SVG overlay
src/player/ui/TopBar.tsx               标题、缩放 pill、页码导航、跟随开关
src/player/ui/Sidebar.tsx              小节大纲
src/player/ui/BottomBar.tsx            播放/暂停、进度条（小节刻度）、时间、倍速、字幕开关
src/player/ui/Subtitle.tsx             当前段落字幕
src/player/styles/fonts.css / board.css / ui.css
tests/shared/schema.test.ts / budget.test.ts / reducer.test.ts / lookup.test.ts
tests/fixtures/minimal.script.json     6 条动作，覆盖全部 6 种类型（e2e 用）
tests/fixtures/demo.script.json        §5.5 示例扩展成 3 页的观感评估脚本
```

---

### Task 1: 项目脚手架

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `index.html`, `.gitignore`, `.env.example`, `public/fonts/README.md`

**Interfaces:**
- Produces: `pnpm dev` / `pnpm test` / `pnpm lint` / `pnpm typecheck` / `pnpm check` 四个命令；`vite.config.ts` 中 `test.include: ["tests/**/*.test.ts"]`。

- [ ] **Step 1: git init 与 .gitignore**

```
node_modules/
dist/
out/
.env
*.log
.DS_Store
```

- [ ] **Step 2: package.json**

```json
{
  "name": "whiteboard-course",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.0.9",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "check": "pnpm typecheck && pnpm test && pnpm lint"
  },
  "dependencies": {
    "@vscode/markdown-it-katex": "^1.1.2",
    "katex": "^0.16.22",
    "markdown-it": "^15.0.2",
    "mermaid": "^12.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.0",
    "@types/markdown-it": "^14.2.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^6.1.1",
    "eslint": "^10.10.0",
    "eslint-plugin-react-hooks": "^7.0.0",
    "typescript": "~5.9.3",
    "typescript-eslint": "^8.70.0",
    "vite": "^8.3.0",
    "vitest": "^5.0.0"
  }
}
```

安装：`pnpm install`。若 `@eslint/js` / `eslint-plugin-react-hooks` 的最新大版本号与上表不同，以 `npm view <pkg> version` 为准调整。

- [ ] **Step 3: tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "types": ["vite/client"]
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

- [ ] **Step 4: vite.config.ts（含 vitest 配置）**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 5: eslint.config.js**

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist/", "out/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
);
```

若 `eslint-plugin-react-hooks` 的导出名不是 `configs.flat.recommended`，按其 README 调整（v6 为 `configs["recommended-latest"]`）。

- [ ] **Step 6: index.html 与 .env.example**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI 板书课程</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/player/main.tsx"></script>
  </body>
</html>
```

`.env.example`：

```
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-5
LLM_BASE_URL=
LLM_API_KEY=
```

- [ ] **Step 7: public/fonts/README.md**

说明需要放入 `Xiaolai.ttf`（https://github.com/lxgw/kose-font ，OFL）与 `Excalifont-Regular.woff2`（https://github.com/excalidraw/excalidraw/tree/master/packages/excalidraw/fonts ，OFL），缺失时按 CSS 回退栈使用本机楷体。

- [ ] **Step 8: 验证 `pnpm typecheck && pnpm lint` 在空项目通过；提交**

```bash
git add -A && git commit -m "chore: 初始化 pnpm + vite + react 18 + vitest 脚手架"
```

---

### Task 2: shared/schema.ts

**Files:**
- Create: `src/shared/schema.ts`
- Test: `tests/shared/schema.test.ts`

**Interfaces:**
- Produces:
  - `BoardScriptSchema`, `ActionSchema`, `ParagraphSchema`, `SectionSchema`, `AnchorSchema`（zod）
  - 类型：`BoardScript`, `Action`, `NewPage`, `NewColumn`, `Board`, `Mermaid`, `Highlight`, `Circle`, `Paragraph`, `Section`, `Anchor`, `CardAction = Board | Mermaid`, `MarkAction = Highlight | Circle`
  - `interface ScriptIssue { path: (string | number)[]; message: string }`
  - `validateSemantics(script: BoardScript): ScriptIssue[]`（第 5.2 节规则 + sections 覆盖规则）
  - `parseScript(input: unknown): { ok: true; script: BoardScript } | { ok: false; issues: ScriptIssue[] }`（先 zod 后语义，合并 issues）

- [ ] **Step 1: 写失败测试 `tests/shared/schema.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { parseScript, validateSemantics, type BoardScript } from "../../src/shared/schema";

const P = (id: string, begin: number, end: number) => ({ paragraph_id: id, text: `段落${id}`, begin_time: begin, end_time: end });
const anchor = { paragraph_id: "p1", quote: "段落p1" };

export function baseScript(): BoardScript {
  return {
    version: "1.0",
    meta: { title: "测试", duration_ms: 20000, generated_at: "2026-09-15T00:00:00Z", model: "fixture" },
    paragraphs: [P("p1", 0, 10000), P("p2", 10000, 20000)],
    sections: [
      { id: "s1", title: "一", intent: "x", paragraph_ids: ["p1"], begin_ms: 0, end_ms: 10000 },
      { id: "s2", title: "二", intent: "y", paragraph_ids: ["p2"], begin_ms: 10000, end_ms: 20000 },
    ],
    actions: [
      { id: "a001", type: "new_page", title: "首页", at: 0, anchor },
      { id: "a002", type: "board", card_id: "c01", content: "# 标题", reveal_ms: 600, at: 1000, anchor },
      { id: "a003", type: "highlight", target_card_id: "c01", snippet: "标题", at: 2000, until: 5000, anchor },
    ],
  };
}

describe("parseScript", () => {
  it("接受合法脚本", () => {
    const r = parseScript(baseScript());
    expect(r.ok).toBe(true);
  });
  it("拒绝 version 不为 1.0", () => {
    const r = parseScript({ ...baseScript(), version: "2.0" });
    expect(r.ok).toBe(false);
  });
  it("拒绝未知 action type", () => {
    const s = baseScript();
    s.actions.push({ id: "a004", type: "explode", at: 3000, anchor } as unknown as BoardScript["actions"][number]);
    expect(parseScript(s).ok).toBe(false);
  });
});

describe("validateSemantics", () => {
  it("actions[0] 必须是 new_page", () => {
    const s = baseScript();
    s.actions.shift();
    const issues = validateSemantics(s);
    expect(issues.some((i) => i.path[0] === "actions" && i.path[1] === 0)).toBe(true);
  });
  it("at 必须单调不减", () => {
    const s = baseScript();
    s.actions[2]!.at = 500;
    expect(validateSemantics(s).map((i) => i.message).join()).toMatch(/单调/);
  });
  it("at 不得超出 duration_ms", () => {
    const s = baseScript();
    s.actions[2]!.at = 99999;
    s.actions[2]!.until = 100000;
    expect(validateSemantics(s).map((i) => i.message).join()).toMatch(/duration/);
  });
  it("until 必须大于 at", () => {
    const s = baseScript();
    (s.actions[2] as { until: number }).until = 2000;
    expect(validateSemantics(s).map((i) => i.message).join()).toMatch(/until/);
  });
  it("target_card_id 必须指向当前页已出现的卡片", () => {
    const s = baseScript();
    (s.actions[2] as { target_card_id: string }).target_card_id = "c99";
    expect(validateSemantics(s).map((i) => i.message).join()).toMatch(/c99/);
    const s2 = baseScript();
    s2.actions.splice(2, 0, { id: "a00x", type: "new_page", title: "第二页", at: 1500, anchor });
    expect(validateSemantics(s2).map((i) => i.message).join()).toMatch(/跨页/);
  });
  it("card_id 不得重复", () => {
    const s = baseScript();
    s.actions.push({ id: "a004", type: "board", card_id: "c01", content: "x", reveal_ms: 600, at: 6000, anchor });
    expect(validateSemantics(s).map((i) => i.message).join()).toMatch(/c01/);
  });
  it("anchor.paragraph_id 必须存在", () => {
    const s = baseScript();
    s.actions[1]!.anchor = { paragraph_id: "nope", quote: "x" };
    expect(validateSemantics(s).map((i) => i.message).join()).toMatch(/nope/);
  });
  it("sections 必须连续且恰好覆盖全部段落", () => {
    const s = baseScript();
    s.sections[1]!.paragraph_ids = [];
    expect(validateSemantics(s).some((i) => i.path[0] === "sections")).toBe(true);
    const s2 = baseScript();
    s2.sections[0]!.paragraph_ids = ["p2"];
    s2.sections[1]!.paragraph_ids = ["p1"];
    expect(validateSemantics(s2).some((i) => i.path[0] === "sections")).toBe(true);
  });
  it("合法脚本无问题", () => {
    expect(validateSemantics(baseScript())).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/shared/schema.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/shared/schema.ts`**

```ts
import { z } from "zod";

// ---------- 基础 ----------
export const AnchorSchema = z.object({
  paragraph_id: z.string().min(1),
  quote: z.string().min(1),
});
export type Anchor = z.infer<typeof AnchorSchema>;

export const ParagraphSchema = z.object({
  paragraph_id: z.string().min(1),
  text: z.string().min(1),
  begin_time: z.number().int().nonnegative(),
  end_time: z.number().int().nonnegative(),
});
export type Paragraph = z.infer<typeof ParagraphSchema>;

export const SectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(16),
  intent: z.string(),
  paragraph_ids: z.array(z.string().min(1)),
  begin_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
});
export type Section = z.infer<typeof SectionSchema>;

// ---------- 动作 ----------
const base = {
  id: z.string().min(1),
  at: z.number().int().nonnegative(),
  anchor: AnchorSchema,
};

export const NewPageSchema = z.object({ ...base, type: z.literal("new_page"), title: z.string().min(1).max(16) });
export const NewColumnSchema = z.object({ ...base, type: z.literal("new_column") });
export const BoardSchema = z.object({
  ...base,
  type: z.literal("board"),
  card_id: z.string().min(1),
  content: z.string().min(1),
  reveal_ms: z.number().int().positive(),
});
export const MermaidSchema = z.object({
  ...base,
  type: z.literal("mermaid"),
  card_id: z.string().min(1),
  title: z.string().max(12).optional(),
  code: z.string().min(1),
  reveal_ms: z.number().int().positive(),
});
export const HighlightSchema = z.object({
  ...base,
  type: z.literal("highlight"),
  target_card_id: z.string().min(1),
  snippet: z.string().min(1).max(20),
  until: z.number().int().nonnegative(),
});
export const CircleSchema = z.object({
  ...base,
  type: z.literal("circle"),
  target_card_id: z.string().min(1),
  snippet: z.string().min(1).max(20),
  until: z.number().int().nonnegative(),
});

export const ActionSchema = z.discriminatedUnion("type", [
  NewPageSchema, NewColumnSchema, BoardSchema, MermaidSchema, HighlightSchema, CircleSchema,
]);

export type NewPage = z.infer<typeof NewPageSchema>;
export type NewColumn = z.infer<typeof NewColumnSchema>;
export type Board = z.infer<typeof BoardSchema>;
export type Mermaid = z.infer<typeof MermaidSchema>;
export type Highlight = z.infer<typeof HighlightSchema>;
export type Circle = z.infer<typeof CircleSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type CardAction = Board | Mermaid;
export type MarkAction = Highlight | Circle;

// ---------- 顶层 ----------
export const BoardScriptSchema = z.object({
  version: z.literal("1.0"),
  meta: z.object({
    title: z.string().min(1),
    source_track_id: z.string().optional(),
    duration_ms: z.number().int().positive(),
    generated_at: z.string(),
    model: z.string(),
  }),
  paragraphs: z.array(ParagraphSchema).min(1),
  sections: z.array(SectionSchema).min(1),
  actions: z.array(ActionSchema).min(1),
});
export type BoardScript = z.infer<typeof BoardScriptSchema>;

// ---------- 语义校验（第 5.2 节） ----------
export interface ScriptIssue {
  path: (string | number)[];
  message: string;
}

export function validateSemantics(script: BoardScript): ScriptIssue[] {
  const issues: ScriptIssue[] = [];
  const { actions, paragraphs, sections, meta } = script;
  const paragraphIds = new Set(paragraphs.map((p) => p.paragraph_id));

  // 段落自身
  paragraphs.forEach((p, i) => {
    if (p.begin_time >= p.end_time) issues.push({ path: ["paragraphs", i], message: `段落 ${p.paragraph_id} 的 begin_time 必须小于 end_time` });
    const prev = paragraphs[i - 1];
    if (prev && p.begin_time < prev.begin_time) issues.push({ path: ["paragraphs", i], message: `段落 ${p.paragraph_id} 未按 begin_time 升序` });
  });

  // sections 连续覆盖全部段落恰好一次
  const covered: string[] = [];
  sections.forEach((s, i) => {
    if (s.paragraph_ids.length === 0) issues.push({ path: ["sections", i], message: `小节 ${s.id} 没有段落` });
    for (const pid of s.paragraph_ids) {
      if (!paragraphIds.has(pid)) issues.push({ path: ["sections", i], message: `小节 ${s.id} 引用了不存在的段落 ${pid}` });
      covered.push(pid);
    }
    const first = paragraphs.find((p) => p.paragraph_id === s.paragraph_ids[0]);
    const last = paragraphs.find((p) => p.paragraph_id === s.paragraph_ids[s.paragraph_ids.length - 1]);
    if (first && s.begin_ms !== first.begin_time) issues.push({ path: ["sections", i], message: `小节 ${s.id} 的 begin_ms 应等于首段 begin_time` });
    if (last && s.end_ms !== last.end_time) issues.push({ path: ["sections", i], message: `小节 ${s.id} 的 end_ms 应等于末段 end_time` });
  });
  const expected = paragraphs.map((p) => p.paragraph_id);
  if (covered.join(" ") !== expected.join(" ")) {
    issues.push({ path: ["sections"], message: "小节的 paragraph_ids 必须连续、不重叠、按顺序恰好覆盖全部段落" });
  }

  // 动作
  if (actions.length === 0 || actions[0]!.type !== "new_page") {
    issues.push({ path: ["actions", 0], message: "actions[0] 必须是 new_page" });
  }
  const cardPage = new Map<string, number>();
  const markCount = new Map<string, number>();
  let page = -1;
  let prevAt = -Infinity;
  actions.forEach((a, i) => {
    const path = ["actions", i];
    if (!paragraphIds.has(a.anchor.paragraph_id)) issues.push({ path, message: `动作 ${a.id} 的锚点段落 ${a.anchor.paragraph_id} 不存在` });
    if (a.at < prevAt) issues.push({ path, message: `动作 ${a.id} 的 at 必须单调不减` });
    prevAt = Math.max(prevAt, a.at);
    if (a.at > meta.duration_ms) issues.push({ path, message: `动作 ${a.id} 的 at 超出 duration_ms` });
    switch (a.type) {
      case "new_page":
        page += 1;
        break;
      case "new_column":
        if (page < 0) issues.push({ path, message: `动作 ${a.id}：尚无页面，不能 new_column` });
        break;
      case "board":
      case "mermaid":
        if (page < 0) issues.push({ path, message: `动作 ${a.id}：尚无页面，不能写卡片` });
        if (cardPage.has(a.card_id)) issues.push({ path, message: `card_id ${a.card_id} 重复` });
        cardPage.set(a.card_id, page);
        break;
      case "highlight":
      case "circle": {
        const target = cardPage.get(a.target_card_id);
        if (target === undefined) issues.push({ path, message: `动作 ${a.id} 的 target_card_id ${a.target_card_id} 不存在或尚未出现` });
        else if (target !== page) issues.push({ path, message: `动作 ${a.id} 跨页标注了卡片 ${a.target_card_id}` });
        if (a.until <= a.at) issues.push({ path, message: `动作 ${a.id} 的 until 必须大于 at` });
        const n = (markCount.get(a.target_card_id) ?? 0) + 1;
        markCount.set(a.target_card_id, n);
        break;
      }
    }
  });
  return issues;
}

export type ParseResult = { ok: true; script: BoardScript } | { ok: false; issues: ScriptIssue[] };

export function parseScript(input: unknown): ParseResult {
  const r = BoardScriptSchema.safeParse(input);
  if (!r.success) {
    return { ok: false, issues: r.error.issues.map((i) => ({ path: i.path.map((p) => (typeof p === "symbol" ? String(p) : p)), message: i.message })) };
  }
  const issues = validateSemantics(r.data);
  return issues.length > 0 ? { ok: false, issues } : { ok: true, script: r.data };
}
```

- [ ] **Step 4: 运行通过**

Run: `pnpm vitest run tests/shared/schema.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: 提交**

```bash
git add src/shared/schema.ts tests/shared/schema.test.ts
git commit -m "feat(shared): BoardScript zod schema 与语义校验"
```

---

### Task 3: shared/budget.ts

**Files:**
- Create: `src/shared/budget.ts`
- Test: `tests/shared/budget.test.ts`

**Interfaces:**
- Produces: `plainText(markdown: string): string`、`countChars(text: string): number`（CJK 一字计 1，英文单词计 1，数字串计 1，标点不计）、`estimateLines(text: string): number`（按换行分段，每段 `ceil(chars / 20)`，空行不计）、常量 `BUDGET = { CARD_CHARS: 140, CARD_LINES: 9, CHARS_PER_LINE: 20, TITLE_CHARS: 12, COLUMN_CARDS: 3, PAGE_COLUMNS: 3, MERMAID_NODES: 8, MERMAID_NODE_CHARS: 10, MARKS_PER_CARD: 2, SNIPPET_CHARS: 20 }`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import { countChars, estimateLines, plainText } from "../../src/shared/budget";

describe("plainText", () => {
  it("剥离标题、加粗、列表、行内代码、引用、表格标记", () => {
    const md = "# 标题\n\n**加粗** 与 `code`\n- 项一\n1. 项二\n> 引用\n| a | b |\n|---|---|\n| 1 | 2 |";
    expect(plainText(md)).toBe("标题\n加粗 与 code\n项一\n项二\n引用\na b\n1 2");
  });
  it("保留 KaTeX 原文", () => {
    expect(plainText("公式 $x^2$")).toBe("公式 $x^2$");
  });
});

describe("countChars", () => {
  it("CJK 一字计 1，英文单词计 1，标点不计", () => {
    expect(countChars("岗位信息 AI 分析，RPA · DeepSeek")).toBe(4 + 1 + 2 + 1 + 1);
  });
  it("数字串计 1", () => {
    expect(countChars("2024年")).toBe(2);
  });
});

describe("estimateLines", () => {
  it("每行按 20 字折算，空行不计", () => {
    expect(estimateLines("一".repeat(45) + "\n\n短")).toBe(3 + 1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/shared/budget.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

```ts
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

/** 去掉 Markdown 标记，保留文字与 KaTeX 原文，行与行之间用 \n */
export function plainText(markdown: string): string {
  const lines: string[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    let line = raw.trim();
    if (line === "") continue;
    if (/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line)) continue; // 表格分隔行
    line = line.replace(/^#{1,6}\s+/, "");
    line = line.replace(/^>\s?/, "");
    line = line.replace(/^(\s*)([-*+]|\d+\.)\s+/, "");
    if (line.startsWith("|")) {
      line = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).join(" ");
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
```

- [ ] **Step 4: 运行通过；提交**

```bash
git add src/shared/budget.ts tests/shared/budget.test.ts
git commit -m "feat(shared): 板书纯文本字数与行数估算"
```

---

### Task 4: shared/reducer.ts 与 shared/lookup.ts

**Files:**
- Create: `src/shared/reducer.ts`, `src/shared/lookup.ts`
- Test: `tests/shared/reducer.test.ts`, `tests/shared/lookup.test.ts`

**Interfaces:**
- Produces（reducer）:

```ts
export interface CardState { id: string; kind: "board" | "mermaid"; at: number; reveal_ms: number; content: string; title?: string; page: number; column: number }
export interface ColumnState { cards: string[] }
export interface PageState { title: string; columns: ColumnState[] }
export interface MarkState { id: string; kind: "highlight" | "circle"; target_card_id: string; snippet: string; at: number; until: number; page: number }
export interface BoardState { pages: PageState[]; cards: Record<string, CardState>; currentPage: number; currentColumn: number; marks: MarkState[]; applied: number }
export const initialState: BoardState;                       // pages [], cards {}, currentPage -1, currentColumn -1, marks [], applied 0
export function apply(state: BoardState, action: Action): BoardState;  // 纯函数，返回新对象；new_page 清空 marks；无页时写卡片抛 Error
export function countApplied(actions: Action[], t: number): number;    // 二分：at <= t 的动作数
export function stateAt(actions: Action[], t: number): BoardState;     // fold 后过滤 marks.until > t
export function activeMarks(marks: MarkState[], t: number): MarkState[]; // at <= t < until
export function revealProgress(card: CardState, t: number): number;    // clamp((t - at) / reveal_ms, 0, 1)
```

- Produces（lookup）:

```ts
export function paragraphAt(paragraphs: Paragraph[], t: number): Paragraph | null;  // begin_time <= t < end_time，间隙返回 null
export function sectionAt(sections: Section[], t: number): Section | null;          // 最后一个 begin_ms <= t 的小节；t 早于首节返回 null
```

- [ ] **Step 1: 写失败测试 `tests/shared/reducer.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import type { Action } from "../../src/shared/schema";
import { activeMarks, apply, countApplied, initialState, revealProgress, stateAt } from "../../src/shared/reducer";

const anchor = { paragraph_id: "p1", quote: "q" };
const actions: Action[] = [
  { id: "a1", type: "new_page", title: "P1", at: 0, anchor },
  { id: "a2", type: "board", card_id: "c1", content: "# A", reveal_ms: 1000, at: 1000, anchor },
  { id: "a3", type: "new_column", at: 2000, anchor },
  { id: "a4", type: "mermaid", card_id: "c2", code: "flowchart LR\n A-->B", reveal_ms: 800, at: 2500, anchor },
  { id: "a5", type: "highlight", target_card_id: "c1", snippet: "A", at: 3000, until: 5000, anchor },
  { id: "a6", type: "circle", target_card_id: "c2", snippet: "B", at: 3500, until: 9000, anchor },
  { id: "a7", type: "new_page", title: "P2", at: 6000, anchor },
  { id: "a8", type: "board", card_id: "c3", content: "B", reveal_ms: 600, at: 6500, anchor },
];

describe("apply", () => {
  it("new_page 隐含第一栏；board 落在当前栏", () => {
    let s = apply(initialState, actions[0]!);
    expect(s.pages).toHaveLength(1);
    expect(s.currentPage).toBe(0);
    expect(s.currentColumn).toBe(0);
    s = apply(s, actions[1]!);
    expect(s.pages[0]!.columns[0]!.cards).toEqual(["c1"]);
    expect(s.cards["c1"]).toMatchObject({ kind: "board", page: 0, column: 0, at: 1000, reveal_ms: 1000 });
  });
  it("new_column 后卡片落在新栏", () => {
    const s = actions.slice(0, 4).reduce(apply, initialState);
    expect(s.pages[0]!.columns).toHaveLength(2);
    expect(s.pages[0]!.columns[1]!.cards).toEqual(["c2"]);
    expect(s.cards["c2"]!.title).toBeUndefined();
  });
  it("标注进入 marks；翻页清空 marks", () => {
    const s6 = actions.slice(0, 6).reduce(apply, initialState);
    expect(s6.marks.map((m) => m.id)).toEqual(["a5", "a6"]);
    const s7 = apply(s6, actions[6]!);
    expect(s7.marks).toEqual([]);
    expect(s7.currentPage).toBe(1);
  });
  it("无页面时写卡片抛错并指出动作 id", () => {
    expect(() => apply(initialState, actions[1]!)).toThrow(/a2/);
  });
  it("不修改输入状态", () => {
    const s0 = apply(initialState, actions[0]!);
    const frozen = structuredClone(s0);
    apply(s0, actions[1]!);
    expect(s0).toEqual(frozen);
  });
});

describe("countApplied / stateAt", () => {
  it("countApplied 是 at <= t 的动作数", () => {
    expect(countApplied(actions, -1)).toBe(0);
    expect(countApplied(actions, 0)).toBe(1);
    expect(countApplied(actions, 2500)).toBe(4);
    expect(countApplied(actions, 99999)).toBe(8);
  });
  it("任意 t 下 stateAt 与逐步应用一致", () => {
    for (const t of [0, 999, 1000, 2600, 3200, 5999, 6000, 7000]) {
      const n = countApplied(actions, t);
      const stepwise = actions.slice(0, n).reduce(apply, initialState);
      const expected = { ...stepwise, marks: stepwise.marks.filter((m) => m.until > t) };
      expect(stateAt(actions, t)).toEqual(expected);
    }
  });
  it("活动标注随 until 消失", () => {
    expect(activeMarks(stateAt(actions, 3600).marks, 3600).map((m) => m.id)).toEqual(["a5", "a6"]);
    expect(activeMarks(stateAt(actions, 5000).marks, 5000).map((m) => m.id)).toEqual(["a6"]);
  });
  it("后退重算与前进一致", () => {
    const forward = stateAt(actions, 7000);
    const back = stateAt(actions, 2600);
    expect(back.applied).toBe(4);
    expect(forward.applied).toBe(8);
    expect(stateAt(actions, 7000)).toEqual(forward);
  });
});

describe("revealProgress", () => {
  it("按 (t - at) / reveal_ms 钳在 [0, 1]", () => {
    const s = stateAt(actions, 1500);
    const c = s.cards["c1"]!;
    expect(revealProgress(c, 900)).toBe(0);
    expect(revealProgress(c, 1500)).toBe(0.5);
    expect(revealProgress(c, 5000)).toBe(1);
  });
});
```

- [ ] **Step 2: 写失败测试 `tests/shared/lookup.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { paragraphAt, sectionAt } from "../../src/shared/lookup";

const paragraphs = [
  { paragraph_id: "p1", text: "a", begin_time: 1000, end_time: 2000 },
  { paragraph_id: "p2", text: "b", begin_time: 2500, end_time: 3000 },
];
const sections = [
  { id: "s1", title: "一", intent: "", paragraph_ids: ["p1"], begin_ms: 1000, end_ms: 2000 },
  { id: "s2", title: "二", intent: "", paragraph_ids: ["p2"], begin_ms: 2500, end_ms: 3000 },
];

describe("paragraphAt", () => {
  it("落在段内返回该段，间隙返回 null，首段前返回 null", () => {
    expect(paragraphAt(paragraphs, 500)).toBeNull();
    expect(paragraphAt(paragraphs, 1000)?.paragraph_id).toBe("p1");
    expect(paragraphAt(paragraphs, 1999)?.paragraph_id).toBe("p1");
    expect(paragraphAt(paragraphs, 2200)).toBeNull();
    expect(paragraphAt(paragraphs, 2999)?.paragraph_id).toBe("p2");
    expect(paragraphAt(paragraphs, 3000)).toBeNull();
  });
});

describe("sectionAt", () => {
  it("返回最后一个 begin_ms <= t 的小节", () => {
    expect(sectionAt(sections, 500)).toBeNull();
    expect(sectionAt(sections, 1000)?.id).toBe("s1");
    expect(sectionAt(sections, 2200)?.id).toBe("s1");
    expect(sectionAt(sections, 2500)?.id).toBe("s2");
    expect(sectionAt(sections, 9999)?.id).toBe("s2");
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm vitest run tests/shared`
Expected: reducer / lookup 两个文件 FAIL（模块不存在）

- [ ] **Step 4: 实现 `src/shared/reducer.ts`**

```ts
import type { Action } from "./schema";

export interface CardState {
  id: string;
  kind: "board" | "mermaid";
  at: number;
  reveal_ms: number;
  /** board：Markdown；mermaid：源码 */
  content: string;
  title?: string;
  page: number;
  column: number;
}
export interface ColumnState { cards: string[] }
export interface PageState { title: string; columns: ColumnState[] }
export interface MarkState {
  id: string;
  kind: "highlight" | "circle";
  target_card_id: string;
  snippet: string;
  at: number;
  until: number;
  page: number;
}
export interface BoardState {
  pages: PageState[];
  cards: Record<string, CardState>;
  currentPage: number;
  currentColumn: number;
  /** 已触发且未被翻页清除的标注；是否仍活动由 until 与 t 决定 */
  marks: MarkState[];
  /** 已应用的动作数 */
  applied: number;
}

export const initialState: BoardState = {
  pages: [],
  cards: {},
  currentPage: -1,
  currentColumn: -1,
  marks: [],
  applied: 0,
};

function withCard(state: BoardState, card: CardState): BoardState {
  if (state.currentPage < 0) throw new Error(`动作写卡片 ${card.id} 时尚无页面`);
  const pages = state.pages.map((p, pi) =>
    pi !== state.currentPage
      ? p
      : { ...p, columns: p.columns.map((c, ci) => (ci !== state.currentColumn ? c : { cards: [...c.cards, card.id] })) },
  );
  return { ...state, pages, cards: { ...state.cards, [card.id]: card } };
}

export function apply(state: BoardState, action: Action): BoardState {
  const applied = state.applied + 1;
  switch (action.type) {
    case "new_page":
      return {
        ...state,
        pages: [...state.pages, { title: action.title, columns: [{ cards: [] }] }],
        currentPage: state.pages.length,
        currentColumn: 0,
        marks: [],
        applied,
      };
    case "new_column": {
      if (state.currentPage < 0) throw new Error(`动作 ${action.id}：尚无页面，不能 new_column`);
      const pages = state.pages.map((p, pi) => (pi !== state.currentPage ? p : { ...p, columns: [...p.columns, { cards: [] }] }));
      return { ...state, pages, currentColumn: pages[state.currentPage]!.columns.length - 1, applied };
    }
    case "board":
    case "mermaid": {
      if (state.currentPage < 0) throw new Error(`动作 ${action.id}：尚无页面，不能写卡片`);
      const card: CardState = {
        id: action.card_id,
        kind: action.type,
        at: action.at,
        reveal_ms: action.reveal_ms,
        content: action.type === "board" ? action.content : action.code,
        page: state.currentPage,
        column: state.currentColumn,
      };
      if (action.type === "mermaid" && action.title !== undefined) card.title = action.title;
      return { ...withCard(state, card), applied };
    }
    case "highlight":
    case "circle": {
      const target = state.cards[action.target_card_id];
      if (!target) throw new Error(`动作 ${action.id}：目标卡片 ${action.target_card_id} 不存在`);
      const mark: MarkState = {
        id: action.id,
        kind: action.type,
        target_card_id: action.target_card_id,
        snippet: action.snippet,
        at: action.at,
        until: action.until,
        page: target.page,
      };
      return { ...state, marks: [...state.marks, mark], applied };
    }
  }
}

/** at <= t 的动作数（actions 按 at 升序） */
export function countApplied(actions: Action[], t: number): number {
  let lo = 0;
  let hi = actions.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (actions[mid]!.at <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function activeMarks(marks: MarkState[], t: number): MarkState[] {
  return marks.filter((m) => m.at <= t && t < m.until);
}

export function stateAt(actions: Action[], t: number): BoardState {
  const n = countApplied(actions, t);
  let s = initialState;
  for (let i = 0; i < n; i++) s = apply(s, actions[i]!);
  return { ...s, marks: s.marks.filter((m) => m.until > t) };
}

export function revealProgress(card: CardState, t: number): number {
  const p = (t - card.at) / card.reveal_ms;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}
```

- [ ] **Step 5: 实现 `src/shared/lookup.ts`**

```ts
import type { Paragraph, Section } from "./schema";

/** 最后一个 key(item) <= t 的下标；无则 -1 */
function lastIndexAtOrBefore<T>(items: T[], t: number, key: (item: T) => number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(items[mid]!) <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

export function paragraphAt(paragraphs: Paragraph[], t: number): Paragraph | null {
  const i = lastIndexAtOrBefore(paragraphs, t, (p) => p.begin_time);
  const p = paragraphs[i];
  return p && t < p.end_time ? p : null;
}

export function sectionAt(sections: Section[], t: number): Section | null {
  const i = lastIndexAtOrBefore(sections, t, (s) => s.begin_ms);
  return sections[i] ?? null;
}
```

- [ ] **Step 6: 运行通过；提交**

Run: `pnpm vitest run tests/shared`
Expected: PASS

```bash
git add src/shared/reducer.ts src/shared/lookup.ts tests/shared/reducer.test.ts tests/shared/lookup.test.ts
git commit -m "feat(shared): 板书状态 reducer 与时间轴查找"
```

---

### Task 5: 手写 fixture 脚本

**Files:**
- Create: `tests/fixtures/minimal.script.json`, `tests/fixtures/demo.script.json`
- Test: `tests/shared/fixtures.test.ts`

**Interfaces:**
- Produces: 两个通过 `parseScript` 的脚本文件。`minimal` 恰好 6 条动作、每种类型一条、20 秒；`demo` 用样例课程真实段落与 §5.5 示例，3 页、含分栏、Mermaid、KaTeX、表格、引用、≥ 4 次标注，时长 420520。

- [ ] **Step 1: 写 `tests/shared/fixtures.test.ts`**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseScript } from "../../src/shared/schema";

for (const name of ["minimal", "demo"]) {
  describe(`fixtures/${name}.script.json`, () => {
    it("通过 parseScript", () => {
      const json: unknown = JSON.parse(readFileSync(`tests/fixtures/${name}.script.json`, "utf8"));
      const r = parseScript(json);
      if (!r.ok) console.error(r.issues);
      expect(r.ok).toBe(true);
    });
  });
}

describe("minimal 覆盖全部 6 种动作", () => {
  it("每种一条", () => {
    const json = JSON.parse(readFileSync("tests/fixtures/minimal.script.json", "utf8")) as { actions: { type: string }[] };
    expect(json.actions.map((a) => a.type).sort()).toEqual(["board", "circle", "highlight", "mermaid", "new_column", "new_page"]);
  });
});
```

- [ ] **Step 2: 写 `tests/fixtures/minimal.script.json`**

```json
{
  "version": "1.0",
  "meta": { "title": "最小脚本", "duration_ms": 20000, "generated_at": "2026-09-15T00:00:00Z", "model": "handwritten" },
  "paragraphs": [
    { "paragraph_id": "p1", "text": "大家好，今天我们讲三个要点。第一是数据，第二是能力，第三是环境。", "begin_time": 0, "end_time": 10000 },
    { "paragraph_id": "p2", "text": "它们构成一条闭环分析链，其中环境是最容易被忽视的一环。", "begin_time": 10000, "end_time": 20000 }
  ],
  "sections": [
    { "id": "s1", "title": "三个要点", "intent": "结构总览", "paragraph_ids": ["p1"], "begin_ms": 0, "end_ms": 10000 },
    { "id": "s2", "title": "闭环分析链", "intent": "流程图与结论", "paragraph_ids": ["p2"], "begin_ms": 10000, "end_ms": 20000 }
  ],
  "actions": [
    { "id": "a001", "type": "new_page", "title": "三个要点", "at": 0, "anchor": { "paragraph_id": "p1", "quote": "大家好，今天我们" } },
    { "id": "a002", "type": "board", "card_id": "c01", "content": "# 三个要点\n\n1. **数据**：岗位信息采集\n2. **能力**：NLP 量化模型\n3. **环境**：政策 + 市场趋势", "reveal_ms": 2400, "at": 2000, "anchor": { "paragraph_id": "p1", "quote": "第一是数据" } },
    { "id": "a003", "type": "new_column", "at": 10000, "anchor": { "paragraph_id": "p2", "quote": "它们构成一条" } },
    { "id": "a004", "type": "mermaid", "card_id": "c02", "title": "闭环分析链", "code": "flowchart LR\n  A[数据] --> B[能力] --> C[环境] --> A", "reveal_ms": 800, "at": 10500, "anchor": { "paragraph_id": "p2", "quote": "它们构成一条闭环分析链" } },
    { "id": "a005", "type": "highlight", "target_card_id": "c01", "snippet": "政策 + 市场趋势", "at": 14000, "until": 20000, "anchor": { "paragraph_id": "p2", "quote": "其中环境是最容易" } },
    { "id": "a006", "type": "circle", "target_card_id": "c01", "snippet": "环境", "at": 16000, "until": 20000, "anchor": { "paragraph_id": "p2", "quote": "被忽视的一环" } }
  ]
}
```

- [ ] **Step 3: 写 `tests/fixtures/demo.script.json`**

段落原样取自 `samples/aigc-career.transcript.json`（11 段，`paragraph_id` / `text` / `begin_time` / `end_time`，去掉 `speaker_id`）。`duration_ms: 420520`。小节：

| id | title | paragraph_ids | begin_ms | end_ms |
|---|---|---|---|---|
| s1 | 课程总览 | 1781165726319500000, 1781165749019500000 | 10080 | 66160 |
| s2 | 岗位信息采集 | 1781165782409500000, 1781165810039500000, 1781165871579500000 | 66170 | 202388 |
| s3 | 写入 Excel 并运行 | 1781165918999500000, 1781165949459500000 | 202760 | 291800 |
| s4 | DeepSeek 能力分析 | 1781166008249500000, 1781166070139500000 | 292010 | 361560 |
| s5 | 行业背景与总结 | 1781166084499500000, 1781166115669500000 | 368260 | 420520 |

动作（`at` 已按 6.4 规则手算，锚点逐字取原文）：

```json
[
  { "id": "a001", "type": "new_page", "title": "AIGC 助力职业规划", "at": 10080, "anchor": { "paragraph_id": "1781165726319500000", "quote": "大家好，本节课程" } },
  { "id": "a002", "type": "board", "card_id": "c01", "content": "# AIGC 助力职业规划\n\n**三大核心环节**\n1. 岗位信息智能采集\n2. 核心能力 AI 分析\n3. 行业背景挖掘\n\n工具：RPA · DeepSeek", "reveal_ms": 2460, "at": 16600, "anchor": { "paragraph_id": "1781165726319500000", "quote": "我们将聚焦三大核心环节" } },
  { "id": "a003", "type": "new_column", "at": 32780, "anchor": { "paragraph_id": "1781165749019500000", "quote": "本职业规划体系采用三级分析框架" } },
  { "id": "a004", "type": "mermaid", "card_id": "c02", "title": "三级分析框架", "code": "flowchart LR\n  A[岗位信息采集] --> B[核心能力分析] --> C[行业背景整合]", "reveal_ms": 800, "at": 32980, "anchor": { "paragraph_id": "1781165749019500000", "quote": "本职业规划体系采用三级分析框架" } },
  { "id": "a005", "type": "board", "card_id": "c03", "content": "## 数据 · 能力 · 环境\n- **数据**：岗位信息采集 → 原始数据\n- **能力**：NLP 把职责描述转为硬技能 / 软技能量化模型\n- **环境**：政策法规 + 市场趋势 → 决策支撑\n\n三者形成**闭环分析链**", "reveal_ms": 3600, "at": 36300, "anchor": { "paragraph_id": "1781165749019500000", "quote": "首先通过岗位信息采集" } },
  { "id": "a006", "type": "highlight", "target_card_id": "c03", "snippet": "闭环分析链", "at": 57800, "until": 66160, "anchor": { "paragraph_id": "1781165749019500000", "quote": "形成数据、能力、环境的闭环分析链" } },
  { "id": "a007", "type": "new_page", "title": "岗位信息智能采集", "at": 66170, "anchor": { "paragraph_id": "1781165782409500000", "quote": "现在开始第一环节" } },
  { "id": "a008", "type": "board", "card_id": "c04", "content": "# 第一环节：岗位信息智能采集\n\n工具：RPA 客户端 → 新建 → PC 自动化应用\n\n> 让流程机器人明确：从哪里取数据、取什么、存到哪", "reveal_ms": 2700, "at": 72000, "anchor": { "paragraph_id": "1781165782409500000", "quote": "打开引导客户端" } },
  { "id": "a009", "type": "new_column", "at": 80000, "anchor": { "paragraph_id": "1781165782409500000", "quote": "第一个指令是让流程机器人" } },
  { "id": "a010", "type": "board", "card_id": "c05", "content": "## 指令搭建步骤\n1. 获取已打开的网页对象（Chrome）\n2. 循环相似元素：抓取公司名称\n3. 获取元素对象：岗位描述\n4. 同法获取薪资待遇\n5. 同法获取工作地点", "reveal_ms": 3600, "at": 80200, "anchor": { "paragraph_id": "1781165782409500000", "quote": "第一个指令是让流程机器人明确从哪里获取数据" } },
  { "id": "a011", "type": "circle", "target_card_id": "c05", "snippet": "循环相似元素", "at": 100000, "until": 150000, "anchor": { "paragraph_id": "1781165810039500000", "quote": "先从指令栏中选择循环相似元素" } },
  { "id": "a012", "type": "new_column", "at": 120000, "anchor": { "paragraph_id": "1781165810039500000", "quote": "按住CTR再点击要采集的数据元素" } },
  { "id": "a013", "type": "board", "card_id": "c06", "content": "## 捕获相似元素\n\n| 操作 | 快捷键 |\n|---|---|\n| 选中一个元素 | Ctrl + 点击 |\n| 捕获相似元素 | Ctrl + 再点击 |\n\n结果：15 个相似元素 → **公司名称** 元素组", "reveal_ms": 3000, "at": 120200, "anchor": { "paragraph_id": "1781165810039500000", "quote": "可以看到这页的15个相似元素" } },
  { "id": "a014", "type": "new_page", "title": "写入 Excel 并运行", "at": 202760, "anchor": { "paragraph_id": "1781165918999500000", "quote": "接下来从搜索栏中获取" } },
  { "id": "a015", "type": "board", "card_id": "c07", "content": "# 写入 Excel\n\n- 新建 Excel（循环外，只执行一次）\n- 循环体内：岗位描述 / 薪资福利 / 工作地点 → 写入工作表\n\n写入范围：最新一行，列号 = 1、2、3", "reveal_ms": 3300, "at": 205000, "anchor": { "paragraph_id": "1781165918999500000", "quote": "点击确定这个指令不需要循环重复" } },
  { "id": "a016", "type": "new_column", "at": 233220, "anchor": { "paragraph_id": "1781165949459500000", "quote": "接下来的任务将岗位描述放入excel第一列" } },
  { "id": "a017", "type": "mermaid", "card_id": "c08", "title": "流程结构", "code": "flowchart TD\n  A[新建 Excel] --> B{循环相似元素}\n  B --> C[取岗位描述]\n  C --> D[取薪资 / 地点]\n  D --> E[写入一行]\n  E --> B\n  B --> F[运行完成]", "reveal_ms": 800, "at": 233420, "anchor": { "paragraph_id": "1781165949459500000", "quote": "接下来的任务将岗位描述放入excel第一列" } },
  { "id": "a018", "type": "board", "card_id": "c09", "content": "## 采集完成\n\n运行流程机器人 → Excel 已有数据\n\n下一步：从采集信息中**提炼岗位核心能力**", "reveal_ms": 1800, "at": 275000, "anchor": { "paragraph_id": "1781165949459500000", "quote": "我们点击运行按钮" } },
  { "id": "a019", "type": "highlight", "target_card_id": "c09", "snippet": "提炼岗位核心能力", "at": 286000, "until": 291800, "anchor": { "paragraph_id": "1781165949459500000", "quote": "接下来需从采集到的信息中提炼岗位核心能力" } },
  { "id": "a020", "type": "new_page", "title": "DeepSeek 能力分析", "at": 292010, "anchor": { "paragraph_id": "1781166008249500000", "quote": "下面演示第二部分" } },
  { "id": "a021", "type": "board", "card_id": "c10", "content": "# 第二环节：DeepSeek 能力分析\n\n1. 上传岗位描述附件\n2. 指令：分析办公室文员岗位的核心能力\n3. 追问：哪项能力对薪资影响最大？", "reveal_ms": 2700, "at": 300000, "anchor": { "paragraph_id": "1781166008249500000", "quote": "点击附件图标上传岗位描述附件" } },
  { "id": "a022", "type": "new_column", "at": 318000, "anchor": { "paragraph_id": "1781166008249500000", "quote": "Deep seek提炼出了办公室文员岗位的通用核心能力" } },
  { "id": "a023", "type": "board", "card_id": "c11", "content": "## 文员岗位核心能力\n- 办公软件操作\n- 文档与流程管理\n- 基础数据处理\n- 沟通协调\n\n薪资溢价 $\\propto$ **沟通能力 + 数据处理能力**", "reveal_ms": 2400, "at": 318200, "anchor": { "paragraph_id": "1781166008249500000", "quote": "包括办公软件的操作能力" } },
  { "id": "a024", "type": "circle", "target_card_id": "c11", "snippet": "沟通能力 + 数据处理能力", "at": 338000, "until": 347540, "anchor": { "paragraph_id": "1781166008249500000", "quote": "沟通能力与数据处理能力是薪资溢价的核心因素" } },
  { "id": "a025", "type": "board", "card_id": "c12", "content": "## 继续追问\n- 地区薪资差异\n- 公司规模 ↔ 能力要求", "reveal_ms": 1200, "at": 354000, "anchor": { "paragraph_id": "1781166070139500000", "quote": "继续输入分析地区薪资差异" } },
  { "id": "a026", "type": "new_page", "title": "行业背景与总结", "at": 368260, "anchor": { "paragraph_id": "1781166084499500000", "quote": "第三部分行业背景调研" } },
  { "id": "a027", "type": "board", "card_id": "c13", "content": "# 第三环节：行业背景调研\n\n提示词三步走\n1. **基础信息**：市场需求与发展趋势\n2. **数据细化**：2024 一线城市薪资范围与福利\n3. **政策关联**：劳动法对文员岗位的核心规定", "reveal_ms": 3300, "at": 372000, "anchor": { "paragraph_id": "1781166084499500000", "quote": "第一步，基础信息获取" } },
  { "id": "a028", "type": "new_column", "at": 399430, "anchor": { "paragraph_id": "1781166115669500000", "quote": "本次课程演示了" } },
  { "id": "a029", "type": "board", "card_id": "c14", "content": "## 课程总结\n\n数据采集 → 能力分析 → 行业研判\n\n> 工具是辅助，**人的判断力才是核心**", "reveal_ms": 1800, "at": 404000, "anchor": { "paragraph_id": "1781166115669500000", "quote": "从数据采集、能力分析、行业研判" } },
  { "id": "a030", "type": "highlight", "target_card_id": "c14", "snippet": "人的判断力才是核心", "at": 412000, "until": 420520, "anchor": { "paragraph_id": "1781166115669500000", "quote": "但需牢记，工具是辅助" } }
]
```

- [ ] **Step 4: 运行通过；提交**

Run: `pnpm vitest run tests/shared/fixtures.test.ts`
Expected: PASS

```bash
git add tests/fixtures tests/shared/fixtures.test.ts
git commit -m "test: 手写 minimal 与 demo 板书脚本 fixture"
```

---

### Task 6: 脚本加载与时钟

**Files:**
- Create: `src/player/loadScript.ts`, `src/player/clock/useClock.ts`, `src/player/main.tsx`, `src/player/App.tsx`（最小版，后续任务扩展）

**Interfaces:**
- Produces:
  - `loadScript(url: string): Promise<ParseResult>`（fetch 失败 → `{ ok: false, issues: [{ path: [], message }] }`）
  - `readParams(): { script: string; audio: string | null }`（默认 `tests/fixtures/demo.script.json`）
  - `interface Clock { t: number; playing: boolean; rate: number; duration: number; mode: "audio" | "timer"; play(): void; pause(): void; toggle(): void; seek(ms: number): void; setRate(r: number): void }`
  - `useClock(opts: { audioUrl: string | null; duration: number }): Clock`

- [ ] **Step 1: `src/player/loadScript.ts`**

```ts
import { parseScript, type ParseResult } from "../shared/schema";

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
```

- [ ] **Step 2: `src/player/clock/useClock.ts`**

计时器模式：`base`（暂停时刻的 t）+ `startedAt`（`performance.now()`）+ `rate`，rAF 循环写 `t`；到 `duration` 自动暂停。音频模式：`new Audio(url)`，rAF 读 `currentTime * 1000`；`seek` 写 `currentTime`；`setRate` 写 `playbackRate`；`ended` 事件置 `playing=false`。两种模式都只暴露同一个 `Clock`。

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface Clock {
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

export function useClock(opts: { audioUrl: string | null; duration: number }): Clock {
  const { audioUrl, duration } = opts;
  const mode: Clock["mode"] = audioUrl ? "audio" : "timer";
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRateState] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timer = useRef({ base: 0, startedAt: 0 });

  // 音频元素生命周期
  useEffect(() => {
    if (!audioUrl) return;
    const audio = new Audio(audioUrl);
    audio.preload = "auto";
    audioRef.current = audio;
    const onEnded = () => setPlaying(false);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.pause();
      audio.removeEventListener("ended", onEnded);
      audioRef.current = null;
    };
  }, [audioUrl]);

  // 每帧刷新 t
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      if (mode === "audio") {
        const a = audioRef.current;
        if (a) setT(Math.min(duration, Math.round(a.currentTime * 1000)));
      } else {
        const { base, startedAt } = timer.current;
        const next = base + (performance.now() - startedAt) * rate;
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
  }, [playing, mode, rate, duration]);

  const play = useCallback(() => {
    if (mode === "audio") void audioRef.current?.play();
    else timer.current = { base: t >= duration ? 0 : t, startedAt: performance.now() };
    setPlaying(true);
  }, [mode, t, duration]);

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
    [mode, duration],
  );

  const setRate = useCallback(
    (r: number) => {
      if (mode === "audio" && audioRef.current) audioRef.current.playbackRate = r;
      timer.current = { base: t, startedAt: performance.now() };
      setRateState(r);
    },
    [mode, t],
  );

  return useMemo<Clock>(
    () => ({ t, playing, rate, duration, mode, play, pause, toggle: () => (playing ? pause() : play()), seek, setRate }),
    [t, playing, rate, duration, mode, play, pause, seek, setRate],
  );
}
```

- [ ] **Step 3: `src/player/main.tsx` 与最小 `App.tsx`**

`main.tsx`：读参数 → `loadScript` → 成功则 `<App script audio />`，失败则渲染 `<pre>` 列出每条 issue（`path.join(".")` + message，路径以 `actions.N` 开头的显示为"第 N+1 条动作"）。

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadScript, readParams } from "./loadScript";
import "./styles/fonts.css";
import "./styles/board.css";
import "./styles/ui.css";
import "katex/dist/katex.min.css";

const root = createRoot(document.getElementById("root")!);
const params = readParams();
loadScript(params.script).then((r) => {
  if (r.ok) {
    root.render(
      <StrictMode>
        <App script={r.script} audioUrl={params.audio} />
      </StrictMode>,
    );
  } else {
    root.render(
      <pre className="load-error">
        {`脚本 ${params.script} 校验失败：\n` +
          r.issues
            .map((i) => {
              const where = i.path[0] === "actions" && typeof i.path[1] === "number" ? `第 ${i.path[1] + 1} 条动作` : i.path.join(".") || "根";
              return `- [${where}] ${i.message}`;
            })
            .join("\n")}
      </pre>,
    );
  }
});
```

最小 `App.tsx`：显示 `script.meta.title`、`clock.t`、播放/暂停按钮（下一任务再换成完整 UI）。

- [ ] **Step 4: 浏览器验证**

`pnpm dev` 后打开 `http://localhost:5173/?script=tests/fixtures/minimal.script.json`：标题出现，点播放时间走动到 20000 停止。打开 `?script=samples/aigc-career.transcript.json`（非法脚本）：显示校验失败清单且控制台无未捕获错误。

- [ ] **Step 5: 提交**

```bash
git add src/player index.html
git commit -m "feat(player): 脚本加载校验与计时器/音频时钟"
```

---

### Task 7: 渲染层（Markdown / 逐字揭示 / Mermaid）

**Files:**
- Create: `src/player/render/markdown.ts`, `src/player/render/reveal.ts`, `src/player/render/mermaid.ts`

**Interfaces:**
- Produces:
  - `renderMarkdown(md: string): string`（html 关闭、linkify 关闭、KaTeX）
  - `splitChars(root: HTMLElement): HTMLElement[]`：把 root 内每个非空白字符包成 `<span class="ch">`；`.katex` 元素整体视为一个字符单元（加 `ch` 类，不深入）；返回按文档顺序的单元数组。幂等：已含 `.ch` 时直接返回现有单元。
  - `setRevealed(units: HTMLElement[], count: number): void`：前 count 个加 `on` 类，其余去掉。
  - `locateSnippet(units: HTMLElement[], snippet: string): [number, number] | null`：在 `units.map(textContent).join("")` 中精确查找；失败时去掉两边的标点与空白（`/[\s\p{P}]/gu`）后查找并映射回原下标；返回 `[start, endExclusive]`。
  - `rectsOf(units: HTMLElement[], range: [number, number], container: HTMLElement): { x: number; y: number; w: number; h: number }[]`：`Range` 取 `getClientRects()`，按行合并（top 差 < 4px 视为同行），转换为 container 的本地坐标（除以 `container.getBoundingClientRect().width / container.offsetWidth`）。
  - `renderMermaid(cardId: string, code: string): Promise<string>`（svg 字符串；按 cardId+code 缓存；失败返回带错误文字的 `<pre>`）；模块加载时 `mermaid.initialize({ startOnLoad: false, look: "handDrawn", theme: "neutral", fontFamily: "var(--font-hand)", flowchart: { htmlLabels: false } })`。

- [ ] **Step 1: `markdown.ts`**

```ts
import MarkdownIt from "markdown-it";
import katexPlugin from "@vscode/markdown-it-katex";

const md = new MarkdownIt({ html: false, linkify: false, breaks: false, typographer: false });
md.use(katexPlugin, { throwOnError: false });
// 板书不允许图片与链接：把它们渲染成纯文本
md.renderer.rules.image = (tokens, idx) => md.utils.escapeHtml(tokens[idx]!.content);
md.renderer.rules.link_open = () => "";
md.renderer.rules.link_close = () => "";

export function renderMarkdown(source: string): string {
  return md.render(source);
}
```

- [ ] **Step 2: `reveal.ts`**

```ts
export interface LocalRect { x: number; y: number; w: number; h: number }

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

export function setRevealed(units: HTMLElement[], count: number): void {
  units.forEach((u, i) => u.classList.toggle("on", i < count));
}

const STRIP = /[\s\p{P}\p{S}]/gu;

export function locateSnippet(units: HTMLElement[], snippet: string): [number, number] | null {
  const chars = units.map((u) => u.textContent ?? "");
  const full = chars.join("");
  const exact = full.indexOf(snippet);
  if (exact >= 0) return mapRange(chars, exact, exact + snippet.length);
  // 模糊：两边去掉标点、空白与符号
  const keep: number[] = [];
  let stripped = "";
  chars.forEach((c, i) => {
    const s = c.replace(STRIP, "");
    for (const _ of Array.from(s)) keep.push(i);
    stripped += s;
  });
  const target = snippet.replace(STRIP, "");
  if (target === "") return null;
  const j = stripped.indexOf(target);
  if (j < 0) return null;
  return [keep[j]!, keep[j + target.length - 1]! + 1];
}

/** 把 full 字符串的 [a, b) 映射为 units 下标区间（单元可能多字符，如 KaTeX） */
function mapRange(chars: string[], a: number, b: number): [number, number] {
  let pos = 0;
  let start = -1;
  let end = -1;
  chars.forEach((c, i) => {
    const next = pos + c.length;
    if (start < 0 && next > a) start = i;
    if (end < 0 && next >= b) end = i + 1;
    pos = next;
  });
  return [start, end];
}

export function rectsOf(units: HTMLElement[], [a, b]: [number, number], container: HTMLElement): LocalRect[] {
  if (a < 0 || b <= a || b > units.length) return [];
  const range = document.createRange();
  range.setStartBefore(units[a]!);
  range.setEndAfter(units[b - 1]!);
  const box = container.getBoundingClientRect();
  const scale = box.width / container.offsetWidth || 1;
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
    } else lines.push(local);
  }
  return lines;
}
```

- [ ] **Step 3: `mermaid.ts`**

```ts
import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  look: "handDrawn",
  theme: "neutral",
  fontFamily: "var(--font-hand)",
  flowchart: { htmlLabels: false },
});

const cache = new Map<string, Promise<string>>();
let seq = 0;

export function renderMermaid(cardId: string, code: string): Promise<string> {
  const key = `${cardId} ${code}`;
  let p = cache.get(key);
  if (!p) {
    p = mermaid
      .render(`mmd-${cardId}-${seq++}`, code)
      .then((r) => r.svg)
      .catch((e: unknown) => {
        console.error(`Mermaid 渲染失败（${cardId}）`, e);
        return `<pre class="mermaid-error">Mermaid 渲染失败：${String((e as Error).message ?? e)}</pre>`;
      });
    cache.set(key, p);
  }
  return p;
}
```

- [ ] **Step 4: `pnpm typecheck && pnpm lint` 通过；提交**

```bash
git add src/player/render
git commit -m "feat(player): Markdown/KaTeX 渲染、逐字拆分与 Mermaid 手绘渲染"
```

---

### Task 8: 画布：PanZoom、Page、Column、Card、useBoardState

**Files:**
- Create: `src/player/state/useBoardState.ts`, `src/player/canvas/PanZoom.tsx`, `src/player/canvas/Page.tsx`, `src/player/canvas/Column.tsx`, `src/player/canvas/Card.tsx`, `src/player/styles/board.css`
- Modify: `src/player/App.tsx`

**Interfaces:**
- Produces:
  - `useBoardState(actions: Action[], t: number): BoardState`（前进增量 apply，后退从头 stateAt；marks 已按 until > t 过滤且引用稳定）
  - `const PAGE = { W: 1600, H: 900, PAD: 48, GAP: 32, COL_W: 480, CARD_GAP: 24, COL_MAX_H: 804 }`（放在 `canvas/layout.ts`）
  - `PanZoom`：`forwardRef<PanZoomHandle, { children; onUserInteract(): void }>`；`interface PanZoomHandle { fitRect(r: WorldRect, animate?: boolean): void; ensureVisible(r: WorldRect): void; worldRectOf(el: HTMLElement): WorldRect; zoomBy(f: number): void; reset(): void; getScale(): number }`；`interface WorldRect { x: number; y: number; w: number; h: number }`
  - `Page`：`{ page: PageState; pageIndex: number; cards: Record<string, CardState>; t: number; marks: MarkState[]; cardRefs: MutableRefObject<Map<string, HTMLElement>> }`
  - `Column`：`{ index: number; cardIds: string[]; ... }` 超高自动缩放
  - `Card`：`{ card: CardState; t: number; marks: MarkState[]; registerEl(id: string, el: HTMLElement | null): void }`

- [ ] **Step 1: `useBoardState.ts`**

```ts
import { useMemo, useRef } from "react";
import type { Action } from "../../shared/schema";
import { apply, countApplied, initialState, type BoardState } from "../../shared/reducer";

export function useBoardState(actions: Action[], t: number): BoardState {
  const cache = useRef<{ actions: Action[]; state: BoardState }>({ actions, state: initialState });
  const n = countApplied(actions, t);

  // 前进：增量应用；后退或脚本更换：从头重算
  const folded = useMemo(() => {
    let { state } = cache.current;
    if (cache.current.actions !== actions || n < state.applied) state = initialState;
    for (let i = state.applied; i < n; i++) state = apply(state, actions[i]!);
    cache.current = { actions, state };
    return state;
  }, [actions, n]);

  // marks 过滤：只有活动集合变化时才产生新数组
  const activeKey = folded.marks.filter((m) => m.until > t).map((m) => m.id).join(",");
  return useMemo(() => ({ ...folded, marks: folded.marks.filter((m) => m.until > t) }), [folded, activeKey]); // eslint-disable-line react-hooks/exhaustive-deps
}
```

- [ ] **Step 2: `canvas/layout.ts`**

```ts
export const PAGE = { W: 1600, H: 900, PAD: 48, GAP: 32, COL_W: 480, CARD_GAP: 24, COL_MAX_H: 804 } as const;
export function columnX(index: number): number { return PAGE.PAD + index * (PAGE.COL_W + PAGE.GAP); }
export function hashRotation(id: string): number {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000 * 0.8 - 0.4;
}
```

- [ ] **Step 3: `PanZoom.tsx`**

容器 `div.viewport`（`overflow: hidden; position: relative; touch-action: none`）内 `div.world`（`position: absolute; left: 0; top: 0; transform-origin: 0 0`）。相机 `{ x, y, s }` 存 ref，写到 `world.style.transform`，不经 React state（避免每帧重渲染）；动画用 rAF 300 ms ease-out 插值。事件：`wheel` → 以指针为中心缩放（`s *= exp(-deltaY * 0.0015)`，钳 0.2–4），调用 `onUserInteract`；`pointerdown/move/up` → 拖拽平移；`dblclick` → `reset()`（fit 整页）。`fitRect(r)`：`s = min(vw / r.w, vh / r.h) * 0.92`，居中。`ensureVisible(r)`：若 r 在当前 s 下完全落在视口内则不动；否则若 r 能放进视口则最小平移，否则 `fitRect(r)`。`worldRectOf(el)`：`(el.getBoundingClientRect() - viewport rect) / s - (x, y) / s`。缩放百分比通过 `onScaleChange?(s)` 回调给 TopBar。

- [ ] **Step 4: `Card.tsx`**

```tsx
// 关键逻辑（省略 import）
export function Card({ card, t, marks, registerEl }: CardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const units = useRef<HTMLElement[]>([]);
  const html = useMemo(() => (card.kind === "board" ? renderMarkdown(card.content) : ""), [card.kind, card.content]);
  const [svg, setSvg] = useState<string | null>(null);
  const progress = revealProgress(card, t);

  // board：渲染后拆字
  useLayoutEffect(() => {
    if (card.kind !== "board" || !ref.current) return;
    units.current = splitChars(ref.current.querySelector(".card-body")!);
  }, [card.kind, html]);

  // mermaid：异步渲染，先占位
  useEffect(() => {
    if (card.kind !== "mermaid") return;
    let alive = true;
    void renderMermaid(card.id, card.content).then((s) => alive && setSvg(s));
    return () => { alive = false; };
  }, [card.kind, card.id, card.content]);

  // 每帧按 progress 揭示
  useLayoutEffect(() => {
    if (card.kind !== "board") return;
    setRevealed(units.current, Math.floor(progress * units.current.length));
  }, [card.kind, progress]);

  useLayoutEffect(() => { registerEl(card.id, ref.current); return () => registerEl(card.id, null); }, [card.id, registerEl]);

  const style = { "--rot": `${hashRotation(card.id)}deg` } as CSSProperties;
  return (
    <div ref={ref} className={`card card-${card.kind}`} style={style} data-card-id={card.id}>
      <div className="card-frame" />
      {card.kind === "board" ? (
        <div className="card-body" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="card-body mermaid-body" style={{ opacity: progress }}>
          {card.title && <div className="mermaid-title">{card.title}</div>}
          {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="mermaid-placeholder">绘制中…</div>}
        </div>
      )}
      {card.kind === "board" && progress < 1 && <PenCursor units={units} progress={progress} />}
      <Marks card={card} marks={marks} t={t} unitsRef={units} containerRef={ref} />
    </div>
  );
}
```

`PenCursor`：读第 `floor(progress × n) − 1` 个单元的 `getBoundingClientRect()`，换算为卡片本地坐标，绝对定位一个 16×16 的 SVG 笔尖（墨色斜线 + 笔尖点），随字移动；无可见单元时放在卡片左上。`Marks` 在 Task 9 实现，此任务先放空组件。

- [ ] **Step 5: `Column.tsx` 与 `Page.tsx`**

Column：`div.column` 定位 `left: columnX(index)`, `top: PAGE.PAD`, `width: COL_W`，`display: flex; flex-direction: column; gap: 24px`。`useLayoutEffect` + `ResizeObserver` 观察 `scrollHeight`，`> COL_MAX_H` 时 `transform: scale(COL_MAX_H / h)`（origin top left）并 `console.warn("栏高超出 804，已缩放", { page, column, height })`。

Page：`div.page` 1600×900，`position: absolute`，米白底 + 点阵（`radial-gradient(#d9d6cf 1px, transparent 1px) 0 0 / 24px 24px`），内渲染 `page.columns.map((c, i) => <Column …/>)`；每张卡片传入属于它的 marks：`marks.filter(m => m.target_card_id === id)`。

- [ ] **Step 6: `board.css`（核心规则）**

```css
:root { --ink: #1e1e1e; --board: #fbfaf7; --hl: rgba(255, 214, 0, .45); --circle: #e03131; }
.viewport { position: absolute; inset: 0; overflow: hidden; background: var(--board); cursor: grab; touch-action: none; }
.viewport.dragging { cursor: grabbing; }
.world { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
.page { position: absolute; left: 0; top: 0; width: 1600px; height: 900px; background: var(--board) radial-gradient(#d9d6cf 1px, transparent 1px) 0 0 / 24px 24px; box-shadow: 0 0 0 1px #e6e2d9; }
.column { position: absolute; width: 480px; display: flex; flex-direction: column; gap: 24px; transform-origin: 0 0; }
.card { position: relative; padding: 16px 20px; color: var(--ink); font-family: var(--font-hand); font-size: 21px; line-height: 1.5; transform: rotate(var(--rot)); }
.card-frame { position: absolute; inset: 0; border: 2px solid var(--ink); border-radius: 6px; filter: url(#wobble); pointer-events: none; }
.card-body h1 { font-size: 30px; margin: 0 0 12px; }
.card-body h2 { font-size: 24px; margin: 0 0 8px; }
.card-body p, .card-body li { margin: 0 0 4px; }
.card-body ul, .card-body ol { margin: 4px 0; padding-left: 28px; }
.card-body blockquote { position: relative; margin: 8px 0; padding-left: 16px; }
.card-body blockquote::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--ink); filter: url(#wobble); }
.card-body table { border-collapse: collapse; margin: 6px 0; }
.card-body th, .card-body td { border: 1.5px solid var(--ink); padding: 2px 10px; }
.card-body code { font-family: var(--font-hand); background: rgba(0,0,0,.05); padding: 0 4px; border-radius: 3px; }
.ch { visibility: hidden; }
.ch.on { visibility: visible; }
.pen { position: absolute; width: 18px; height: 18px; pointer-events: none; }
.mermaid-title { font-size: 24px; font-weight: 600; margin-bottom: 6px; }
.mermaid-body svg { max-width: 100%; height: auto; }
.mermaid-placeholder { color: #999; }
```

`App.tsx` 顶部放一次性的 `<svg width="0" height="0" style="position:absolute"><filter id="wobble" x="-15%" y="-15%" width="130%" height="130%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" xChannelSelector="R" yChannelSelector="G"/></filter></svg>`。

- [ ] **Step 7: 组装 `App.tsx`（画布部分）**

`useClock` → `useBoardState(script.actions, t)` → `viewPage` state（默认 `state.currentPage`；`useEffect` 当 `state.currentPage` 变化时同步）→ `<PanZoom ref>` 内渲染 `state.pages[viewPage]`。相机跟随：`useEffect` 依赖 `state.applied`：最新应用的动作若为 `new_page` → 下一帧 `fitRect({0,0,1600,900}, true)`；若为 board/mermaid → 下一帧取 `cardRefs.get(card_id)` 的 `worldRectOf` → `ensureVisible`。跟随开关与 8 秒暂停在 Task 10。

- [ ] **Step 8: 浏览器验证**

`?script=tests/fixtures/demo.script.json`，播放：第 1 页出现标题卡逐字书写、第二栏 Mermaid 淡入、第三张卡片；66 s 翻页；拖动进度（临时用 `clock.seek` 按钮）到 120 s 直接显示第 2 页三栏、无动画。控制台无 error。

- [ ] **Step 9: 提交**

```bash
git add src/player
git commit -m "feat(player): 无限画布、页栏卡片布局与逐字揭示"
```

---

### Task 9: 高亮与画圈

**Files:**
- Create: `src/player/canvas/Marks.tsx`
- Modify: `src/player/styles/board.css`

**Interfaces:**
- Consumes: `locateSnippet`, `rectsOf`（Task 7）；`MarkState`（Task 4）
- Produces: `Marks({ card, marks, t, unitsRef, containerRef })` — 卡片内绝对定位的 `<svg class="marks">`，覆盖整卡。

- [ ] **Step 1: 实现**

对每个 mark：`useMemo` 按 `(mark.id, unitsRef.current.length, html)` 计算 `rects = rectsOf(units, locateSnippet(units, snippet), container)`；定位失败 `console.warn` 并跳过。
- 绘制进度 `draw = clamp((t − at) / D, 0, 1)`，highlight `D = 400`，circle `D = 600`；淡出 `alpha = clamp((until − t) / 300, 0, 1)`。
- highlight：每行一个 `<rect>`：`x − 4, y + h*0.15, (w + 8) * draw, h * 0.8`，`fill: var(--hl)`，`transform: skewX(-4deg)`，`rx: 3`。
- circle：取所有行的包围盒 `(x, y, w, h)`，画两圈略错位的椭圆 `<path>`：中心 `(cx, cy)`、半径 `(w/2 + 10, h/2 + 8)`，用 24 段贝塞尔近似并对每个控制点加 `±2px` 的确定性抖动（种子取 mark.id 哈希）；第二圈 `rx + 3, ry − 2`，起点偏移 20°。`stroke: var(--circle); stroke-width: 2.5; fill: none; stroke-linecap: round`；`pathLength="1"`，`stroke-dasharray="1"`，`stroke-dashoffset={1 − draw}`。
- 整个 `<g opacity={alpha}>`。

- [ ] **Step 2: 浏览器验证**

`minimal` 脚本：14 s 荧光笔从左到右划过"政策 + 市场趋势"，16 s 红圈画出"环境"，20 s 两者淡出；拖到 18 s 直接显示完成态；拖回 5 s 无标注。

- [ ] **Step 3: 提交**

```bash
git add src/player/canvas/Marks.tsx src/player/styles/board.css
git commit -m "feat(player): 荧光笔高亮与手绘画圈"
```

---

### Task 10: UI：顶栏、侧栏、底栏、字幕、跟随与页码导航

**Files:**
- Create: `src/player/ui/TopBar.tsx`, `src/player/ui/Sidebar.tsx`, `src/player/ui/BottomBar.tsx`, `src/player/ui/Subtitle.tsx`, `src/player/styles/ui.css`
- Modify: `src/player/App.tsx`

**Interfaces:**
- `TopBar({ title, scale, onZoom(f: number), pageIndex, pageCount, onPage(i: number), follow, onFollow(v: boolean) })`
- `Sidebar({ sections, current: Section | null, collapsed, onToggle(), onJump(ms: number) })`
- `BottomBar({ clock: Clock, sections, subtitleOn, onSubtitle(v: boolean) })`：播放/暂停、进度条（`div.track` 点击/拖动 seek，`div.tick` 在每个 `section.begin_ms / duration` 处）、`mm:ss / mm:ss`、倍速下拉（0.75/1/1.25/1.5/2）、字幕开关
- `Subtitle({ text: string | null })`

- [ ] **Step 1: 实现四个组件与 `ui.css`**

布局：`.app { display: grid; grid-template-rows: 48px 1fr 64px; grid-template-columns: auto 1fr; height: 100vh }`；侧栏折叠时宽 0。字幕固定在画布底部居中，半透明深色底、白字 20px。

- [ ] **Step 2: App 接线**

- `follow` state 默认 true；`PanZoom.onUserInteract` → `pausedUntil = Date.now() + 8000`；跟随效果执行前检查 `follow && Date.now() > pausedUntil`；TopBar "跟随"按钮 → `follow = true; pausedUntil = 0` 并立即 `fitRect` 当前页。
- 页码导航改 `viewPage`，不影响播放；播放中 `state.currentPage` 变化时 `viewPage` 跟回。
- 字幕文本 = `paragraphAt(script.paragraphs, t)?.text ?? null`；当前小节 = `sectionAt(script.sections, t)`。
- 侧栏点击 → `clock.seek(section.begin_ms)`。

- [ ] **Step 3: 浏览器验证**

demo 脚本全流程：侧栏 5 节，当前节随时间高亮；底栏进度条有 5 个刻度；拖到 300 s 后第 4 页出现且字幕为第 8 段；缩放 pill 与滚轮一致；手动拖拽后 8 秒内新卡片不拉相机，8 秒后恢复；‹ › 翻看历史页不影响播放。

- [ ] **Step 4: 提交**

```bash
git add src/player
git commit -m "feat(player): 顶栏、大纲侧栏、底栏进度与字幕"
```

---

### Task 11: 字体、观感打磨与文档回填

**Files:**
- Create: `src/player/styles/fonts.css`
- Modify: `CLAUDE.md`（第 12 节 M1 完成状态；第 13 节字体待确认）、`public/fonts/README.md`

- [ ] **Step 1: `fonts.css`**

```css
@font-face { font-family: "Xiaolai"; src: url("/fonts/Xiaolai.ttf") format("truetype"); font-display: swap; }
@font-face { font-family: "Excalifont"; src: url("/fonts/Excalifont-Regular.woff2") format("woff2"); font-display: swap; }
:root { --font-hand: "Excalifont", "Xiaolai", "LXGW WenKai", "Kaiti SC", "STKaiti", "KaiTi", "Yuanti SC", cursive; }
```

- [ ] **Step 2: 用浏览器逐页截图，对照第 7.3 节检查字号、颜色、旋转、滤镜、点阵；修正明显问题**

- [ ] **Step 3: `pnpm check` 全绿；回填 CLAUDE.md（M1 状态、字体文件待下载、表格线未套滤镜的说明）；提交**

```bash
git add -A
git commit -m "docs: M1 播放器骨架完成，回填规格差异"
```

---

## 自查记录

- 规格覆盖：5.1/5.2 → Task 2；5.4 常量 → Task 3；7.1 → Task 4/6/8；7.2 → Task 8；7.3 → Task 8/11；7.4 → Task 7/8；7.5 → Task 9；7.6/7.7 → Task 10；11 单元测试 schema/budget/reducer → Task 2/3/4；fixture → Task 5。未覆盖（按计划推迟）：Playwright e2e（M4）、表格线滤镜（文字会一起糊，M1 不做）、字体文件下载（需用户确认）。
- 类型一致性：`BoardState.marks` 在 reducer 中未过滤、在 `stateAt` / `useBoardState` 中过滤 `until > t`，`activeMarks` 再按 `at <= t` 过滤——Card 收到的 marks 已保证 `at <= t`（因为只应用了 `at <= t` 的动作）。`ParseResult` 在 Task 2 定义、Task 6 消费。`WorldRect` 与 `LocalRect` 是不同坐标系，命名区分。
