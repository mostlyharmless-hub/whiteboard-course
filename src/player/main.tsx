import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadScript, loadSubtitles, readParams } from "./loadScript";
import type { BoardScript } from "../shared/schema";
import "katex/dist/katex.min.css";
import "./styles/fonts.css";
import "./styles/board.css";
import "./styles/ui.css";

const root = createRoot(document.getElementById("root")!);
const params = readParams();

async function boot(): Promise<void> {
  const r = await loadScript(params.script);
  if (!r.ok) {
    const lines = r.issues.map((i) => {
      const where =
        i.path[0] === "actions" && typeof i.path[1] === "number" ? `第 ${i.path[1] + 1} 条动作` : i.path.length > 0 ? i.path.join(".") : "根";
      return `- [${where}] ${i.message}`;
    });
    root.render(<pre className="load-error">{`脚本 ${params.script} 校验失败：\n${lines.join("\n")}`}</pre>);
    return;
  }
  let script: BoardScript = r.script;
  if (params.subtitles) {
    const texts = await loadSubtitles(params.subtitles);
    script = { ...script, paragraphs: script.paragraphs.map((p) => ({ ...p, text: texts.get(p.paragraph_id) ?? p.text })) };
  }
  document.title = `${script.meta.title} · AI 板书课程`;
  root.render(
    <StrictMode>
      <App script={script} audioUrl={params.audio} initialT={params.t} render={params.render} />
    </StrictMode>,
  );
}

void boot().catch((e: unknown) => {
  root.render(<pre className="load-error">{e instanceof Error ? e.message : String(e)}</pre>);
});
