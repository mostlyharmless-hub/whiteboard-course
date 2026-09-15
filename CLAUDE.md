# whiteboard-course — 讲解稿 → AI 板书课程 原型

本文件是本仓库的唯一规格来源（single source of truth）。开始任何实现前先通读全文；凡涉及第 5 节数据契约、第 6 节处理流程、第 7 节播放器行为的改动，先改本文件（必要时附 `docs/adr/`），再改代码。本文件与代码不一致时，以本文件为准并修正代码。

---

## 1. 项目目标

输入一份带时间戳的课程讲解稿（ASR 字幕 JSON，见第 4 节），由大模型生成一份**板书脚本**（BoardScript，见第 5 节），再由播放器按原字幕时间轴、配合已有录播音频，把板书以"老师边讲边写"的方式逐步呈现出来：翻页、分栏、逐字书写、重点高亮、画圈强调。

效果参照 Hyperknow 的 AI 白板讲课页面（技术要点见附录 A），但本项目是**离线生成 + 时间轴播放**，不是实时 Agent。

一句话验收：把 `samples/aigc-career.transcript.json` 喂给生成器，得到的脚本在播放器中随音频播放，观感像一位老师在白板上讲这门课，而不是把字幕贴到屏幕上。

## 2. 系统边界

v1 范围内：

- 生成器 CLI：讲解稿 JSON → BoardScript JSON，含大纲划分、板书内容、时间对齐、校验与自动修正。
- 播放器（浏览器）：无限画布（平移/缩放）、页 → 栏 → 卡片布局、Markdown / Mermaid / KaTeX 渲染、手写风格、逐字揭示动画、高亮与画圈、相机自动跟随、页码导航、大纲侧栏、音频同步与拖动进度、无音频时的计时器模式、底部字幕。
- 样例课程端到端跑通，并有自动化测试覆盖生成器核心逻辑。

v1 之外、2026-09-15 按用户要求追加（ADR 004）：`pnpm tts` 用阿里云 Qwen3-TTS 逐段配音并按**原时间轴**拼成 mp3（时间轴仍完全来自原字幕）；`pnpm render` 把播放器逐帧渲染为 mp4 视频课；播放器 `?render=1`（无界面渲染模式）与 `?subtitles=`（用纠错后的讲解稿覆盖字幕）。

v1 明确不做：

- TTS 配音的时间轴驱动（配音只填充原时间轴，不改变 `begin_time / end_time`）。
- 学员互动：课堂提问、语音打断、聊天。
- AI 生图、生成动画、参考资料阅读。
- 用户在板书上批注、编辑、多人协作、导出图片/PDF。
- 后端服务、账号体系、持久化存储（输出即 `out/*.script.json` 文件）。
- 并入 cowork 平台（原型验证后另立方案）。

## 3. 核心概念与术语

| 术语 | 含义 |
|---|---|
| 讲解稿 Transcript | 输入的 ASR 字幕 JSON，段落数组，每段带毫秒级起止时间 |
| 大纲 Outline | 生成器第一遍 LLM 产出：把段落划分为若干小节（Section），给出标题与教学意图 |
| 板书脚本 BoardScript | 生成器最终产物，播放器唯一输入。由元信息、小节列表、按时间排序的动作列表组成 |
| 动作 Action | 脚本中的一条指令：新建页、新建栏、写板书卡片、画 Mermaid 图、高亮、画圈 |
| 卡片 Card | 板书的基本单元，一段 Markdown 或一张 Mermaid 图，落在某页某栏中 |
| 锚点 Anchor | LLM 给动作标注的"说到哪句话时发生"，由生成器换算为毫秒时间 |
| 揭示 Reveal | 卡片出现时的逐字书写动画，时长由生成器按字数计算 |
| 页 Page | 一块 16:9 的逻辑白板（1600 × 900 逻辑像素），最多 3 栏 |
| 栏 Column | 页内纵向堆叠卡片的一列，最多 3 张卡片 |

## 4. 输入：讲解稿格式

生成器只消费 `data.paragraphs`，其余字段忽略。

```jsonc
{
  "code": 200,
  "msg": "获取成功",
  "data": {
    "paragraphs": [
      {
        "text": "大家好，本节课程将系统讲解如何借助aig c工具高效制定职业规划。……",
        "begin_time": 10080,        // 毫秒
        "end_time": 32588,          // 毫秒
        "speaker_id": "1",
        "paragraph_id": "1781165726319500000"
      }
    ],
    "full_text": "……"
  },
  "track_id": "c4ae4ace33b18563f8087dbd6ba6faf6"
}
```

关于输入必须知道的事实：

- 文本是 ASR 结果，含识别错误（样例中 `aig c` = AIGC，`deep seek` = DeepSeek，`n lp` = NLP，`CTR / CTL` = Ctrl，`第22个指令` = 第二个指令，`引导RPA` 疑为某 RPA 产品名，待确认）。板书文字必须使用纠正后的术语；纠正规则集中在 `config/glossary.json`，由生成器注入提示词。
- **锚点引用必须逐字取自原文（含 ASR 错误）**，因为时间换算要在原文里定位；纠错只作用于板书内容，永远不改讲解稿本身。
- 段落之间可能有静默间隙（样例中 291800 → 292010、347540 → 353900），段落内部没有更细的时间信息，段内时间按字符位置线性插值。
- 时长以最后一段的 `end_time` 为准；第一段之前的时间（样例 0 → 10080）画布为空。

## 5. 数据契约：BoardScript

TypeScript 类型定义在 `src/shared/schema.ts`（zod schema 是权威实现，本节是它的规格）。`src/shared/` 同时被生成器（Node）和播放器（浏览器）引用，不得依赖任一端的运行时。

### 5.1 顶层结构

```ts
interface BoardScript {
  version: "1.0";
  meta: {
    title: string;                 // 课程标题（LLM 从内容归纳）
    source_track_id?: string;
    duration_ms: number;           // = 最后一段 end_time
    generated_at: string;          // ISO 8601
    model: string;                 // 生成所用模型标识
  };
  paragraphs: Paragraph[];         // 原样透传，供播放器显示字幕、按段定位
  sections: Section[];             // 大纲，供侧栏与跳转
  actions: Action[];               // 按 at 升序；同一 at 按数组顺序
}

interface Paragraph {
  paragraph_id: string;
  text: string;
  begin_time: number;
  end_time: number;
}

interface Section {
  id: string;                      // "s1", "s2", ...
  title: string;                   // ≤ 16 字
  intent: string;                  // 一句话教学意图，仅供生成第二遍使用与侧栏 tooltip
  paragraph_ids: string[];         // 连续、不重叠、全体段落恰好被覆盖一次
  begin_ms: number;                // = 首段 begin_time
  end_ms: number;                  // = 末段 end_time
}
```

### 5.2 Action 类型

所有动作共有字段：`id: string`（全局唯一，"a001" 递增）、`at: number`（毫秒，生成器由锚点换算）、`anchor: Anchor`（LLM 原始锚点，保留以便追溯）。

```ts
type Action = NewPage | NewColumn | Board | Mermaid | Highlight | Circle;

interface NewPage   { type: "new_page";   title: string }          // 页标题，≤ 16 字，显示在页码导航
interface NewColumn { type: "new_column" }
interface Board {
  type: "board";
  card_id: string;                 // 全局唯一，"c01" 递增
  content: string;                 // Markdown，见 5.4 预算
  reveal_ms: number;               // 生成器计算，LLM 不输出
}
interface Mermaid {
  type: "mermaid";
  card_id: string;
  title?: string;                  // ≤ 12 字
  code: string;                    // Mermaid 源码，仅允许 flowchart / graph
  reveal_ms: number;
}
interface Highlight {
  type: "highlight";               // 荧光笔划过一段文字
  target_card_id: string;
  snippet: string;                 // 目标卡片纯文本中的精确子串，≤ 20 字
  until: number;                   // 毫秒，生成器默认 = 所在段落 end_time
}
interface Circle {
  type: "circle";                  // 手绘椭圆圈住一段文字
  target_card_id: string;
  snippet: string;
  until: number;
}
```

语义约束（校验器强制）：

- `actions[0]` 必须是 `new_page`。
- `board` / `mermaid` 落在"当前页的当前栏"；`new_page` 后隐含第一栏，不需要再发 `new_column`。
- `highlight` / `circle` 的 `target_card_id` 必须指向已出现的卡片，且该卡片在当前页（不跨页标注）。
- `at` 单调不减；`until > at`。
- 所有 `at` ∈ [0, duration_ms]。

### 5.3 Anchor：LLM 如何标时间

LLM 不输出毫秒，只输出锚点；生成器换算（第 6.4 节）。

```ts
interface Anchor {
  paragraph_id: string;            // 必须存在
  quote: string;                   // 该段原文中的精确子串，6–20 字，取"说到这句话时写板书"的那句开头
}
```

### 5.4 内容预算（校验器强制，超出即修正或打回）

板书是**板书**，不是字幕：写关键词、结构、步骤、对比、结论，不抄句子。

| 对象 | 上限 |
|---|---|
| 单张 `board` 卡片 | 纯文本 ≤ 140 字（去除 Markdown 标记后，CJK 一字计 1，英文单词计 1）；估算行数 ≤ 9（每行按 20 字折算） |
| 卡片内标题 | 一级 `#` 仅用于页首卡片，≤ 12 字；其余用 `##` 或加粗 |
| 允许的 Markdown | 标题、段落、有序/无序列表（≤ 2 层）、加粗、行内代码、引用块、≤ 4 列 × 5 行的表格、KaTeX 行内 `$…$` 与块级 `$$…$$` |
| 禁止的 Markdown | 图片、链接、HTML、代码块（```） |
| `mermaid` 卡片 | 仅 `flowchart LR/TD` 或 `graph LR/TD`；节点 ≤ 8，节点文字 ≤ 10 字；不用子图、样式类、点击事件 |
| 每栏 | ≤ 3 张卡片 |
| 每页 | ≤ 3 栏 |
| 密度 | 平均每 15 秒不多于 1 张卡片；允许长时间空白（操作演示段落只写步骤要点） |
| `highlight` / `circle` | 每张卡片 ≤ 2 次标注；`snippet` 必须是该卡片纯文本的子串 |

### 5.5 示例：样例课程前两段的期望产出

LLM 第二遍的原始输出（未换算时间）：

```jsonc
[
  { "type": "new_page", "title": "AIGC 助力职业规划",
    "anchor": { "paragraph_id": "1781165726319500000", "quote": "大家好，本节课程" } },
  { "type": "board", "card_id": "c01",
    "content": "# AIGC 助力职业规划\n\n**三大核心环节**\n1. 岗位信息智能采集\n2. 核心能力 AI 分析\n3. 行业背景挖掘\n\n工具：RPA · DeepSeek",
    "anchor": { "paragraph_id": "1781165726319500000", "quote": "我们将聚焦三大核心环节" } },
  { "type": "new_column",
    "anchor": { "paragraph_id": "1781165749019500000", "quote": "本职业规划体系采用三级分析框架" } },
  { "type": "mermaid", "card_id": "c02", "title": "三级分析框架",
    "code": "flowchart LR\n  A[岗位信息采集] --> B[核心能力分析] --> C[行业背景整合]",
    "anchor": { "paragraph_id": "1781165749019500000", "quote": "本职业规划体系采用三级分析框架" } },
  { "type": "board", "card_id": "c03",
    "content": "## 数据 · 能力 · 环境\n- **数据**：岗位信息采集 → 原始数据\n- **能力**：NLP 把职责描述转为硬技能 / 软技能量化模型\n- **环境**：政策法规 + 市场趋势 → 决策支撑\n\n三者形成**闭环分析链**",
    "anchor": { "paragraph_id": "1781165749019500000", "quote": "首先通过岗位信息采集" } },
  { "type": "highlight", "target_card_id": "c03", "snippet": "闭环分析链",
    "anchor": { "paragraph_id": "1781165749019500000", "quote": "形成数据、能力、环境的闭环分析链" } }
]
```

生成器换算后：`new_page` 的 quote 在第 1 段开头，减 300 ms 后早于 `begin_time`，被钳到 `at = 10080`；`c01` 的 quote 位于第 1 段第 33 / 109 字处，`at = 10080 + 0.30 × 22508 − 300 ≈ 16 600`，`reveal_ms ≈ 2 460`（纯文本 41 字 × 60 ms）；`highlight` 的 quote 在第 2 段第 113 / 149 字处，`at ≈ 57 800`，`until = 66160`。第三段起进入"第一环节：岗位信息智能采集"，应 `new_page`，后续操作步骤用有序列表卡片按指令逐条揭示，而不是把操作旁白抄上去。

## 6. 生成器（`src/generator/`）

CLI：`pnpm gen --in <transcript.json> --out <script.json> [--glossary config/glossary.json] [--dry-run] [--fixture <dir>]`

`--fixture` 指向预录的 LLM 响应目录，用于离线测试；有 fixture 时不调用 LLM。

### 6.1 ingest

- 解析输入，只取 `data.paragraphs`；校验 `begin_time < end_time`、段落按 `begin_time` 升序、`paragraph_id` 唯一、`text` 非空。
- 计算 `duration_ms`。
- 不修改任何文本。

### 6.2 outline（LLM 第一遍）

- 输入：全部段落（含 id 与起止秒数）、术语表。
- 输出：`Section[]`（不含 `begin_ms / end_ms`，由生成器补），要求：连续覆盖全部段落；一节通常 1–3 段、30–120 秒；标题用纠正后的术语；`intent` 说明这一节该在白板上呈现什么（结构 / 步骤 / 对比 / 结论）。
- 讲解稿超过 8 000 字时分块做大纲再合并（样例不需要）。

### 6.3 script（LLM 第二遍，逐节）

- 每节一次调用。输入：本节段落原文、本节 `intent`、术语表、上一节最后一页的卡片纯文本摘要（防止重复写）、当前页/栏占用情况（已用几栏、当前栏几张卡）。
- 输出：本节的 `Action[]`（原始形态，无 `at / reveal_ms / until / id`）。
- 卡片 id 由生成器在合并时重新编号，LLM 输出的 `card_id` 只需节内唯一；`target_card_id` 只能引用本节卡片。

### 6.4 resolve timing

```
resolveAt(anchor):
  p = paragraphs[anchor.paragraph_id]          // 不存在 → 错误，打回该节
  idx = locate(p.text, anchor.quote)           // 精确匹配；失败则去掉标点空白后模糊匹配；仍失败 → 警告，idx = 0
  ratio = idx / p.text.length
  at = p.begin_time + ratio * (p.end_time - p.begin_time) - LEAD_MS   // LEAD_MS = 300，老师先落笔再开口
  at = max(at, p.begin_time, prevActionAt)     // 单调不减，不早于本段开始
  若与前一动作 at 相同 → +200 ms

reveal_ms(board) = clamp(chars * 60, 600, min(8000, p.end_time - at))
reveal_ms(mermaid) = 800
until(highlight|circle) = p.end_time（不早于 at + 1500）
```

装配后的时间轴后处理（ADR 005，2026-09-15）：有语音时白板不能为空。`new_page` 若锚在某段开头，可提前进入前面的静默（`at = max(上一段 end_time, begin_time − 2000, 前一动作 at)`）；翻页后到第一张卡之间的动作一律提前到 `new_page` 时刻。这是对"不早于本段开始"的唯一例外。`pnpm timeline --in --out` 可对已有脚本套用；报告有"有语音但白板为空"指标，验收要求 0。

### 6.5 validate & autofix

用 zod 校验结构，再做语义校验（第 5.2、5.4 节全部规则）。分两类处理：

- 可自动修正（修正后记录 warning）：第 4 张卡片到来时自动插入 `new_column`；第 4 栏到来时自动插入 `new_page`（标题沿用当前节标题）；`snippet` 不匹配时尝试去标点匹配；`until ≤ at` 时改为 `at + 1500`；Mermaid 语法解析失败时先尝试删除样式行。
- 需打回 LLM 重生（附带错误清单，最多 2 轮）：卡片超预算、使用禁止语法、`target_card_id` 不存在、锚点段落不存在、Mermaid 仍解析失败。2 轮后仍失败则丢弃该动作并记录 error，生成继续。

Mermaid 校验在 Node 侧用 `mermaid` 的 `parse()`（需要 jsdom 环境）；如引入 jsdom 成本过高，退化为正则检查 `flowchart|graph (LR|TD)` 开头且节点数 ≤ 8，并在文档中记录。**当前实现：正则检查**（`validate.ts` 的 `checkMermaid`）——头部 `flowchart|graph + LR|TD|TB|RL|BT`、节点 ≤ 8、节点文字 ≤ 10 字、禁止 subgraph；`style / classDef / class / linkStyle / click` 行先自动删除（warning）。真正的语法错误由播放器渲染时报出。

其他实现细节：打回错误的 `index` 指向 LLM 原始数组下标；两轮后丢弃出错动作并连带丢弃引用被丢卡片的标注；每节卡片上限 `ceil(秒 / 15) + 1`（超出打回）；标注跨页（自动翻页导致）降级为 warning 并丢弃；标题超长截断（warning）。

### 6.6 output

写出 `out/<name>.script.json`，同时写 `out/<name>.report.md`：每节卡片数、密度、warnings / errors、被丢弃的动作。`--dry-run` 只打印报告。

### 6.7 LLM 调用规范

- 通过 `src/generator/llm/` 的 `LlmClient` 接口调用，默认实现 Anthropic（`@anthropic-ai/sdk`）；预留 OpenAI-compatible 实现（供国内模型接入），二者切换只改 `.env` 的 `LLM_PROVIDER / LLM_MODEL / LLM_BASE_URL / LLM_API_KEY`。
- 只要 JSON：system prompt 声明"只输出 JSON，不要 Markdown 代码围栏"；解析前剥离可能的围栏；解析失败视为一次校验失败，走打回流程。
- temperature 0.3 **只用于 OpenAI-compatible**；Anthropic 当前型号（Opus 5 / Sonnet 5）已移除 `temperature` 参数（发送即 400），Anthropic 路径不发该参数、用默认 adaptive thinking，默认型号 `claude-opus-5`。每次调用记录 token 用量到报告。
- 提示词是文件不是代码：`prompts/outline.md`、`prompts/script.md`、`prompts/repair.md`，用 `{{placeholder}}` 注入。改提示词不需要改代码。文件格式：一行 `===== USER =====` 之前是 system，之后是 user 模板。大纲提示词同时产出课程标题（`meta.title`）。
- `--record <dir>`（默认 `out/<name>.llm/`）把每次调用的提示词（`<tag>.prompt.md`）与响应（`<tag>.txt`）落盘，响应文件可直接作为 `--fixture` 目录复现；tag 形如 `outline`、`script:s1`、`repair:s1:1`（文件名中 `:` 换成 `-`）。
- 健壮性：OpenAI-compatible 单次请求默认 5 分钟超时（`LLM_TIMEOUT_MS` 覆盖；qwen3.8-max 带推理时一节 2–3.5 分钟），超时 / 网络错误 / 429 / 5xx 重试一次；某一节的传输或接口错误只记为该节 error（报告可见），其余节继续生成。

### 6.8 提示词要点（写进 `prompts/script.md` 的核心要求）

1. 你是一位在白板上讲课的老师，板书是给学生看的骨架，不是讲稿复述。
2. 每张卡片只承担一个目的：结构总览 / 步骤清单 / 概念对比 / 结论金句 / 流程图。
3. 讲操作演示时，只写"第 N 步：做什么"，忽略界面点击细节。
4. 用术语表纠正 ASR 错误；锚点 `quote` 必须逐字复制原文。
5. 新话题开新页；同一话题的并列内容开新栏；一栏最多 3 张卡。
6. 值得强调的结论用 `highlight`，需要引起注意的关键词用 `circle`，全课不超过 8 次标注。
7. 严格遵守预算表（把第 5.4 节整表放进提示词）。
8. 输出格式：JSON 数组，字段名与第 5.2 节一致。

## 7. 播放器（`src/player/`）

Vite + React 18 单页应用，`pnpm dev` 启动后通过 `?script=out/aigc-career.script.json&audio=samples/aigc-career.mp3` 加载；无 `audio` 参数时进入计时器模式。

### 7.1 时钟与状态模型

- 时钟源二选一：`HTMLAudioElement.currentTime`（有音频）或内部计时器（无音频，支持播放/暂停/倍速/拖动）。播放器逻辑只认一个 `t: number`（毫秒）。
- 状态是时间的纯函数：`state(t) = fold(apply, initial, actions.filter(a => a.at <= t))`。前进时增量应用新动作，后退（拖动进度）时从头重算。动作数量级为几十，重算成本可忽略，不要做快照优化。
- `apply` 维护：页列表（每页含栏，栏含卡片 id）、卡片表、当前页索引、当前栏索引、活动标注列表（`at ≤ t < until`）。
- 揭示进度不进状态：每帧按 `progress = clamp((t - card.at) / card.reveal_ms, 0, 1)` 计算。
- 当前字幕、当前小节同样由 `t` 二分查找得到。

### 7.2 画布与布局

- 自定义 pan/zoom 容器（`transform: translate(...) scale(...)` 作用于 world 层），滚轮缩放、拖拽平移、双击复位。不引入 Excalidraw（附录 A 说明原因）。
- 页逻辑尺寸 1600 × 900，内边距 48，栏间距 32，栏宽 (1600 − 96 − 64) / 3 ≈ 480。每次只显示当前页；翻页动作把相机切到新页并清空上一页的活动标注。
- 栏内卡片自上而下堆叠，间距 24，高度由内容决定。运行时若一栏实际高度超出 804，把该栏整体 `scale` 缩到容纳为止，并在控制台 warn（生成器预算是第一道防线，这是兜底）。
- 布局完全在浏览器内用真实 DOM 尺寸计算；脚本不含坐标。

### 7.3 卡片渲染与手写风格

- Markdown 用 `markdown-it` 渲染，`katex` 插件处理公式，禁用 html。
- Mermaid 用 `mermaid` ≥ 11，`look: "handDrawn"`，字体设为手写字体。渲染是异步的，卡片先占位再替换，不阻塞主时钟。
- 字体：中文手写体（小赖字体 Xiaolai，或霞鹜文楷 LXGW WenKai，二选一，见第 13 节）+ 拉丁 Virgil / Excalifont；全部自托管在 `public/fonts/`，`font-display: swap`（Xiaolai 单文件；Excalifont 沿用 excalidraw 仓库的 7 个 unicode-range 子集）。`--font-hand` 回退栈落到本机楷体（Kaiti SC / STKaiti），见 `public/fonts/README.md`。字号：页首 `#` 30px，`##` 24px，正文 21px。
- 手绘感：卡片边框、引用竖线套用 SVG 滤镜 `feTurbulence(fractalNoise, baseFrequency 0.035, numOctaves 2) + feDisplacementMap(scale 2.2)`；文字不套滤镜（会糊）。表格线暂不套滤镜——表格的边框与文字在同一元素上，滤镜会把文字一起糊掉，M1 保留直线。每张卡片按 `card_id` 哈希取 −0.4° 到 0.4° 的微小旋转。
- Mermaid 用 `securityLevel: strict`（默认）、`htmlLabels: false`、字号 20px；Markdown 渲染关闭 html、图片退化为替代文字、链接只保留文字，因此 `dangerouslySetInnerHTML` 只接收已转义内容。
- 配色：墨色 `#1e1e1e`，卡片底透明（白板本身是米白 `#fbfaf7` + 点阵），荧光笔 `rgba(255, 214, 0, .45)`，圈选 `#e03131`。

### 7.4 揭示动画

- `board` 卡片：渲染完成后遍历文本节点，把每个字符包成 `<span class="ch">`，按 `progress` 显示前 `floor(progress × total)` 个字符，其余 `visibility: hidden`（占位不重排）。末尾跟一个小的笔尖光标，`progress = 1` 时消失。
- `mermaid` 卡片：整体 `opacity` 0 → 1，配合 `reveal_ms`。
- 拖动进度条到任意时间，卡片按该时刻的 `progress` 直接显示对应状态，不播放动画。

### 7.5 高亮与画圈

- 在目标卡片 DOM 的纯文本中定位 `snippet`，用 `Range` 取包围盒。
- `highlight`：在包围盒位置叠一条荧光笔矩形（略宽于文字、略倾斜），从左到右 400 ms 划出。
- `circle`：叠一条手绘椭圆 SVG 路径（两圈略错位的椭圆，起点带抖动），`stroke-dasharray` 600 ms 画出。
- `until` 到时淡出；翻页即清除。

### 7.6 相机跟随与翻页

- 默认"跟随"模式：新卡片出现时，相机平滑移动使该卡片可见（优先整页可见，页放不进视口时聚焦当前栏）。
- 用户手动平移/缩放后暂停跟随 8 秒，或点击"跟随"按钮恢复。
- `new_page` 时切页动画 300 ms；页码导航可手动翻看历史页，不影响播放。

### 7.7 UI 组成

- 顶栏：课程标题、缩放 pill（−/百分比/+）、页码导航（‹ 当前/总 ›）、跟随开关。
- 左侧栏（可折叠）：小节大纲，当前节高亮，点击跳转到该节 `begin_ms`。
- 底部：播放/暂停、进度条（带小节刻度）、时间、倍速、字幕开关；字幕显示当前**句子**：在当前段落内按句末标点（。！？；）切句，按字符位置线性插值定位（与 6.4 的锚点换算规则一致，`shared/lookup.ts` 的 `sentenceAt`）。整段 ASR 文本过长，直接显示会盖住板书。
- 快捷键：空格播放/暂停，← / → 前后 5 秒。
- 界面文案中文；不用组件库，纯 CSS，保持依赖最少。

## 8. 目录结构

```
whiteboard-course/
├── CLAUDE.md                      # 本文件
├── package.json                   # 单包，pnpm；scripts: dev / gen / test / check
├── .env.example                   # LLM_PROVIDER / LLM_MODEL / LLM_BASE_URL / LLM_API_KEY
├── config/
│   └── glossary.json              # ASR 术语纠正表
├── prompts/
│   ├── outline.md
│   ├── script.md
│   └── repair.md
├── samples/
│   ├── aigc-career.transcript.json   # 样例讲解稿（本仓库自带）
│   └── aigc-career.mp3               # 样例音频（如可提供；缺失时用计时器模式）
├── out/                           # 生成产物，git 忽略
├── docs/
│   ├── adr/                       # 契约/流程变更记录
│   └── hyperknow-analysis.md      # 参考实现调研
├── src/
│   ├── shared/                    # 纯类型与纯函数，Node/浏览器共用
│   │   ├── schema.ts              # zod schema + 类型导出 + validateSemantics / parseScript
│   │   ├── budget.ts              # 纯文本字数/行数估算、预算常量
│   │   ├── reducer.ts             # apply(state, action)、stateAt(actions, t)、countApplied
│   │   └── lookup.ts              # paragraphAt / sentenceAt / sectionAt（按 t 二分）
│   ├── generator/
│   │   ├── cli.ts
│   │   ├── ingest.ts
│   │   ├── outline.ts
│   │   ├── script.ts
│   │   ├── resolve.ts             # 锚点 → 毫秒、reveal_ms、until
│   │   ├── validate.ts            # 校验 + autofix + 打回
│   │   ├── report.ts
│   │   └── llm/                   # LlmClient 接口、anthropic.ts、openai-compatible.ts、fixture.ts
│   ├── tts/                       # pnpm tts：术语纠错 → DashScope Qwen3-TTS → 按原时间轴 ffmpeg 拼接（ADR 004）
│   ├── render/                    # pnpm render：Playwright 逐帧截图 → ffmpeg 合成 mp4（ADR 004）
│   └── player/
│       ├── renderHooks.ts         # ?render=1 时暴露 window.__player（setTime / waitReady）
│       ├── main.tsx               # 读 URL 参数、加载校验、挂载；失败时列出第几条动作
│       ├── App.tsx                # 时钟 + 状态 + 相机跟随 + UI 组合
│       ├── loadScript.ts
│       ├── clock/                 # useClock（audio / timer）
│       ├── state/                 # useBoardState（前进增量、后退重算）
│       ├── canvas/                # layout 常量、PanZoom、Page、Column、Card、Marks
│       ├── render/                # markdown、mermaid、reveal（字符拆分、snippet 定位）
│       ├── ui/                    # TopBar、Sidebar、BottomBar、Subtitle
│       └── styles/                # fonts.css、board.css、ui.css
├── tests/
│   ├── shared/                    # schema、budget、reducer、lookup、fixtures
│   ├── generator/                 # resolve、validate（用 fixtures）
│   ├── fixtures/                  # minimal.script.json（6 条动作）、demo.script.json（样例课程手写 3 页+）、预录 LLM 响应
│   └── e2e/                       # Playwright：计时器模式下定点截图
├── docs/superpowers/plans/        # 各里程碑的实施计划
└── .claude/launch.json            # `pnpm dev` 的浏览器预览配置
```

## 9. 技术选型与依赖

| 用途 | 选择 | 说明 |
|---|---|---|
| 语言 | TypeScript 5，`strict: true`，禁止 `any` | 共享代码不含运行时依赖 |
| 包管理 | pnpm，单包 | 原型阶段不做 workspace |
| 前端 | React 18 + Vite | 函数组件 + hooks，状态用 `useReducer` + context，不引入状态库 |
| Markdown | markdown-it 15 + @vscode/markdown-it-katex | 关闭 html；后者是 CJS `exports.default`，默认导入需兼容"函数"与"模块对象"两种形态（见 `render/markdown.ts`） |
| 公式 | katex | 自托管 CSS 与字体 |
| 图表 | mermaid ≥ 11 | `look: "handDrawn"` |
| 校验 | zod | schema 即契约 |
| LLM | @anthropic-ai/sdk；OpenAI-compatible 用 fetch 实现 | 型号由 `.env` 决定，不写死在代码 |
| CLI | tsx | `pnpm gen` |
| 测试 | vitest；Playwright（浏览器已预装，不要执行 `playwright install`） | |
| 样式 | Tailwind（可选）或纯 CSS | 不用 UI 组件库 |

新增任何依赖前先在 PR 说明里写明用途；能用 100 行内代码解决的不引入库。

## 10. 开发规范

- 先读本文件再动手；实现与本文件冲突时停下来改文件，不要"顺手"改契约。
- 契约（第 5 节）、时间换算规则（6.4）、预算（5.4）的改动必须附一条 `docs/adr/NNN-*.md`：背景、决定、影响。
- `src/shared/` 不得 import Node 或浏览器特有 API。
- 生成器的每一步都是纯函数 + 明确的输入输出，LLM 调用集中在 `llm/`，其余代码可在无网络下用 fixture 跑通。
- 播放器不做任何"猜测式"布局：脚本合法则一定能渲染；脚本不合法在加载时报错并指出第几条动作。
- 提交信息：`feat(generator): …` / `fix(player): …` / `docs: …` / `test: …`。
- 代码注释与界面文案用中文，标识符用英文。
- 每完成一个里程碑（第 12 节）跑 `pnpm check`（tsc + vitest + eslint）再提交。

## 11. 测试与验收

单元测试（vitest）：

- `schema`：合法/非法脚本各若干；`actions[0]` 非 `new_page` 报错。
- `budget`：字数统计（CJK / 英文 / Markdown 标记剥离）、行数估算。
- `resolve`：精确匹配、去标点模糊匹配、匹配失败回退、LEAD_MS、单调性、同刻 +200 ms、`reveal_ms` 上下限、`until` 规则。
- `validate`：第 4 张卡自动分栏、第 4 栏自动翻页、`snippet` 不存在打回、Mermaid 节点超限打回、2 轮失败后丢弃并记 error。
- `reducer`：任意 `t` 下 `state(t)` 与逐步应用结果一致；后退重算一致；活动标注随 `until` 消失。

端到端（Playwright，计时器模式，不依赖 LLM 与音频；`pnpm e2e`，不在 `pnpm check` 内）：

- 加载 `tests/fixtures/minimal.script.json`（手写的 6 条动作脚本），用 `?t=` 分别定位到 4 个时间点截图，断言卡片数量、当前页码、字幕文本、标注图元数；检查控制台无 error（字体文件缺失的 OTS 警告是 warning，不计）。
- 样例课程的真实 LLM 响应录制在 `tests/fixtures/llm/aigc-career-qwen/`，`tests/generator/sample.test.ts` 用它离线复现整条流水线并断言下面"样例验收"的结构指标。

样例验收（需要 LLM，手动执行）：

- `pnpm gen --in samples/aigc-career.transcript.json --out out/aigc-career.script.json` 成功，报告中 error 为 0。
- 脚本满足：≥ 8 张卡片；每个小节至少 1 张卡片；至少 1 张 Mermaid；≥ 3 页；所有 `at` 在时长内；每张卡片 `at + reveal_ms ≤ 所在段落 end_time`。
- 播放器随音频（或计时器）播放全程无报错；跟随模式下每张新卡片出现时在视口内；拖动进度到任意位置状态正确。
- 人工观感：板书是骨架而非字幕；操作演示段落呈现为步骤清单；术语已纠正。

## 12. 实施顺序

1. **M1 播放器骨架（不依赖 LLM）** ✅ 2026-09-15 完成（分支 `feat/m1-player-skeleton`，计划见 `docs/superpowers/plans/2026-09-15-m1-player-skeleton.md`）：`shared/schema`、`shared/reducer`、手写 `tests/fixtures/minimal.script.json`（覆盖全部 6 种动作）与 `demo.script.json`，播放器计时器模式跑通：画布、布局、Markdown/Mermaid 渲染、逐字揭示、高亮/画圈、翻页、字幕。`pnpm dev` 后打开 `/?script=tests/fixtures/demo.script.json` 评估观感。遗留：字体文件待放入 `public/fonts/`；Playwright 用例留到 M4。
2. **M2 生成器离线链路** ✅ 2026-09-15 完成（计划见 `docs/superpowers/plans/2026-09-15-m2-m3-generator.md`）：`ingest / resolve / validate / assemble / report` + fixture 客户端，`tests/generator/` 59 个用例，`pnpm gen --fixture tests/fixtures/llm/mini` 可离线跑通。
3. **M3 接入 LLM** ✅ 2026-09-15 完成：阿里云 `qwen3.8-max`（OpenAI 兼容模式）对样例课程两次真实生成均 error 0、warning 0、7 节全部首轮通过，验收指标全部满足。提示词迭代记录：v1 几乎只用左栏（每页 `1+2 / 3+2 / 3+2 / 3 / 1 / 1`）、标注 9 次；加入"横向铺开"与"标注按节数分摊"后 v2 为 `1+1+1 / 1+1+1 / 1+2+2 / 1+1+1 / 1+1 / 1`、标注 5 次、Mermaid 6 张。随后加了"流程图只在有分支/循环/依赖时才画"一条（尚未用真实生成验证）。v1 响应作为离线回归 fixture（`tests/fixtures/llm/aigc-career-qwen/`）。
4. **M4 收尾**：音频模式、相机跟随细节、Playwright 用例、`docs/adr` 补齐、README（运行方式与已知限制）。已完成（2026-09-15）：`pnpm e2e`（`tests/e2e/player.spec.ts`，`@playwright/test` 锁定 1.61.1 以匹配本机缓存的 chromium 1228；含静音 WAV 的音频模式用例）、`docs/adr/001–003`、README、播放器 `?t=` 初始定位参数、小视口聚焦当前栏、手写字体文件。**未完成**：用真实录播音频实测音频模式（缺样例 mp3）。

5. **M5 配音与视频导出**（v1 之外，用户追加，ADR 004）✅ 2026-09-15：`pnpm tts`（Qwen3-TTS Ethan，样例 11 段全部放进原时间窗、无需加速，`samples/aigc-career.tts.mp3` 420.5 s）、`pnpm render`（1920×1080 @ 25 fps，约 1× 实时）、播放器 `?render=1` / `?subtitles=`，e2e 覆盖渲染模式。成片 `out/aigc-career.mp4`（v2 脚本 + 配音）。

每个里程碑结束时更新本文件中与实现不符的描述。

## 13. 待确认事项

实现前不阻塞，按默认值推进；有结论后回填本节。

| 事项 | 默认值 | 说明 |
|---|---|---|
| 样例课程音频 | 无则用计时器模式 | 有 mp3/mp4 时放 `samples/` |
| 术语表初始内容 | `aig c→AIGC`、`deep seek→DeepSeek`、`n lp→NLP`、`CTR/CTL→Ctrl`、`第22个指令→第二个指令` | `引导RPA` 疑为具体产品名，待课程方确认后加入 |
| LLM 供应商与型号 | ✅ 阿里云私有端点（OpenAI 兼容模式）+ `qwen3.8-max` | 2026-09-15 确认；两种实现都已就绪，Anthropic 路径默认 `claude-opus-5`。qwen3.8-max 带推理，每节 2–3.5 分钟，样例一次通过验收 |
| 中文手写字体 | 小赖字体（Xiaolai，OFL） | ✅ 已放入 `public/fonts/`：`Xiaolai-Regular.ttf`（v3.126，22 MB）+ Excalifont 7 个 unicode-range 子集（65 KB），来源见其 README。原型不做子集化；备选霞鹜文楷 |
| 页逻辑尺寸 | 1600 × 900 | 若后续嵌入平台侧栏布局，可能需要 4:3 |
| 字幕默认显示 | 显示，可关 | |

## 附录 A：Hyperknow 参考实现要点

来源：对 agent.hyperknow.io 白板讲课页的运行时调研（完整版见 `docs/hyperknow-analysis.md`）。

- 画布用 Excalidraw，但配置为 view-mode + zen-mode，场景元素为空；真正的板书是叠在画布之上的 HTML overlay（`overlay-note-card`），由 Markdown 渲染，随 Excalidraw 的 scroll / zoom 同步位移缩放。Excalidraw 只贡献坐标系与背景。本项目因此直接自写 pan/zoom 容器，不引入 Excalidraw；日后若需要用户批注，再考虑替换底盘。
- 手写感来自手写字体（Virgil / 小赖）与 SVG `feTurbulence + feDisplacementMap` 滤镜，不生成矢量笔画。
- 布局模型 page → column → item，由服务端下发 `new_page / new_column / board`，客户端负责同栏堆叠。
- 高亮/画圈以"目标卡片 + 文本片段（或相对矩形）"描述，不用绝对坐标。
- 板书到达后按文本长度渐进揭示，揭示完成再回执服务端推进下一步，保证语音与板书对齐。本项目是离线时间轴，把这条规则转化为 `reveal_ms ≤ 段落剩余时长` 的生成期约束。
- 内容块类型除 Markdown 卡片外还有 AI 生图、生成动画、Mermaid 图；本项目 v1 只保留 Markdown 与 Mermaid。
