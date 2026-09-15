# whiteboard-course

讲解稿 → AI 板书课程原型：输入带时间戳的 ASR 字幕 JSON，由大模型生成板书脚本（BoardScript），播放器按原字幕时间轴把板书以"老师边讲边写"的方式呈现——翻页、分栏、逐字书写、荧光笔高亮、手绘画圈。完整规格见 [CLAUDE.md](CLAUDE.md)。

## 环境

- Node ≥ 22.12（开发用 26），pnpm 11
- 首次：`pnpm install`

## 生成板书脚本

```bash
cp .env.example .env   # 填 LLM_PROVIDER / LLM_MODEL / LLM_BASE_URL / LLM_API_KEY
pnpm gen --in samples/aigc-career.transcript.json --out out/aigc-career.script.json
```

- `LLM_PROVIDER=anthropic`（默认型号 `claude-opus-5`）或 `openai-compatible`（需 `LLM_BASE_URL`，例如阿里云 `…/compatible-mode/v1`，型号如 `qwen3.8-max`）。
- 输出：`out/<name>.script.json`（播放器输入）与 `out/<name>.report.md`（验收指标、每节统计、warning / error、被丢弃的动作）。
- 每次 LLM 调用的提示词与响应落在 `out/<name>.llm/`，响应文件可作为 `--fixture <dir>` 离线复现：`pnpm gen --in … --out … --fixture out/<name>.llm`。
- `--dry-run` 只打印报告；`--glossary` 指定术语表（默认 `config/glossary.json`）。
- 提示词在 `prompts/*.md`（一行 `===== USER =====` 之前是 system，之后是 user 模板），改提示词不需要改代码。

## 播放

```bash
pnpm dev
```

打开 `http://localhost:5173/?script=out/aigc-career.script.json`；有录播音频时加 `&audio=samples/aigc-career.mp3`，否则进入计时器模式（空格播放/暂停，← / → 前后 5 秒）。手写 fixture 脚本可直接看：`?script=tests/fixtures/demo.script.json`。

## 开发

```bash
pnpm check    # tsc + vitest + eslint
pnpm test
```

目录结构与各模块职责见 CLAUDE.md 第 8 节；设计决策记录在 `docs/adr/`；各里程碑实施计划在 `docs/superpowers/plans/`。

## 已知限制

- 手写字体（Xiaolai / Excalifont）需自行放入 `public/fonts/`（见其 README），缺失时回退到本机楷体，控制台会有字体解码警告。
- 表格线未套手绘滤镜（会连带糊掉文字）。
- Mermaid 在生成期只做正则级校验，真正的语法错误在播放时显示"渲染失败"占位。
- 段落内部没有更细的时间戳，动作时间与句子级字幕都是按字符位置线性插值的估算。
- v1 不含 TTS、课堂互动、生图/动画、批注编辑、后端与持久化。
