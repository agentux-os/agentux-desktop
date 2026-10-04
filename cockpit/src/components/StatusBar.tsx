import type { CockpitState, Vendor } from "../daemon/types";
import { VENDORS } from "../daemon/types";
import { VENDOR_INFO } from "../daemon/vendors";
import { formatTokens, formatUsd } from "../lib/format";
import { vendorStyle } from "./VendorBadge";
import { Icon } from "./Icon";

/**
 * Spend per vendor, from what the sessions report: cost (`usage.costUsd`,
 * cumulative per session) and the tokens currently in their context windows.
 * Harnesses the cockpit does not know count in the total only.
 */
export function vendorSpend(state: CockpitState): { perVendor: Record<Vendor, { costUsd: number; contextTokens: number; sessions: number }>; totalUsd: number } {
  const perVendor = Object.fromEntries(VENDORS.map((v) => [v, { costUsd: 0, contextTokens: 0, sessions: 0 }])) as Record<
    Vendor,
    { costUsd: number; contextTokens: number; sessions: number }
  >;
  for (const s of Object.values(state.sessions)) {
    if (!s.vendor) continue;
    const v = perVendor[s.vendor];
    v.costUsd += s.usage.costUsd ?? 0;
    v.contextTokens += s.usage.usedTokens;
    v.sessions += 1;
  }
  // Run totals are authoritative (the daemon sums its sessions, unknown harnesses included).
  const totalUsd = Object.values(state.runs).reduce((acc, r) => acc + r.costUsd, 0);
  return { perVendor, totalUsd };
}

export function StatusBar({ state, onHelp }: { state: CockpitState; onHelp: () => void }) {
  const runs = Object.values(state.runs);
  const active = runs.filter((r) => r.status === "running" || r.status === "waiting").length;
  const waiting = Object.values(state.requests).filter((r) => r.status === "pending").length;
  const { perVendor, totalUsd } = vendorSpend(state);
  const vendors = VENDORS.filter((v) => perVendor[v].sessions > 0);
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
      {(vendors.length > 0 || totalUsd > 0) && (
        <span
          className="sb-spend"
          title={
            "Cost per vendor as the harnesses report it, and tokens currently in their sessions' context windows" +
            (mock ? " (mock data, illustrative pricing)" : "")
          }
        >
          {vendors.map((v) => {
            const s = perVendor[v];
            return (
              <span key={v} className="sb-vendor" style={vendorStyle(v)}>
                <span className="sb-vdot" />
                {VENDOR_INFO[v].label}
                <span className="muted">{formatTokens(s.contextTokens)} ctx</span>
                <span>{formatUsd(s.costUsd)}</span>
              </span>
            );
          })}
          <span className="sb-total">
            <Icon name="coins" size={13} /> {formatUsd(totalUsd)} across runs
          </span>
        </span>
      )}
      <button className="sb-help" onClick={onHelp} title="Keyboard shortcuts (?)">
        <Icon name="keyboard" size={14} />
      </button>
    </footer>
  );
}
