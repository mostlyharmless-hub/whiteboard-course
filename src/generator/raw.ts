import { z } from "zod";
import { AnchorSchema } from "../shared/schema";

/** LLM 第二遍的原始输出形态：没有 id / at / reveal_ms / until；长度类限制留给校验器修正或打回 */
const base = { anchor: AnchorSchema };

export const RawNewPageSchema = z.object({ ...base, type: z.literal("new_page"), title: z.string().min(1) });
export const RawNewColumnSchema = z.object({ ...base, type: z.literal("new_column") });
export const RawBoardSchema = z.object({ ...base, type: z.literal("board"), card_id: z.string().min(1), content: z.string().min(1) });
export const RawMermaidSchema = z.object({
  ...base,
  type: z.literal("mermaid"),
  card_id: z.string().min(1),
  title: z.string().optional(),
  code: z.string().min(1),
});
export const RawHighlightSchema = z.object({
  ...base,
  type: z.literal("highlight"),
  target_card_id: z.string().min(1),
  snippet: z.string().min(1),
});
export const RawCircleSchema = z.object({
  ...base,
  type: z.literal("circle"),
  target_card_id: z.string().min(1),
  snippet: z.string().min(1),
});

export const RawActionSchema = z.discriminatedUnion("type", [
  RawNewPageSchema,
  RawNewColumnSchema,
  RawBoardSchema,
  RawMermaidSchema,
  RawHighlightSchema,
  RawCircleSchema,
]);
export const RawActionsSchema = z.array(RawActionSchema);
export type RawAction = z.infer<typeof RawActionSchema>;

/** LLM 第一遍的原始输出形态：课程标题 + 小节（没有 begin_ms / end_ms） */
export const RawOutlineSchema = z.object({
  title: z.string().min(1),
  sections: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        intent: z.string(),
        paragraph_ids: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(1),
});
export type RawOutline = z.infer<typeof RawOutlineSchema>;
