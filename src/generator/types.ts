import type { Action, BoardScript, Paragraph, ScriptIssue, Section } from "../shared/schema";

export interface Transcript {
  paragraphs: Paragraph[];
  duration_ms: number;
  track_id?: string;
}

export interface GlossaryRule {
  from: string;
  to: string;
  note?: string;
}
export interface Glossary {
  rules: GlossaryRule[];
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** 节内动作：已换算时间，card_id / target_card_id 仍是节内局部 id，尚无全局 id */
export type LocalAction = DistributiveOmit<Action, "id">;

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  calls: number;
}

export function emptyUsage(): Usage {
  return { input_tokens: 0, output_tokens: 0, calls: 0 };
}

/** 需要打回 LLM 的错误：index 指向该节动作数组的下标 */
export interface ValidationError {
  index: number;
  message: string;
}

export interface SectionResult {
  section: Section;
  actions: LocalAction[];
  warnings: string[];
  errors: string[];
  dropped: LocalAction[];
  /** 打回轮数（0 = 一次通过） */
  rounds: number;
}

export interface GenerateResult {
  script: BoardScript;
  results: SectionResult[];
  usage: Usage;
  /** 最终脚本自检（parseScript）未通过时的问题清单 */
  issues: ScriptIssue[];
  model: string;
  /** 时间轴后处理（ADR 005：有语音时白板不为空）的修改记录 */
  timelineChanges: string[];
}
