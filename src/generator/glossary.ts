import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Glossary } from "./types";

const GlossarySchema = z.object({
  rules: z.array(z.object({ from: z.string().min(1), to: z.string().min(1), note: z.string().optional() })),
});

export function loadGlossary(path: string): Glossary {
  const r = GlossarySchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!r.success) throw new Error(`术语表 ${path} 格式不正确：${r.error.message}`);
  return r.data;
}

/** 注入提示词的文本：每行一条 */
export function formatGlossary(g: Glossary): string {
  if (g.rules.length === 0) return "（无）";
  return g.rules.map((r) => `- \`${r.from}\` → ${r.to}${r.note ? `（${r.note}）` : ""}`).join("\n");
}
