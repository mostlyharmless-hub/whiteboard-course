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
- 生成末尾自动套用时间轴后处理（ADR 005）：翻页可提前进入语音前的静默、每页第一张卡随翻页落笔，保证有语音时白板不为空；报告里有对应指标。对已有脚本可单独执行 `pnpm timeline --in old.script.json --out new.script.json`。

## 播放

```bash
pnpm dev
```

打开 `http://localhost:5173/?script=out/aigc-career.script.json`；有录播音频时加 `&audio=samples/aigc-career.mp3`，否则进入计时器模式（空格播放/暂停，← / → 前后 5 秒）。手写 fixture 脚本可直接看：`?script=tests/fixtures/demo.script.json`。

## 配音与视频导出（ADR 004）

```bash
# 视频课默认流程：紧凑时间轴（段间 0.7 s，总长 = 语音总长）
pnpm tts --in samples/aigc-career.transcript.json --out samples/aigc-career.tts-compact.mp3 --timeline compact
pnpm timeline --in out/aigc-career-v2.script.json --transcript samples/aigc-career.tts-compact.transcript.json --out out/aigc-career-compact.script.json
pnpm render --script out/aigc-career-compact.script.json --audio samples/aigc-career.tts-compact.mp3 --out out/aigc-career.mp4

# 需要与原视频时间轴对齐时：原时间轴模式
pnpm tts --in samples/aigc-career.transcript.json --out samples/aigc-career.tts.mp3
pnpm render --script out/aigc-career-v2.fixed.script.json --audio samples/aigc-career.tts.mp3 \
  --subtitles samples/aigc-career.tts.transcript.json --out out/aigc-career-original.mp4
```

- `pnpm tts`：文本按术语表纠错后逐段调用阿里云 Qwen3-TTS（`.env` 的 `TTS_MODEL / TTS_VOICE`，默认 `qwen3-tts-flash` / `Ethan`）。`--timeline compact` 段与段紧接、留 `--gap` 毫秒；`--timeline original` 每段放在原 `begin_time`、必要时 `atempo` 加速。同时写出 `<name>.transcript.json`（文本纠错，时间为所选时间轴）。段结果按内容哈希缓存在 `out/tts-cache/`。需要 `ffmpeg / ffprobe`。
- `pnpm timeline --transcript`：把已有板书脚本按每条动作在段内的相对位置映射到新讲解稿的时间轴（ADR 006），并套用"有语音时白板不为空"（ADR 005）。
- `pnpm render`：在 `?render=1` 模式下多个 chromium 并行逐帧 `setTime` 截图成 JPEG，再由一个 ffmpeg 按序合成 1920×1080 @ 25 fps 的 mp4（libx264 + aac）。`--jobs` 默认 `auto`（本机 i9-14900KF 为 12 路，样例全片约 2 分钟，串行约 14 分钟）；`--jobs 1` 串行，产物与并行逐字节一致。临时帧写在输出文件旁的 `<名>.frames/`（`--frames-dir` 可改，只会清空只含帧文件的目录；成功后删除，`--keep-frames` 保留）。`--until 10000` 先渲染 10 秒验证；`--subtitles` 用配音版讲解稿覆盖字幕。
- 播放器试听：`/?script=out/aigc-career-v2.script.json&audio=samples/aigc-career.tts.mp3&subtitles=samples/aigc-career.tts.transcript.json`

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
