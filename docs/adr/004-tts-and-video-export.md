# ADR 004：TTS 配音与 mp4 视频导出（v1 范围扩展）

- 日期：2026-09-15
- 状态：已采纳
- 影响：CLAUDE.md 第 2、8、13 节；新增 `src/tts/`、`src/render/`、播放器 `?render=1` 与 `?subtitles=`

## 背景

规格 v1 明确不做 TTS 与视频导出：时间轴来自原字幕的 `begin_time / end_time`，产物是播放器实时播放。用户希望把「AIGC职业规划实战」直接做成约 7 分钟的 mp4 视频课，配音用阿里云 Qwen3-TTS 男声（Ethan）。

## 决定

1. **配音不改时间轴**：逐段合成（文本先按术语表纠错），每段音频放在原段落 `begin_time`，段间静音；某段比"到下一段开始前的可用窗口"长时用 ffmpeg `atempo` 加速（≤ 2×）。输出 mp3 总长 = 课程时长，板书脚本、字幕、锚点全部不变。样例 11 段均无需加速（TTS 约 4.6 字/秒，与原讲者相当）。
2. **写出配音版讲解稿** `<name>.tts.transcript.json`（时间不变、文本纠错），播放器用 `?subtitles=` 覆盖字幕显示，不重新生成板书。
3. **视频用逐帧定格渲染**而不是实时录屏：播放器状态是 `t` 的纯函数，Playwright 在 `?render=1` 模式下按 `t = i / fps` 逐帧 `setTime` 并截图，通过管道交给 ffmpeg（libx264 + aac）与 mp3 合成，画面与音频严格对齐；渲染模式隐藏界面、相机瞬移、每帧等待字体与 Mermaid 就绪。1920×1080 @ 25 fps 约以 1× 实时速度渲染。
4. TTS 配置进 `.env`（`TTS_BASE_URL / TTS_MODEL / TTS_VOICE / TTS_API_KEY`，缺省从 LLM 配置推导）；每段结果按内容哈希缓存在 `out/tts-cache/`。

## 影响

- 契约与生成器零改动；新增两个 CLI：`pnpm tts`、`pnpm render`。
- 时间轴沿用原录播，段间会保留原视频里的操作停顿（最长 6–7 秒静音）；若以后只做纯 TTS 课程，可改为"TTS 时长驱动时间轴"的模式（`planPlacement` 换一个策略即可）。
- 视频课的字幕是句子级估算（同 ADR 001）。
