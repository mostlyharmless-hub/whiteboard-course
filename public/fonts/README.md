# 手写字体

播放器的 `--font-hand` 字体栈优先使用本目录中自托管的两款 OFL 字体；文件缺失时按 CSS 回退栈退到本机楷体（Kaiti SC / STKaiti）。

| 文件 | 字体 | 来源 | 许可证 |
|---|---|---|---|
| `Xiaolai.ttf` | 小赖字体（Xiaolai，中文手写体） | https://github.com/lxgw/kose-font | SIL OFL 1.1 |
| `Excalifont-Regular.woff2` | Excalifont（拉丁手写体） | https://github.com/excalidraw/excalidraw/tree/master/packages/excalidraw/fonts/Excalifont | SIL OFL 1.1 |

原型阶段不做字体子集化。放入文件后无需改代码，`src/player/styles/fonts.css` 已声明 `@font-face`。
