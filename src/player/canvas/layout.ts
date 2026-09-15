/** 页逻辑尺寸与布局常量（CLAUDE.md 第 7.2 节） */
export const PAGE = {
  W: 1600,
  H: 900,
  PAD: 48,
  GAP: 32,
  COL_W: 480,
  CARD_GAP: 24,
  COL_MAX_H: 804,
} as const;

export function columnX(index: number): number {
  return PAGE.PAD + index * (PAGE.COL_W + PAGE.GAP);
}

/** 按 card_id 哈希得到 −0.4° ~ 0.4° 的微小旋转 */
export function hashRotation(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (((h >>> 0) % 1000) / 1000) * 0.8 - 0.4;
}

/** 确定性伪随机：同一 seed 产生同一序列，用于画圈抖动 */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
