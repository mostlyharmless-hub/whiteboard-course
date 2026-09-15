# ADR 002：生成器侧 Mermaid 校验用正则而非 `mermaid.parse()`

- 日期：2026-09-15
- 状态：已采纳
- 影响：CLAUDE.md 6.5；`src/generator/validate.ts` 的 `checkMermaid`

## 背景

规格建议在 Node 侧用 `mermaid` 的 `parse()` 做语法校验，但 mermaid 需要 DOM 环境（jsdom），会给生成器引入一个仅用于校验的重依赖，并且 mermaid 12 的 `parse()` 在 jsdom 下的行为不稳定。规格同时允许退化为正则检查。

## 决定

用正则检查并在生成期强制第 5.4 节的 Mermaid 预算：

- 首行必须是 `flowchart|graph` + `LR|TD|TB|RL|BT`；
- `style / classDef / class / linkStyle / click` 行自动删除并记 warning；
- 含 `subgraph` 打回；
- 解析每条边两端的节点（支持 `A[..]`、`A(..)`、`A((..))`、`A{..}`、`A>..]`、边标签 `-->|x|` 与 `-- x -->`、`&` 并列），节点 ≤ 8、节点文字 ≤ 10 字，否则打回。

真正的 Mermaid 语法错误由播放器渲染时报出（卡片内显示"Mermaid 渲染失败"占位，控制台记录），不阻塞播放。

## 影响

- 生成器保持零浏览器依赖，测试离线可跑。
- 极少数正则放行但 mermaid 拒绝的写法（例如奇怪的节点 id）会在播放时才暴露；样例验收时人工看一遍所有 Mermaid 卡片即可覆盖。
