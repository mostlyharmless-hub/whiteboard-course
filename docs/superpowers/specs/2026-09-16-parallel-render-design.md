# 分段并行渲染（pnpm render --jobs）设计

- 日期：2026-09-16
- 状态：已确认，待实施
- 关联：ADR 004（视频导出）、提交 f69de91（固定 Mermaid 手绘种子，本设计的前提）

## 背景

`pnpm render` 用单个 chromium 逐帧截图喂给 ffmpeg，本机实测每帧 90.7 ms：

| 环节 | 耗时 | 性质 |
|---|---|---|
| `setTime` | 20.3 ms | 主进程 ↔ 页面往返 |
| `waitReady` | 36.2 ms | `document.fonts.ready` + 两次 rAF |
| `screenshot` | 34.2 ms | CDP 截图 + JPEG 编码 |

瓶颈是**单个浏览器的串行往返延迟**，不是 CPU 饱和：本机 i9-14900KF 32 逻辑核、128 GB 内存，串行渲染时绝大部分核心空闲。样例课程（306.7 s，7717 帧）全片约 11 分钟。

x264 medium / crf 18 在这颗 CPU 上 1080p 约 200 fps，全片编码约 40 s，**不是瓶颈**，因此不需要 NVENC。

## 决定

多开 chromium 进程各渲一段，帧按**全局序号**写成 JPEG 文件，最后由**单个 ffmpeg** 按序读取整个序列编码并混音。

选这个方案而不是「每段各自编码再 concat」，是因为单编码器意味着帧顺序、编码参数、码率分配与串行渲染完全一致，产物可以用 md5 与串行结果逐字节比对——等价性成为可执行的断言，而不是"肉眼看不出差别"。代价是约 300 MB 临时帧文件，对本机可忽略。

也不选「worker 经 IPC 把帧回传主进程重排后写 ffmpeg stdin」：只省掉磁盘写入，却要在主进程做乱序缓冲，内存峰值不可控、实现最复杂。

## CLI

```
pnpm render --script <script.json> --out <video.mp4> [--audio <mp3>] [--subtitles <transcript.json>]
            [--fps 25] [--width 1920] [--height 1080] [--from 0] [--until <ms>] [--tail 2000]
            [--port 5175] [--jobs <N|auto>] [--frames-dir <dir>] [--keep-frames]
```

- `--jobs`：并行 worker 数，默认 `auto`（实测定值，预期 8）。`--jobs 1` 走现有串行代码路径。
- `--frames-dir`：临时帧目录，默认 `out/<out 文件名去扩展名>.frames/`；渲染成功后删除。
- `--keep-frames`：保留帧目录（排查画面问题、重复编码时用）。

其余参数语义不变。

## 结构

| 文件 | 职责 |
|---|---|
| `src/render/segments.ts` | `planSegments(totalFrames, jobs): {start, end}[]`（`end` 不含）。纯函数：帧数均分，余数分给前几段；`jobs > totalFrames` 时段数收敛到 `totalFrames`；`jobs <= 1` 返回单段 |
| `src/render/frames.ts` | `renderRange(opts): Promise<void>`：开 chromium → `goto` → `waitReady` → 对 `[start, end)` 每帧 `setTime` / `waitReady` / `screenshot` → 写 `<dir>/<6 位全局序号>.jpg`；每 `PROGRESS_EVERY` 帧回调一次进度。串行与并行共用 |
| `src/render/worker.ts` | 子进程入口：从 argv 读一段 JSON 配置，调用 `renderRange`，进度按行写 stdout（`{"done": n}`），出错写 stderr 并以非零码退出 |
| `src/render/cli.ts` | 编排：解析参数 → 起 vite（只起一次）→ `planSegments` → 派发 worker → 汇总进度 → 单次 ffmpeg 编码混音 → 清理 |

帧序号 = 全局帧下标，`t = from + i * 1000 / fps`，与串行完全一致。

## 数据流

```
                      vite :5175（单实例，所有 worker 共用）
                               |
  planSegments(7717, 8)  ->  worker0 [0, 965)      chromium #0  -> frames/000000.jpg …
                             worker1 [965, 1930)   chromium #1  -> frames/000965.jpg …
                             …
                             worker7 [6752, 7717)  chromium #7  -> frames/006752.jpg …
                               |
                        全部成功退出
                               |
  ffmpeg -f image2 -framerate 25 -start_number <from 帧号> -i frames/%06d.jpg
         [-ss <from 秒> -i audio.mp3] -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p
         [-af apad -c:a aac -b:a 160k -shortest] out.mp4
```

每个 worker 起**独立 chromium 进程**，不用单 browser 多 page：截图走 CDP 由 browser 进程处理，共用会在那里排队。

## 错误处理

- 任一 worker 非零退出：主进程终止其余 worker，报出「第 k 段（帧 a–b）失败」与该 worker 的 stderr，**保留帧目录**，退出码 2。
- vite 30 秒未就绪、ffmpeg 非零退出：同现状，退出码 2。
- 单帧截图失败由 Playwright 抛出，落到上一条。

## 一致性与验收

1. `--jobs 1` 与 `--jobs 8` 渲染同一 `--from/--until` 窗口（须包含 Mermaid 卡片），两份 mp4 **md5 相同**。
2. 全片渲染耗时相对串行的加速比；顺带记录不同 `--jobs` 的吞吐，据此定 `auto` 默认值。
3. `pnpm check` 通过（新增 `planSegments` 单测）；`pnpm e2e` 9 条通过。

前提条件：Mermaid 手绘种子已固定（f69de91）。若没有这一条，不同 worker 渲染的同一张图笔触不同，段边界会"重新描线"，md5 等价性也无从谈起。

## 测试

- `tests/render/segments.test.ts`：均分、余数分配、`jobs > totalFrames`、`jobs = 1`、总帧数守恒且无空段无重叠。
- 等价性（md5）与吞吐属于需要浏览器与 ffmpeg 的验收步骤，手动执行，不进 `pnpm check`。

## 不做

- NVENC / QSV 硬件编码：编码不是瓶颈，x264 同码率质量更好。
- 断点续渲：失败重跑约 1.5 分钟，不值一层状态管理。
- 降低 `waitReady` 的每帧开销（少等一次 rAF 之类）：影响画面正确性的风险大于收益，并行已经解决吞吐问题。
