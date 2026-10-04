import type { CockpitState } from "../daemon/types";
import { VENDORS } from "../daemon/types";
import { VENDOR_INFO } from "../daemon/vendors";
import { formatTokens, formatUsd } from "../lib/format";
import { vendorStyle } from "./VendorBadge";
import { Icon } from "./Icon";

export function StatusBar({ state, onHelp }: { state: CockpitState; onHelp: () => void }) {
  const runs = Object.values(state.runs);
  const active = runs.filter((r) => r.status === "running" || r.status === "waiting").length;
  const waiting = Object.values(state.requests).filter((r) => r.status === "pending").length;
  const total = VENDORS.reduce((acc, v) => acc + state.spend[v].costUsd, 0);
  const tokens = VENDORS.reduce((acc, v) => acc + state.spend[v].input + state.spend[v].output, 0);
  const { status, daemon, detail, mock } = state.connection;

  return (
    <footer className="statusbar">
      <span className={`conn conn-${status}`} title={detail}>
        <span className="conn-dot" />
        agentuxd <span className="muted">({daemon})</span> · {status}
      </span>
      {mock && (
        <span className="mock-badge" title="The cockpit is showing scripted mock data, not a real agentuxd">
          Mock data
        </span>
      )}
      <span className="sb-item">
        {active} active run{active === 1 ? "" : "s"}
      </span>
      {waiting > 0 && <span className="sb-item sb-attention">{waiting} waiting for you</span>}
      <span className="sb-spacer" />
      {(mock || tokens > 0) && (
      <span className="sb-spend" title={mock ? "Token spend today per vendor (mock data, illustrative pricing)" : "Token spend today per vendor"}>
        {VENDORS.map((v) => {
          const s = state.spend[v];
          return (
            <span key={v} className="sb-vendor" style={vendorStyle(v)}>
              <span className="sb-vdot" />
              {VENDOR_INFO[v].label}
              <span className="muted">{formatTokens(s.input + s.output)}</span>
              <span>{formatUsd(s.costUsd)}</span>
            </span>
          );
        })}
        <span className="sb-total">
          <Icon name="coins" size={13} /> {formatUsd(total)} today
        </span>
      </span>
      )}
      <button className="sb-help" onClick={onHelp} title="Keyboard shortcuts (?)">
        <Icon name="keyboard" size={14} />
      </button>
    </footer>
  );
}
