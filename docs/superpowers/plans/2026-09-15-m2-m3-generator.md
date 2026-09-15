# M2 + M3 生成器 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm gen --in samples/aigc-career.transcript.json --out out/aigc-career.script.json` 用真实 LLM 生成通过校验的 BoardScript 与报告；全部纯函数模块有离线单元测试，LLM 调用可用 fixture 目录替身。

**Architecture:** 流水线 `ingest → outline（LLM 1 次）→ 逐节 script（LLM 每节 1 次 + 至多 2 轮打回）→ resolve 时间 → validate + autofix → assemble 全局编号 → report`。每一步是纯函数，LLM 调用集中在 `llm/` 的 `LlmClient` 接口后面（Anthropic SDK / OpenAI-compatible fetch / fixture 目录三种实现）。提示词是 `prompts/*.md` 文件，`{{placeholder}}` 注入，文件用一行 `===== USER =====` 分隔 system 与 user 两段。

**Tech Stack:** TypeScript 5.9、tsx、zod 4、`@anthropic-ai/sdk` 0.125、Node 26 内置 `fetch` 与 `process.loadEnvFile`。

**Spec:** `CLAUDE.md` 第 4、5.3、5.4、6、11 节。

## Global Constraints

- `src/shared/` 不改契约；生成器只产出符合 `BoardScriptSchema` 的脚本，最终用 `parseScript` 自检。
- 锚点 `quote` 在**原文**中定位（含 ASR 错误）；术语纠正只作用于板书内容。
- `LEAD_MS = 300`；`reveal_ms(board) = max(600, min(chars × 60, 8000, p.end_time − at))`；`reveal_ms(mermaid) = 800`；`until = max(p.end_time, at + 1500)`。
- 打回最多 2 轮；之后丢弃该动作并记 error，生成继续。
- Anthropic 路径不发送 `temperature`（Opus 5 / Sonnet 5 会 400），默认型号 `claude-opus-5`；OpenAI-compatible 路径 `temperature: 0.3`。
- Mermaid 校验用正则（不引入 jsdom）：`^(flowchart|graph)\s+(LR|TD|TB|RL|BT)`、节点 ≤ 8、节点文字 ≤ 10 字、禁止 `subgraph / classDef / class / style / linkStyle / click`（样式行先自动删除再检查）。
- `.env` 由用户填写，永不写入仓库；`out/` 已忽略。
- 每次 LLM 调用的原始响应可用 `--record <dir>` 落盘（`<tag>.txt`），既用于排错也可直接作为 fixture。

---

## 文件结构

```
config/glossary.json                    ASR 术语纠正表
prompts/outline.md / script.md / repair.md
src/generator/
  types.ts        Transcript、Glossary、LocalAction、SectionResult、GenerateResult
  ingest.ts       ingest(raw) → Transcript
  glossary.ts     loadGlossary / formatGlossary
  raw.ts          RawActionSchema（LLM 输出形态）、RawOutlineSchema
  prompts.ts      loadPrompt(name) → { system, user }；render(template, vars)
  json.ts         extractJson(text)：剥围栏、取首个 [ 或 { 到末尾、JSON.parse
  llm/types.ts    LlmClient / LlmRequest / LlmResponse
  llm/anthropic.ts / openai-compatible.ts / fixture.ts / recording.ts / index.ts(createLlmClient)
  resolve.ts      locate / resolveAt / revealMs / untilMs / resolveSection
  validate.ts     validateSection：autofix + 打回错误清单；mermaidCheck
  assemble.ts     LayoutState、boardStateSummary、assemble(sections) → Action[]
  outline.ts      generateOutline(llm, transcript, glossary)
  script.ts       generateSection(llm, ctx)（含打回循环）
  pipeline.ts     generate(opts) → { script, report }
  report.ts       renderReport(result) → markdown
  cli.ts          参数解析、.env、写文件
tests/generator/  resolve / validate / assemble / json / pipeline（fixture）
tests/fixtures/llm/mini/   两段讲解稿的 fixture 响应
```

---

### Task 1: 术语表、提示词、类型与基础模块

**Files:**
- Create: `config/glossary.json`, `prompts/outline.md`, `prompts/script.md`, `prompts/repair.md`, `src/generator/types.ts`, `src/generator/ingest.ts`, `src/generator/glossary.ts`, `src/generator/raw.ts`, `src/generator/prompts.ts`, `src/generator/json.ts`
- Test: `tests/generator/json.test.ts`, `tests/generator/ingest.test.ts`

**Interfaces:**

```ts
// types.ts
export interface Transcript { paragraphs: Paragraph[]; duration_ms: number; track_id?: string }
export interface GlossaryRule { from: string; to: string; note?: string }
export interface Glossary { rules: GlossaryRule[] }
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** 节内动作：已换算时间，card_id / target_card_id 仍是节内局部 id，尚无全局 id */
export type LocalAction = DistributiveOmit<Action, "id">;
export interface Usage { input_tokens: number; output_tokens: number; calls: number }
// raw.ts
export const RawActionSchema: z.ZodType<RawAction>;   // 6 种 type，无 id/at/reveal_ms/until
export const RawOutlineSchema = z.array(z.object({ id, title, intent, paragraph_ids }));
// json.ts
export function extractJson(text: string): { ok: true; value: unknown } | { ok: false; error: string };
// prompts.ts
export function loadPrompt(name: "outline" | "script" | "repair"): { system: string; user: string };
export function render(template: string, vars: Record<string, string | number>): string;  // {{key}}；缺失 key 抛错
// ingest.ts
export function ingest(raw: unknown): Transcript;  // zod 校验 data.paragraphs；begin<end、升序、id 唯一、text 非空，否则抛 Error 指出段落
// glossary.ts
export function loadGlossary(path: string): Glossary;
export function formatGlossary(g: Glossary): string;  // "- `aig c` → AIGC（备注）" 每行一条
```

- [ ] **Step 1: `config/glossary.json`**

```json
{
  "rules": [
    { "from": "aig c", "to": "AIGC" },
    { "from": "deep seek", "to": "DeepSeek" },
    { "from": "Deep seek", "to": "DeepSeek" },
    { "from": "n lp", "to": "NLP" },
    { "from": "CTR", "to": "Ctrl", "note": "快捷键语境" },
    { "from": "CTL", "to": "Ctrl", "note": "快捷键语境" },
    { "from": "ctl", "to": "Ctrl", "note": "快捷键语境" },
    { "from": "第22个指令", "to": "第二个指令" },
    { "from": "引导RPA", "to": "引导 RPA", "note": "疑为 RPA 产品名，待课程方确认" },
    { "from": "boss直聘", "to": "BOSS 直聘" },
    { "from": "职位描述element", "to": "职位描述元素" }
  ]
}
```

- [ ] **Step 2: 三个提示词文件**（正文见实现；要点：outline 要求连续覆盖、1–3 段、≤ 16 字标题、intent 说明呈现方式；script 包含 §6.8 八条要求、§5.4 预算整表、动作格式与 §5.5 示例、当前白板状态、本节时长与卡片上限 `ceil(秒 / 15)`；repair 包含原始提示、上次输出、错误清单，要求输出完整数组）

- [ ] **Step 3: 测试 `json.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { extractJson } from "../../src/generator/json";
describe("extractJson", () => {
  it("直接 JSON", () => expect(extractJson('[{"a":1}]')).toEqual({ ok: true, value: [{ a: 1 }] }));
  it("剥离 ```json 围栏", () => expect(extractJson('```json\n[1,2]\n```')).toEqual({ ok: true, value: [1, 2] }));
  it("前后有解释文字时取首个 [ 到最后一个 ]", () => expect(extractJson('好的，如下：\n[1]\n以上。')).toEqual({ ok: true, value: [1] }));
  it("解析失败返回错误", () => expect(extractJson("不是 JSON").ok).toBe(false));
});
```

- [ ] **Step 4: 测试 `ingest.test.ts`**：样例讲解稿 → 11 段、`duration_ms = 420520`、`track_id`；`begin >= end` 抛错含 paragraph_id；乱序抛错；重复 id 抛错；空 text 抛错。

- [ ] **Step 5: 实现全部文件，`pnpm vitest run tests/generator` 通过，提交 `feat(generator): 术语表、提示词与基础模块`**

---

### Task 2: resolve.ts

**Files:** `src/generator/resolve.ts`，`tests/generator/resolve.test.ts`

**Interfaces:**

```ts
export const LEAD_MS = 300;
export function locate(text: string, quote: string): { index: number; exact: boolean } | null;
  // 精确 indexOf；失败则两边去掉 /[\s\p{P}\p{S}]/gu 后匹配并映射回原下标；仍失败 null
export interface ResolveCtx { paragraphById: Map<string, Paragraph>; prevAt: number }
export function resolveAt(anchor: Anchor, ctx: ResolveCtx): { at: number; warning?: string };
  // 段落不存在 → 抛 Error（调用方转为打回错误）
  // idx = locate ?? 0（警告）；at = begin + ratio × dur − LEAD_MS；at = max(at, begin, prevAt)；若 at === prevAt → +200
export function revealMs(kind: "board" | "mermaid", content: string, at: number, p: Paragraph): number;
export function untilMs(at: number, p: Paragraph): number;
export function resolveSection(raw: RawAction[], ctx: { paragraphById; prevAt }): { actions: LocalAction[]; warnings: string[]; errors: ValidationError[]; lastAt: number };
  // 逐条换算；锚点段落不存在 → errors（保留该动作占位以便打回时按 index 报错）
```

- [ ] **Step 1: 测试**（覆盖 §11 清单：精确匹配、去标点模糊匹配、匹配失败回退 idx 0 + warning、LEAD_MS、钳到 begin、单调性、同刻 +200、reveal 上下限 600/8000/段落剩余、mermaid 800、until = end_time 且 ≥ at + 1500；用 §5.5 的数字验证：c01 at ≈ 16600、reveal 2460，highlight at ≈ 57800）
- [ ] **Step 2: 实现；测试通过；提交 `feat(generator): 锚点换算与揭示时长`**

---

### Task 3: validate.ts 与 assemble.ts

**Files:** `src/generator/validate.ts`, `src/generator/assemble.ts`, `tests/generator/validate.test.ts`, `tests/generator/assemble.test.ts`

**Interfaces:**

```ts
// assemble.ts
export interface LayoutState { hasPage: boolean; columns: number; cardsInColumn: number; pageCards: { id: string; summary: string }[] }
export const initialLayout: LayoutState;
export function stepLayout(layout: LayoutState, action: LocalAction): LayoutState;   // 纯函数，模拟一条动作后的布局
export function boardStateSummary(layout: LayoutState): string;                       // 注入提示词的中文描述
export interface SectionResult { section: Section; actions: LocalAction[]; warnings: string[]; errors: string[]; dropped: LocalAction[]; usage: Usage; rounds: number }
export function assemble(results: SectionResult[]): Action[];  // 全局 a001… / c01…，节内 card_id 映射，target_card_id 同步替换
// validate.ts
export interface ValidationError { index: number; message: string }
export interface ValidateCtx { sectionTitle: string; sectionParagraphIds: Set<string>; layout: LayoutState }
export function validateSection(actions: LocalAction[], ctx: ValidateCtx): { actions: LocalAction[]; warnings: string[]; errors: ValidationError[]; layout: LayoutState }
export function checkMermaid(code: string): { ok: true; code: string; warnings: string[] } | { ok: false; error: string };
export function dropFailed(actions: LocalAction[], errors: ValidationError[]): { actions: LocalAction[]; dropped: LocalAction[] };  // 连带丢弃引用被丢卡片的标注
```

validateSection 规则清单（顺序执行、边走边模拟布局）：

| 情况 | 处理 |
|---|---|
| 首节尚无页面时出现 card / new_column | 自动插入 `new_page`（title = 节标题，anchor 同该动作）→ warning |
| 第 4 张卡片 | 插入 `new_column`（栏 < 3）否则 `new_page` → warning |
| 第 4 栏 | 该 `new_column` 改为 `new_page` → warning |
| 页标题 > 16 字 / mermaid 标题 > 12 字 | 截断 → warning |
| mermaid 含 style/classDef/class/linkStyle/click 行 | 删除 → warning，再检查 |
| snippet 精确不在卡片纯文本 → 去标点匹配成功 | 保留 → warning |
| 每卡第 3 个标注 | 丢弃 → warning |
| until ≤ at | until = at + 1500 → warning |
| board 纯文本 > 140 字或估算 > 9 行 | error |
| `#` 一级标题不在页首卡片、或 > 12 字、或一张卡多个 `#` | error |
| 图片 `![`、链接 `](`、HTML 标签、代码围栏 | error |
| 表格 > 4 列或 > 5 行；列表嵌套 > 2 层 | error |
| mermaid 不以 flowchart/graph + LR/TD/TB/RL/BT 开头、节点 > 8、节点文字 > 10 字、含 subgraph | error |
| target_card_id 不是本节此前出现的卡片 | error |
| 锚点段落不属于本节 | error |
| 卡片数 > ceil(节秒数 / 15) + 1 | error（超密） |

- [ ] **Step 1: 测试**（第 4 张卡自动分栏；第 4 栏自动翻页；snippet 不存在 → error；mermaid 节点 9 个 → error；样式行删除后通过；超预算 → error；`#` 不在页首 → error；dropFailed 连带丢标注；assemble 编号 a001/c01 与映射；stepLayout 模拟）
- [ ] **Step 2: 实现；测试通过；提交 `feat(generator): 校验、自动修正与全局装配`**

---

### Task 4: LLM 客户端

**Files:** `src/generator/llm/types.ts`, `anthropic.ts`, `openai-compatible.ts`, `fixture.ts`, `recording.ts`, `index.ts`；`tests/generator/fixture-client.test.ts`

```ts
export interface LlmRequest { system: string; user: string; maxTokens?: number }
export interface LlmResponse { text: string; usage: { input_tokens: number; output_tokens: number } }
export interface LlmClient { readonly model: string; complete(req: LlmRequest, tag: string): Promise<LlmResponse> }
export function createLlmClient(env: NodeJS.ProcessEnv): LlmClient;   // LLM_PROVIDER=anthropic|openai-compatible；缺 key 抛错说明 .env 怎么填
export function createFixtureClient(dir: string): LlmClient;          // 读 <dir>/<tag>.txt（tag 中 ":" → "-"）；缺文件抛错
export function withRecording(client: LlmClient, dir: string): LlmClient; // 每次调用把响应写到 <dir>/<tag>.txt
```

- anthropic.ts：`new Anthropic({ apiKey })`；`client.messages.create({ model, max_tokens: 8192, system, messages: [{ role: "user", content }] })`；不发 temperature；`stop_reason === "refusal" | "max_tokens"` 抛错；拼接 `text` 块；usage 取 `input_tokens/output_tokens`。
- openai-compatible.ts：`fetch(base + "/chat/completions")`，`Authorization: Bearer`，body `{ model, temperature: 0.3, messages: [system, user] }`；非 2xx 抛错含响应体前 300 字；usage 取 `prompt_tokens/completion_tokens`。

- [ ] **Step 1: fixture 客户端测试（读取 / 缺文件 / tag 映射）；实现四个文件；提交 `feat(generator): LlmClient 与 Anthropic / OpenAI-compatible / fixture 实现`**

---

### Task 5: outline / script / pipeline / report / cli

**Files:** `src/generator/outline.ts`, `script.ts`, `pipeline.ts`, `report.ts`, `cli.ts`；`tests/generator/pipeline.test.ts`；`tests/fixtures/llm/mini/*.txt`；`tests/fixtures/mini.transcript.json`

```ts
export async function askJson<T>(llm: LlmClient, req: LlmRequest, schema: z.ZodType<T>, tag: string, usage: Usage): Promise<{ ok: true; value: T; text: string } | { ok: false; error: string; text: string }>;
export async function generateOutline(llm, transcript, glossary, usage): Promise<Section[]>;   // 校验连续覆盖；失败 1 次 repair；仍失败抛错
export async function generateSection(llm, ctx: { section; paragraphs; glossary; layout; prevAt; usage }): Promise<SectionResult>;
  // 循环 round 0..2：askJson → resolveSection → validateSection → errors 空则结束；否则 round<2 用 repair 提示词重问；最后 dropFailed
export async function generate(opts: { transcript; glossary; llm; model: string; onProgress?(msg: string): void }): Promise<{ script: BoardScript; results: SectionResult[]; usage: Usage; issues: ScriptIssue[] }>;
  // assemble 后 parseScript 自检；issues 非空进报告 error
export function renderReport(r: GenerateResult, opts: { source: string }): string;
```

CLI：`tsx src/generator/cli.ts --in x --out y [--glossary config/glossary.json] [--dry-run] [--fixture dir] [--record dir]`；启动时若存在 `.env` 则 `process.loadEnvFile(".env")`；`--record` 默认 `out/<name>.llm/`；报告写 `out/<name>.report.md`；退出码：有 error 仍写出但返回 1。

- [ ] **Step 1: 手写 `tests/fixtures/mini.transcript.json`（2 段）与 fixture 响应：`outline.txt`、`script-s1.txt`（含 1 张超预算卡触发打回）、`repair-s1-1.txt`（修好）、`script-s2.txt`**
- [ ] **Step 2: `pipeline.test.ts`：fixture 跑通 → `parseScript` 通过、s1 rounds = 1、报告含 warning；第二个用例 `repair-s1-1/2` 都仍错 → 动作被丢弃且 errors 非空**
- [ ] **Step 3: 实现；`pnpm check` 全绿；提交 `feat(generator): outline / script 流水线、报告与 CLI`**

---

### Task 6: 真实生成与提示词迭代（需要 `.env`）

- [ ] `pnpm gen --in samples/aigc-career.transcript.json --out out/aigc-career.script.json`
- [ ] 读 `out/aigc-career.report.md`：error = 0；≥ 8 卡、每节 ≥ 1 卡、≥ 1 Mermaid、≥ 3 页
- [ ] 播放器打开 `/?script=out/aigc-career.script.json` 逐页看：骨架而非字幕、操作段是步骤清单、术语已纠正；不满意则改 `prompts/script.md` 重跑
- [ ] 回填 CLAUDE.md（6.5 Mermaid 正则、6.7 temperature、提示词文件格式、M2/M3 状态）；提交 `docs: M2/M3 完成`

## 自查

- §6.1–6.6 各有对应任务；§6.7 LLM 规范 → Task 4（temperature 差异已记入约束）；§6.8 → Task 1 提示词；§11 resolve/validate 测试清单 → Task 2/3；fixture 流程 → Task 5。
- 类型：`LocalAction` 在 Task 1 定义、Task 2/3/5 消费；`LayoutState` 在 Task 3 定义、Task 5 的 `generateSection` 与提示词 `board_state` 消费；`Usage` 贯穿。
