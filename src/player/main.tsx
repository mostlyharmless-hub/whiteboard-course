import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadScript, readParams } from "./loadScript";
import "katex/dist/katex.min.css";
import "./styles/fonts.css";
import "./styles/board.css";
import "./styles/ui.css";

const root = createRoot(document.getElementById("root")!);
const params = readParams();

void loadScript(params.script).then((r) => {
  if (r.ok) {
    document.title = `${r.script.meta.title} · AI 板书课程`;
    root.render(
      <StrictMode>
        <App script={r.script} audioUrl={params.audio} initialT={params.t} />
      </StrictMode>,
    );
    return;
  }
  const lines = r.issues.map((i) => {
    const where =
      i.path[0] === "actions" && typeof i.path[1] === "number" ? `第 ${i.path[1] + 1} 条动作` : i.path.length > 0 ? i.path.join(".") : "根";
    return `- [${where}] ${i.message}`;
  });
  root.render(<pre className="load-error">{`脚本 ${params.script} 校验失败：\n${lines.join("\n")}`}</pre>);
});
