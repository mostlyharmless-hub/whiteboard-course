import type { Section } from "../../shared/schema";
import { formatTime } from "./format";

interface SidebarProps {
  sections: Section[];
  currentId: string | null;
  open: boolean;
  onJump: (ms: number) => void;
}

export function Sidebar({ sections, currentId, open, onJump }: SidebarProps) {
  return (
    <aside className={`sidebar${open ? "" : " collapsed"}`}>
      <div className="sidebar-head">大纲</div>
      <ol className="outline">
        {sections.map((s, i) => (
          <li key={s.id} className={s.id === currentId ? "current" : ""} title={s.intent}>
            <button onClick={() => onJump(s.begin_ms)}>
              <span className="outline-index">{i + 1}</span>
              <span className="outline-title">{s.title}</span>
              <span className="outline-time">{formatTime(s.begin_ms)}</span>
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}
