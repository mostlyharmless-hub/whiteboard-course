# Hyperknow AI 白板页面技术调研

> 调研对象：`agent.hyperknow.io/course/{course_id}/sessions/whiteboard/{session_id}`
> 调研方式：运行时 DOM 检查、React fiber 读取 Excalidraw 内部状态、前端 bundle 静态分析（`WhiteboardPage-*.js` 约 140KB、`MessageBubble-*.js`、`VoiceSendPrompt-*.js`）、资源加载记录
> 调研日期：2026-09-15

---

## 1. 一句话结论

这不是一个通用协作白板，而是一个 **AI 讲师授课播放器**：后端 Agent 按课程脚本（"学习节大纲"）逐步执行，通过 WebSocket 把"板书 / 高亮 / 提问 / 语音"动作推给前端；前端用 **Excalidraw 做无限画布底盘**，但真正的板书内容是 **Markdown 渲染出来的 HTML overlay** 叠在画布之上，并用手写字体 + SVG 抖动滤镜制造"手绘板书感"。

---

## 2. 整体技术栈

| 层 | 技术 | 证据 |
|---|---|---|
| 前端框架 | React SPA，Vite 构建（非 Next.js） | `assets/js/index-*.js` 哈希命名、`__reactFiber` 存在、无 `__NEXT_DATA__` |
| 样式 | Tailwind 原子类 + 自定义 `whiteboard-*` / `overlay-*` 类 | DOM 类名 |
| 认证 | Supabase Auth | `*.supabase.co/auth/v1/user` |
| 业务 API | `api.hyperknow.io/api/v1/*` | 资源加载记录 |
| 实时通道 | WebSocket `/api/v1/whiteboard/ws` | bundle 内 URL |
| 画布 | Excalidraw（双层 2D canvas：static + interactive） | `.excalidraw__canvas static/interactive` |
| 公式 | KaTeX（完整字体族已加载） | `document.fonts` |
| 图表 | Mermaid | 消息类型 `mermaid_graph` |
| 字体 | Virgil / Xiaolai（小赖，中文手写体）、Excalifont、Satoshi、MiSans、EB Garamond | `document.fonts` |
| TTS | Azure | `VoiceSendPrompt-*.js` 内 `AZURE` |
| 录音 | `getUserMedia` + `MediaRecorder`（webm/opus，回退 ogg/mp4） | 同上 |
| 埋点 | Microsoft Clarity、GTM、Apollo tracker、Dub analytics、Cloudflare RUM | script 列表 |
| 其他接口 | `whiteboard/course-outlines`、`whiteboard/replay-audio/{id}`、`upload_file`、`connectors/canvaLMS`、`subscription/check_user_subscription` | 资源加载记录 |

---

## 3. 页面结构

```
whiteboard-root
├── whiteboard-sidebar            左侧：学习节大纲（课程脚本，只读卡片 + 参考资料列表）
└── whiteboard-main
    ├── whiteboard-top-page-actions   顶部：课程名、缩放 pill、页码导航 (1/1)、下载、举报、设置
    └── whiteboard-canvas-shell
        ├── <style>                   画布背景（点阵）
        ├── .excalidraw (view-mode, zen-mode)   Excalidraw 画布
        └── .absolute.inset-0.overflow-hidden   HTML overlay 层（pointer-events: none）
            └── overlay-note-card × N            板书卡片
```

底部：语音输入开关、麦克风、打字输入、聊天气泡（`MessageBubble`），以及"在听…"状态提示。

左侧大纲示例（节选）：

> 在白板上画两个圆：一个标注为"传记"，另一个标注为"历史"。教学目标是展示这两个圆重叠的地方就是"社会学想象力"……

即课程脚本本身就是给 Agent 的"教案指令"，Agent 据此决定何时写板书、何时高亮、何时提问。

---

## 4. 白板能力深挖

### 4.1 Excalidraw 只是"底盘"

通过 React fiber 找到 `<Excalidraw>` 组件的 props 与 `excalidrawAPI`：

```
viewModeEnabled: true
zenModeEnabled: true
gridModeEnabled: (存在)
UIOptions.canvasActions: { changeViewBackgroundColor:false, clearCanvas:false, export:false,
                           loadScene:false, saveToActiveFile:false, toggleTheme:false, saveAsImage:false }
UIOptions.tools: { image:false }
appState: { zoom: 0.7, theme: 'light', viewBackgroundColor: 'transparent' }
```

关键发现：`excalidrawAPI.getSceneElements()` 返回 **0 个元素**，`getFiles()` 为空。屏幕上可见的"社会学想象力"板书**不是 Excalidraw 元素**。

Excalidraw 在这里实际只提供：

1. 无限画布的平移 / 缩放坐标系（`onScrollChange` 回调把 scrollX / scrollY / zoom 同步给 overlay 层）
2. 透明背景（点阵背景由外层 `<style>` 提供）
3. 一个预留的"用户可批注"能力（当前 view-mode 关闭）

### 4.2 内容层：HTML overlay

overlay 层结构（实测样式）：

```
div.overlay-handwriting.w-full.min-w-0
  style: position:absolute; left:30.94px; top:86.56px; width:421px;
         transform:scale(0.7); transform-origin:left top; pointer-events:none
  └── div.overlay-handwriting.overlay-note-card.overlay-note-card--expand
        ├── <svg> 内嵌 filter 定义（见 4.3）
        └── div.board-note-body   ← Markdown 渲染结果
              <h1>社会学想象力</h1>
              <p>(The Sociological Imagination)</p>
              <blockquote><p>……—— C. Wright Mills</p></blockquote>
```

- `scale(0.7)` 即 Excalidraw 当前 zoom；`left/top` 由画布 scroll 与卡片逻辑坐标换算得出，使 DOM 卡片"贴"在画布坐标系上随之平移缩放。
- 卡片文字字体：`Virgil, Xiaolai, "Segoe UI Emoji", …`，字号约 22.8px（h1）。
- 内容格式是 **Markdown**（服务端 `board_content` 字段为字符串），支持 KaTeX 公式与 Mermaid 图。

### 4.3 "手绘感"实现

每张卡片内嵌一组 SVG filter，用于表格线、边框等：

```svg
<filter id="tblwob-r3-a" x="-15%" y="-15%" width="130%" height="130%">
  <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3" result="noise"/>
  <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" xChannelSelector="R" yChannelSelector="G"/>
</filter>
```

`feTurbulence + feDisplacementMap` 使直线产生轻微随机抖动，再配合手写字体，就得到接近 Excalidraw 手绘风格的效果，而无需生成任何矢量笔画。

### 4.4 内容块类型（kind）

bundle 中的 overlay item kind：

| kind | 说明 | 相关状态消息 |
|---|---|---|
| `note_card` | Markdown 板书卡片 | `board` |
| `board_image` | AI 生成图片 | `image_gen_pending` → `generated_image` / `image_gen_failed` |
| `board_animation` | AI 生成动画 | `animation_pending` → `generated_animation` / `animation_failed` |
| `mermaid_graph` | Mermaid 图表 | `graph` / `mermaid_graph` |
| `visual` / `question` / `narrate` | 大纲步骤类型（用于进度与提问） | `ask`、`keypoint_complete` |

### 4.5 布局模型：page → column → item

- 服务端通过 `new_page` / `new_column` 控制翻页与分栏；顶部 "1/1" 为页码导航。
- 前端有按列重排逻辑：同一 `columnIndex` 下的 item 按 `y` 排序后纵向堆叠（代码中 `Ze(e,t,n)` 函数，对 `note_card / board_image / mermaid_graph / board_animation` 生效）。
- `sync_whiteboard_state` 消息用于断线重连 / 恢复会话时同步整板状态。

### 4.6 高亮与画圈

`highlight` / `circle` 消息携带：`target_board_id`（目标卡片）、`snippet`（要定位的文本片段）或 `rect{x,y,w,h}`（相对坐标）、`color`、`page_id`、`step_id`。

即"画圈强调"是**在已有卡片上按文本片段或矩形区域叠加标记**，不是自由手绘。这与 Excalidraw 场景元素为空一致。

### 4.7 揭示节奏与前后端对齐（值得借鉴）

`board` 消息处理流程（反编译摘要）：

1. 收到 `board_content`，先记录一条 `action` 日志（`actionKind:'board'`）。
2. 若当前有揭示门控（`revealGateStep`）未打开，则压入队列 `Rt.current`。
3. 否则调用渲染函数 `Yr(content, title, boardUid, …)`，再调用 `Ur(handle, content.length, finish)` —— **按文本长度做渐进式揭示**（`revealFrom`）。
4. 揭示完成后回发 `action_step_complete { step_id }`，服务端才推进下一步。

也就是说**前端渲染节奏反向门控后端授课推进**，保证 TTS 与板书同步，不会"讲到后面板书还没出来"。

---

## 5. WebSocket 协议

### 5.1 客户端 → 服务端

```
start_session / resume_session / resume_or_start_course_session
set_lecture_outline / set_tts_config
start_teaching / pause_session / resume_generation / stop_generation
user_message / question_answers / step_completion_response
action_step_complete            ← 前端揭示完成回执
narration_pause
sync_whiteboard_state           ← 上报整板状态
interject_start / interject_question / interject_audio_chunk / interject_audio_end / interject_audio_flush / interject_resume
voice_stream_start / voice_audio_chunk / voice_audio_end / voice_stream_cancel
ping / model_probe
```

### 5.2 服务端 → 客户端

```
connection_established / session_ready / lecture_outline_selected / tts_config
group                           ← 一组动作
board                           ← 板书 (board_content, title, board_uid, page_id, step_id)
highlight / circle              ← 标记 (target_board_id, snippet | rect, color)
graph / mermaid_graph
new_page / new_column
image / board_image / image_gen_pending / generated_image / image_gen_failed
animation / board_animation / animation_pending / generated_animation / animation_failed
note_card
ask                             ← 课堂提问
reward_user                     ← 激励
speak / tts_segment             ← 语音分段
keypoint_complete / done / response_complete / session_paused
reference_reading_started / _completed / _failed   ← 参考资料阅读
interject_ready / interject_user_text / interject_text / interject_pcm / interject_audio / interject_board / interject_speech_end / interject_done / interject_error
voice_transcript / voice_stream_text
insufficient_funds              ← 算力/额度不足（按量计费）
error
```

---

## 6. 语音链路

**讲课 TTS**：Azure TTS，服务端切段推送 `tts_segment`；另有 `GET /api/v1/whiteboard/replay-audio/{id}` 用于回放。

**学生打断提问（interject）**：

```
浏览器 getUserMedia + MediaRecorder(webm/opus)
  → interject_start
  → interject_audio_chunk × N
  → interject_audio_end
服务端
  → voice_transcript          (ASR 结果)
  → interject_text            (回答文本)
  → interject_pcm / interject_audio   (回答语音)
  → interject_board           (回答也可写到白板)
  → interject_done
客户端
  → interject_resume          (继续原课程)
```

页面底部"在听…"与"好的，先停一下。"即此通道的 UI 表现。

---

## 7. 局限性

- 内容是 DOM overlay 而非画布元素：用户**不能在板书上批注**（view-mode），也无法拖动、编辑卡片。
- Excalidraw 原生导出被关闭，"下载"按钮需自行实现整板截图 / PDF。
- 无多人协作（`isCollaborating` 未启用）。
- 高亮 / 画圈依赖文本片段定位，对图片、图表内部区域只能用矩形。
- 按量计费，`insufficient_funds` 会中断会话。

---

## 8. 对我们的启示（可复用方案）

若要在教师培训平台 / "高老师"等产品中加入 AI 板书讲课能力，可直接借鉴以下设计，工程成本远低于让模型生成矢量笔画：

1. **让 LLM 输出 Markdown + Mermaid + KaTeX，而不是画布元素 JSON**。前端用 HTML overlay 渲染，稳定性高、可读性好、可直接复用现有 Markdown 渲染链。
2. **画布只负责坐标系**。可用 Excalidraw view-mode，或自写一个 pan/zoom 容器（更轻）。若后期需要用户批注，Excalidraw 的 interactive 层可以直接打开。
3. **手绘感 = 手写字体 + SVG `feTurbulence/feDisplacementMap` 滤镜**。中文可用小赖体（Xiaolai）。
4. **协议里设计"步骤完成回执"**（`action_step_complete`），让前端揭示节奏门控后端推进，实现语音与板书对齐。
5. **布局用 page → column → item 模型**，由服务端决定翻页与分栏，前端负责同列堆叠。
6. **高亮/画圈用"目标卡片 + 文本片段 / 相对矩形"描述**，而不是绝对像素坐标，便于缩放与重排。
7. **打断问答走独立子通道**（interject_*），问答结束后恢复主课程状态机。
8. 生图 / 动画等慢操作用 `pending → generated / failed` 三态占位，不阻塞讲课主线。
