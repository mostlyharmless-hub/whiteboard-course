/* eslint-disable react-hooks/refs -- 这里的 ref 是纯粹的 memo 缓存：内容由 (actions, n) 唯一决定，任何一次渲染读到的结果都相同 */
import { useMemo, useRef } from "react";
import type { Action } from "../../shared/schema";
import { apply, countApplied, initialState, type BoardState } from "../../shared/reducer";

/**
 * 时刻 t 的板书状态。前进时只增量应用新动作；后退（拖动进度）或脚本更换时从头重算。
 * 返回值中的 marks 已过滤为 until > t，且仅在活动集合变化时才是新数组。
 */
export function useBoardState(actions: Action[], t: number): BoardState {
  const cache = useRef<{ actions: Action[]; state: BoardState }>({ actions, state: initialState });
  const n = countApplied(actions, t);

  const folded = useMemo(() => {
    let { state } = cache.current;
    if (cache.current.actions !== actions || n < state.applied) state = initialState;
    for (let i = state.applied; i < n; i++) state = apply(state, actions[i]!);
    cache.current = { actions, state };
    return state;
  }, [actions, n]);

  const activeKey = folded.marks
    .filter((m) => m.until > t)
    .map((m) => m.id)
    .join(",");

  return useMemo(() => {
    const ids = new Set(activeKey.split(",").filter(Boolean));
    return { ...folded, marks: folded.marks.filter((m) => ids.has(m.id)) };
  }, [folded, activeKey]);
}
