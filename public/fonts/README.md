# 手写字体

播放器的 `--font-hand` 字体栈优先使用本目录自托管的两款 OFL 字体，`src/player/styles/fonts.css` 已声明 `@font-face`；文件缺失时按 CSS 回退栈退到本机楷体（Kaiti SC / STKaiti）。

| 文件 | 字体 | 来源 | 许可证 |
|---|---|---|---|
| `Xiaolai-Regular.ttf`（22 MB） | 小赖字体（Xiaolai，中文手写体） | https://github.com/lxgw/kose-font/releases/tag/v3.126 | SIL OFL 1.1 |
| `Excalifont-Regular-<hash>.woff2` × 7（共 65 KB） | Excalifont（拉丁手写体），按 unicode-range 拆分的子集 | https://github.com/excalidraw/excalidraw/tree/master/packages/excalidraw/fonts/Excalifont | SIL OFL 1.1 |

Excalifont 各子集覆盖的 unicode-range 照抄自该目录的 `index.ts`。原型阶段不对小赖字体做子集化；若后续要减小体积，可用 `pyftsubset` 按课程实际用字裁剪。
