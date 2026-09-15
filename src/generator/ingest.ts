import { z } from "zod";
import type { Transcript } from "./types";

const TranscriptSchema = z.object({
  data: z.object({
    paragraphs: z
      .array(
        z.object({
          text: z.string(),
          begin_time: z.number().int().nonnegative(),
          end_time: z.number().int().nonnegative(),
          paragraph_id: z.string().min(1),
        }),
      )
      .min(1),
  }),
  track_id: z.string().optional(),
});

/** 只取 data.paragraphs；不修改任何文本 */
export function ingest(raw: unknown): Transcript {
  const r = TranscriptSchema.safeParse(raw);
  if (!r.success) {
    throw new Error(`讲解稿格式不正确：${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("；")}`);
  }
  const seen = new Set<string>();
  const paragraphs = r.data.data.paragraphs.map((p, i) => {
    if (p.text.trim() === "") throw new Error(`段落 ${p.paragraph_id} 的 text 为空`);
    if (p.begin_time >= p.end_time) throw new Error(`段落 ${p.paragraph_id} 的 begin_time 必须小于 end_time`);
    if (seen.has(p.paragraph_id)) throw new Error(`paragraph_id ${p.paragraph_id} 重复`);
    seen.add(p.paragraph_id);
    const prev = r.data.data.paragraphs[i - 1];
    if (prev && p.begin_time < prev.begin_time) throw new Error(`段落 ${p.paragraph_id} 未按 begin_time 升序`);
    return { paragraph_id: p.paragraph_id, text: p.text, begin_time: p.begin_time, end_time: p.end_time };
  });
  const duration_ms = paragraphs[paragraphs.length - 1]!.end_time;
  const transcript: Transcript = { paragraphs, duration_ms };
  if (r.data.track_id !== undefined) transcript.track_id = r.data.track_id;
  return transcript;
}
