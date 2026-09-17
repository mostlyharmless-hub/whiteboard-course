# 分段并行渲染（pnpm render --jobs）设计

- 日期：2026-09-16
- 状态：已实施（2026-09-17，分支 feat/parallel-render）
- 关联：ADR 004（视频导出）、提交 f69de91（固定 Mermaid 手绘种子，本设计的前提）

## 背景

`pnpm render` 用单个 chromium 逐帧截图喂给 ffmpeg，本机实测每帧 90.7 ms：

| 环节 | 耗时 | 性质 |
|---|---|---|
| `setTime` | 20.3 ms | 主进程 ↔ 页面往返 |
| `waitReady` | 36.2 ms | `document.fonts.ready` + 两次 rAF |
| `screenshot` | 34.2 ms | CDP 截图 + JPEG 编码 |

瓶颈是**单个浏览器的串行往返延迟**，不是 CPU 饱和：本机 i9-14900KF 32 逻辑核、128 GB 内存，串行渲染时绝大部分核心空闲。样例课程（306.7 s，7717 帧）全片约 11 分钟（设计时估算；实施后实测约 106 ms/帧，约 13–14 分钟）。

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

- `--jobs`：并行 worker 数，默认 `auto` = `clamp(floor(os.availableParallelism() / CORES_PER_JOB), 1, MAX_AUTO_JOBS)`；两个常量写在 `segments.ts`，按本机吞吐实测定为 `CORES_PER_JOB = 2`、`MAX_AUTO_JOBS = 12`（设计时初值为 4 与 8）。`--jobs 1` 在主进程内直接调用 `renderRange`，不起子进程。
- `--frames-dir`：临时帧目录，默认与 `--out` 同目录、名为 `<out 文件名去扩展名>.frames/`；**开始渲染前清空**（image2 会连续读取编号，残留的旧帧会被编进视频）；渲染成功后删除。
- `--keep-frames`：保留帧目录（排查画面问题、重复编码时用）。

其余参数语义不变。

## 结构

| 文件 | 职责 |
|---|---|
| `src/render/segments.ts` | `planSegments(totalFrames, jobs): {start, end}[]`（`end` 不含）。纯函数：帧数均分，余数分给前几段；`jobs > totalFrames` 时段数收敛到 `totalFrames`；`jobs <= 1` 返回单段 |
| `src/render/frames.ts` | `renderRange(opts): Promise<void>`：开 chromium → `goto` → `waitReady` → 对 `[start, end)` 每帧 `setTime` / `waitReady` / `screenshot` → 写 `<dir>/<6 位全局序号>.jpg`；每 `PROGRESS_EVERY` 帧回调一次进度。串行与并行共用 |
| `src/render/worker.ts` | 子进程入口：从环境变量 `RENDER_WORKER_CONFIG` 读 JSON 配置（避免 Windows 命令行对 JSON 引号的转义），调用 `renderRange`，进度按行写 stdout（`{"done": n}`），出错写 stderr 并以非零码退出。主进程用 `spawn(process.execPath, ["--import", "tsx", <worker.ts 绝对路径>])` 启动；stdin 关闭即中止——不用 `node_modules/.bin/tsx`，理由同 f69de91 中 vite 的 Windows ENOENT 问题 |
| `src/render/cli.ts` | 编排：解析参数 → 起 vite（只起一次）→ `planSegments` → 派发 worker → 汇总进度 → 单次 ffmpeg 编码混音 → 清理 |

帧文件名 = 本次渲染窗口内的帧下标 `i`（从 0 开始，6 位补零），`t = from + i * 1000 / fps`，与改动前串行实现完全一致。串行与并行都走「写帧文件 → 单次编码」，原先的 stdin 管道路径删除。

## 数据流

```
                      vite :5175（单实例，所有 worker 共用）
                               |
  planSegments(7717, 12) ->  worker0  [0, 644)      chromium #0   -> frames/000000.jpg …
                             worker1  [644, 1287)   chromium #1   -> frames/000644.jpg …
                             …
                             worker11 [7074, 7717)  chromium #11  -> frames/007074.jpg …
                               |
                        全部成功退出
                               |
  ffmpeg -f image2 -framerate 25 -start_number 0 -i frames/%06d.jpg
         [-ss <from 秒> -i audio.mp3] -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p
         [-af apad -c:a aac -b:a 160k -shortest] out.mp4
```

每个 worker 起**独立 chromium 进程**，不用单 browser 多 page：截图走 CDP 由 browser 进程处理，共用会在那里排队。

## 错误处理

- 任一 worker 非零退出：主进程终止其余 worker，报出「第 k 段（帧 a–b）失败」与该 worker 的 stderr，**保留帧目录**，退出码 2。
- vite 30 秒未就绪、ffmpeg 非零退出：同现状，退出码 2。
- 单帧截图失败由 Playwright 抛出，落到上一条。

## 一致性与验收

1. `--jobs 1` 与多路并行渲染同一 `--from/--until` 窗口（须包含 Mermaid 卡片），两份 mp4 **md5 相同**；实施后以样例**全片**的 `--jobs 12` 与 `--jobs 1` 为准（见实施记录）。
2. ~~与改动前的管道实现等价：~~（已作废：后续栅格化修复改变了像素，基线 md5 失效，见实施记录）`--from 24000 --until 26000`、无音频，基线 mp4 md5 为 `7cf94d7936eb430750f0dbb76ed37172`（提交 f69de91 时实测）。若 mp4 md5 因容器层元数据不同而不等，改比对解码帧 `ffmpeg -i x.mp4 -f framemd5 -`，逐帧哈希必须全部相同。
3. 全片渲染耗时相对串行的加速比；顺带记录不同 `--jobs` 的吞吐，据此定 `auto` 默认值。
4. `pnpm check` 通过（新增 `planSegments` 单测）；`pnpm e2e` 全部通过（实施后为 11 条，含 render-determinism、render-ready）。

前提条件：Mermaid 手绘种子已固定（f69de91）。若没有这一条，不同 worker 渲染的同一张图笔触不同，段边界会"重新描线"，md5 等价性也无从谈起。

## 测试

- `tests/render/segments.test.ts`：均分、余数分配、`jobs > totalFrames`、`jobs = 1`、总帧数守恒且无空段无重叠。
- 等价性（md5）与吞吐属于需要浏览器与 ffmpeg 的验收步骤，手动执行，不进 `pnpm check`。

## 不做

- NVENC / QSV 硬件编码：编码不是瓶颈，x264 同码率质量更好。
- 断点续渲：失败重跑约 1.5 分钟，不值一层状态管理。
- 降低 `waitReady` 的每帧开销（少等一次 rAF 之类）：影响画面正确性的风险大于收益，并行已经解决吞吐问题。

## 实施记录

- 默认并行数：实测 1000 帧截图吞吐 1 路 9.5 帧/秒、4 路 37.9、8 路 68.0、12 路 84.7、16 路 91.7，按"不低于最高值 90% 的最小路数"取 12（`MAX_AUTO_JOBS = 12`、`CORES_PER_JOB = 2`）。串行实测约 106 ms/帧，比设计时估的 90.7 ms 慢。
- 样例全片（7717 帧，含音频）：截图 78.1 s + 编码 36.0 s = 114 s。
- 等价性验收发现 Chromium 对逐帧改 opacity 的 Mermaid 卡片栅格结果依赖渲染历史：串行逐帧经历淡入，与 worker 在淡入之后冷启动，最后一个节点有 511 个像素、最大灰度差 11 的差异（肉眼不可见）。与 `seq`、Mermaid SVG 标记无关（SVG 逐字节相同）。修复：`.mermaid-body { will-change: opacity; }` 固定独立合成层（`src/player/styles/board.css`）。修复同时消除了串行渲染对 `--from` 起点的依赖。
- 因此设计中引用的基线 md5 `7cf94d7936eb430750f0dbb76ed37172` 已失效；此后又加了 `--disable-partial-raster`（见下），栅格结果再次变化，窗口级 md5 不再作为基线，等价性一律以同一代码的 `--jobs 1` 全片为准。
- 代码审查追加的防护：`--frames-dir` 只清空只含 `^\d{6}\.jpg$` 文件的目录；ffmpeg / worker 启动失败报出原因；参数非数字时报「渲染区间无效」。
- 失败路径：worker 超时时报出段号、帧范围与 worker stderr，保留帧目录、不产出 mp4、无残留 chromium；渲染中途强杀一个 worker，其余 worker 在 5–6 s 内中止，无孤儿进程。被强杀的 worker 无法写出原因，报错只有退出码。
- 全片验收（`--jobs 12` vs `--jobs 1`，7717 帧）第一次不一致：差异只在视频流，都从分段起点（帧 1287 / 2573 / 4502）开始，像素差落在正在显示的高亮、画圈笔尖和带 SVG 滤镜的卡片边框。两条路径的 DOM（卡片与栏包围盒、画布 transform、标注 SVG）逐字节相同，差异来自 Chromium 局部重栅格化：默认只重画每帧脏矩形，抗锯齿边缘与滤镜附近的像素随渲染历史累积。对照实验：默认参数三处均复现，`--disable-partial-raster` 三处均一致，1000 帧 12 路吞吐不变。修复：`renderRange` 启动 chromium 时加该参数；e2e `tests/e2e/render-determinism.spec.ts` 覆盖。
- 第二次不一致只在高负载下出现（两个 12 路渲染同时启动）：Mermaid 卡片出现后的 3–5 帧截到「绘制中…」占位符。诊断显示每个浏览器首个 Mermaid 的 `waitReady` 都等满 8 秒后静默放行，首次渲染实际 25–45 秒（按需加载的图表代码在 vite 开发服务器排队）；浏览器预热后再并发不复现。修复：`waitAssetsReady` 超时改为抛错、上限 120 秒，宁可渲染失败也不产出错误画面；e2e `tests/e2e/render-ready.spec.ts` 覆盖（拦截 flowDiagram 代码延迟 12 秒）。
