import type { Glossary } from "../generator/types";

/** 把术语表按顺序全量替换到文本上：TTS 朗读纠错后的文本，而不是 ASR 原文 */
export function applyGlossary(text: string, glossary: Glossary): string {
  let out = text;
  for (const rule of glossary.rules) out = out.split(rule.from).join(rule.to);
  return out;
}
