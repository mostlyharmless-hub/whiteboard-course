import type { GenerateResult } from "./types";

const yesNo = (ok: boolean) => (ok ? "✅" : "❌");

/** 生成报告（Markdown）：验收指标、每节统计、警告、错误、被丢弃的动作 */
export function renderReport(r: GenerateResult, opts: { source: string; out: string }): string {
  const { script, results, usage } = r;
  const cards = script.actions.filter((a) => a.type === "board" || a.type === "mermaid");
  const pages = script.actions.filter((a) => a.type === "new_page").length;
  const mermaids = script.actions.filter((a) => a.type === "mermaid").length;
  const marks = script.actions.filter((a) => a.type === "highlight" || a.type === "circle").length;
  const paragraphById = new Map(script.paragraphs.map((p) => [p.paragraph_id, p]));
  const overrun = cards.filter((c) => {
    const p = paragraphById.get(c.anchor.paragraph_id);
    return p !== undefined && c.type === "board" && c.at + c.reveal_ms > p.end_time;
  });
  const sectionsWithoutCard = results.filter((s) => !s.actions.some((a) => a.type === "board" || a.type === "mermaid"));
  const errorCount = results.reduce((n, s) => n + s.errors.length, 0) + r.issues.length;
  const warningCount = results.reduce((n, s) => n + s.warnings.length, 0);

  const lines: string[] = [];
  lines.push(`# 生成报告：${script.meta.title}`, "");
  lines.push(`- 来源：\`${opts.source}\``);
  lines.push(`- 输出：\`${opts.out}\``);
  lines.push(`- 型号：${script.meta.model}；生成时间：${script.meta.generated_at}`);
  lines.push(`- LLM 调用 ${usage.calls} 次，输入 ${usage.input_tokens} tokens，输出 ${usage.output_tokens} tokens`);
  lines.push(`- 时长 ${(script.meta.duration_ms / 1000).toFixed(1)} 秒，${script.sections.length} 节，${script.actions.length} 条动作`);
  lines.push(`- **error ${errorCount}，warning ${warningCount}**`, "");

  lines.push("## 验收指标", "");
  lines.push("| 指标 | 实际 | 要求 | 结果 |", "|---|---|---|---|");
  lines.push(`| 卡片数 | ${cards.length} | ≥ 8 | ${yesNo(cards.length >= 8)} |`);
  lines.push(`| 页数 | ${pages} | ≥ 3 | ${yesNo(pages >= 3)} |`);
  lines.push(`| Mermaid | ${mermaids} | ≥ 1 | ${yesNo(mermaids >= 1)} |`);
  lines.push(`| 无卡片的小节 | ${sectionsWithoutCard.map((s) => s.section.id).join(", ") || "无"} | 每节 ≥ 1 | ${yesNo(sectionsWithoutCard.length === 0)} |`);
  lines.push(`| 标注数 | ${marks} | ≤ 8（建议） | ${yesNo(marks <= 8)} |`);
  lines.push(`| at + reveal_ms 超出段落 | ${overrun.map((c) => c.card_id).join(", ") || "无"} | 无 | ${yesNo(overrun.length === 0)} |`);
  lines.push(`| 脚本自检 | ${r.issues.length} 处问题 | 0 | ${yesNo(r.issues.length === 0)} |`, "");

  lines.push("## 各节", "");
  lines.push("| 节 | 标题 | 时长(s) | 卡片 | 标注 | 秒/卡 | 打回 | warning | error | 丢弃 |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const s of results) {
    const secs = (s.section.end_ms - s.section.begin_ms) / 1000;
    const n = s.actions.filter((a) => a.type === "board" || a.type === "mermaid").length;
    const m = s.actions.filter((a) => a.type === "highlight" || a.type === "circle").length;
    lines.push(`| ${s.section.id} | ${s.section.title} | ${secs.toFixed(0)} | ${n} | ${m} | ${n > 0 ? (secs / n).toFixed(0) : "—"} | ${s.rounds} | ${s.warnings.length} | ${s.errors.length} | ${s.dropped.length} |`);
  }
  lines.push("");

  const warnings = results.flatMap((s) => s.warnings.map((w) => `- [${s.section.id}] ${w}`));
  lines.push("## Warnings", "", ...(warnings.length > 0 ? warnings : ["无"]), "");
  const errors = results.flatMap((s) => s.errors.map((e) => `- [${s.section.id}] ${e}`));
  const issues = r.issues.map((i) => `- [自检] ${i.path.join(".")}: ${i.message}`);
  lines.push("## Errors", "", ...(errors.length + issues.length > 0 ? [...errors, ...issues] : ["无"]), "");
  const dropped = results.flatMap((s) => s.dropped.map((d) => `- [${s.section.id}] \`${JSON.stringify(d)}\``));
  lines.push("## 被丢弃的动作", "", ...(dropped.length > 0 ? dropped : ["无"]), "");
  return lines.join("\n");
}
