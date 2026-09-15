import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type PromptName = "outline" | "script" | "repair";

export interface Prompt {
  system: string;
  user: string;
}

const SEPARATOR = /^===== USER =====$/m;

/** 提示词文件：分隔行之前是 system，之后是 user 模板 */
export function loadPrompt(name: PromptName, dir = "prompts"): Prompt {
  const text = readFileSync(resolve(dir, `${name}.md`), "utf8");
  const m = SEPARATOR.exec(text);
  if (!m) throw new Error(`提示词 ${name}.md 缺少 "===== USER =====" 分隔行`);
  return { system: text.slice(0, m.index).trim(), user: text.slice(m.index + m[0].length).trim() };
}

/** 注入 {{key}}；缺少变量时抛错，避免把占位符原样发给模型 */
export function render(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === undefined) throw new Error(`提示词缺少变量 {{${key}}}`);
    return String(v);
  });
}
