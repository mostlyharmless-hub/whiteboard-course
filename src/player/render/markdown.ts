import MarkdownIt from "markdown-it";
import katexImport, { type MarkdownKatexOptions } from "@vscode/markdown-it-katex";

type Md = InstanceType<typeof MarkdownIt>;
type KatexPlugin = (md: Md, options?: MarkdownKatexOptions) => Md;

// 该包是 CJS 的 exports.default；不同打包器的 ESM 互操作可能给出函数本身或模块对象，两种都兼容
const katexPlugin: KatexPlugin =
  typeof katexImport === "function" ? katexImport : (katexImport as unknown as { default: KatexPlugin }).default;

const md = new MarkdownIt({ html: false, linkify: false, breaks: false, typographer: false });
md.use(katexPlugin, { throwOnError: false });

// 板书不允许图片与链接：图片渲染为其替代文字，链接只保留文字
md.renderer.rules.image = (tokens, idx) => md.utils.escapeHtml(tokens[idx]?.content ?? "");
md.renderer.rules.link_open = () => "";
md.renderer.rules.link_close = () => "";

export function renderMarkdown(source: string): string {
  return md.render(source);
}
