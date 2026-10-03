import type { CockpitState } from "../daemon/types";
import { Icon, Logo, type IconName } from "./Icon";

export type View = "board" | "inbox" | "bus";

interface Props {
  state: CockpitState;
  view: View;
  onView: (v: View) => void;
  projectId: string | null;
  onProject: (id: string | null) => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

export function Sidebar({ state, view, onView, projectId, onProject, theme, onToggleTheme }: Props) {
  const runs = Object.values(state.runs);
  const pending = Object.values(state.requests).filter((r) => r.status === "pending");
  const views: { id: View; label: string; icon: IconName; key: string; count?: number }[] = [
    { id: "board", label: "Run board", icon: "board", key: "B" },
    { id: "inbox", label: "Approvals", icon: "inbox", key: "I", count: pending.length },
    { id: "bus", label: "Agent bus", icon: "bus", key: "M" },
  ];

  const projectStats = (id: string | null) => {
    const rs = runs.filter((r) => id === null || r.projectId === id);
    return {
      active: rs.filter((r) => r.status === "running" || r.status === "waiting").length,
      waiting: pending.filter((p) => id === null || p.projectId === id).length,
    };
  };

  return (
    <nav className="sidebar" aria-label="Navigation">
      <div className="brand">
        <Logo />
        <div>
          <div className="brand-name">AgentUX</div>
          <div className="brand-sub">cockpit</div>
        </div>
      </div>

      <div className="nav-group">
        {views.map((v) => (
          <button key={v.id} className={`nav-item ${view === v.id ? "is-active" : ""}`} onClick={() => onView(v.id)}>
            <Icon name={v.icon} />
            <span className="nav-label">{v.label}</span>
            {v.count ? <span className="nav-count attention">{v.count}</span> : <kbd>{v.key}</kbd>}
          </button>
        ))}
      </div>

      <div className="nav-heading">Projects</div>
      <div className="nav-group">
        {[{ id: null, name: "All projects", language: "" }, ...state.projects].map((p) => {
          const s = projectStats(p.id);
          return (
            <button
              key={p.id ?? "all"}
              className={`nav-item project ${projectId === p.id ? "is-active" : ""}`}
              onClick={() => onProject(p.id)}
              title={p.id ? `${p.name} · ${p.language}` : "All projects"}
            >
              <Icon name={p.id ? "folder" : "board"} />
              <span className="nav-label">{p.name}</span>
              {s.waiting > 0 && <span className="nav-dot attention" title={`${s.waiting} waiting for you`} />}
              {s.active > 0 && <span className="nav-count">{s.active}</span>}
            </button>
          );
        })}
      </div>

      <div className="sidebar-foot">
        <button className="ghost-btn" onClick={onToggleTheme} title="Toggle theme">
          <Icon name={theme === "dark" ? "sun" : "moon"} />
          {theme === "dark" ? "Light" : "Dark"} theme
        </button>
      </div>
    </nav>
  );
}
