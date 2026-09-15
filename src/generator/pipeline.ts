import { parseScript, type BoardScript } from "../shared/schema";
import { assemble, initialLayout, stepLayout } from "./assemble";
import type { LlmClient } from "./llm/types";
import { generateOutline } from "./outline";
import { generateSection } from "./script";
import { emptyUsage, type GenerateResult, type Glossary, type SectionResult, type Transcript } from "./types";

export interface GenerateOptions {
  transcript: Transcript;
  glossary: Glossary;
  llm: LlmClient;
  onProgress?: (msg: string) => void;
  /** 便于测试固定时间戳 */
  now?: () => Date;
}

/** 完整流水线：大纲 → 逐节脚本 → 装配 → 自检 */
export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  const { transcript, glossary, llm, onProgress } = opts;
  const usage = emptyUsage();
  const outline = await generateOutline(llm, transcript, glossary, usage, onProgress);
  const paragraphById = new Map(transcript.paragraphs.map((p) => [p.paragraph_id, p]));

  const results: SectionResult[] = [];
  let prevAt = -1;
  for (const section of outline.sections) {
    // 提示词里的白板状态用全局卡片 id，所以每节开始前按已装配的动作重放一遍布局
    const layout = assemble(results).reduce(stepLayout, initialLayout);
    const outcome = await generateSection(llm, {
      section,
      paragraphs: section.paragraph_ids.map((id) => paragraphById.get(id)!),
      glossary,
      layout,
      prevAt,
      usage,
      sectionCount: outline.sections.length,
      ...(onProgress ? { onProgress } : {}),
    });
    results.push({ section: outcome.section, actions: outcome.actions, warnings: outcome.warnings, errors: outcome.errors, dropped: outcome.dropped, rounds: outcome.rounds });
    prevAt = Math.max(prevAt, outcome.lastAt);
  }

  const script: BoardScript = {
    version: "1.0",
    meta: {
      title: outline.title,
      ...(transcript.track_id !== undefined ? { source_track_id: transcript.track_id } : {}),
      duration_ms: transcript.duration_ms,
      generated_at: (opts.now?.() ?? new Date()).toISOString(),
      model: llm.model,
    },
    paragraphs: transcript.paragraphs,
    sections: outline.sections,
    actions: assemble(results),
  };
  const check = parseScript(script);
  const issues = check.ok ? [] : check.issues;
  if (issues.length > 0) onProgress?.(`[check] 最终脚本自检发现 ${issues.length} 处问题`);
  return { script, results, usage, issues, model: llm.model };
}
