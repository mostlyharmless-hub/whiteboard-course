interface TopBarProps {
  title: string;
  scale: number;
  onZoom: (factor: number) => void;
  onReset: () => void;
  pageIndex: number;
  pageCount: number;
  pageTitle: string | null;
  onPage: (index: number) => void;
  follow: boolean;
  onFollow: (v: boolean) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export function TopBar(p: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="btn icon" title={p.sidebarOpen ? "收起大纲" : "展开大纲"} onClick={p.onToggleSidebar}>
          ☰
        </button>
        <span className="course-title">{p.title}</span>
      </div>
      <div className="topbar-center">
        <button className="btn icon" disabled={p.pageIndex <= 0} onClick={() => p.onPage(p.pageIndex - 1)} title="上一页">
          ‹
        </button>
        <span className="page-nav">
          {p.pageCount === 0 ? "—" : `${p.pageIndex + 1} / ${p.pageCount}`}
          {p.pageTitle !== null && <span className="page-title">{p.pageTitle}</span>}
        </span>
        <button className="btn icon" disabled={p.pageIndex >= p.pageCount - 1} onClick={() => p.onPage(p.pageIndex + 1)} title="下一页">
          ›
        </button>
      </div>
      <div className="topbar-right">
        <span className="zoom-pill">
          <button className="btn icon" onClick={() => p.onZoom(1 / 1.2)} title="缩小">
            −
          </button>
          <button className="zoom-pct" onClick={p.onReset} title="复位">
            {Math.round(p.scale * 100)}%
          </button>
          <button className="btn icon" onClick={() => p.onZoom(1.2)} title="放大">
            +
          </button>
        </span>
        <button className={`btn toggle${p.follow ? " on" : ""}`} onClick={() => p.onFollow(!p.follow)} title="相机跟随新卡片">
          跟随
        </button>
      </div>
    </header>
  );
}
