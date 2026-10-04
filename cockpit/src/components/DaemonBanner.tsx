import { useState } from "react";
import { retryDaemon } from "../daemon/client";
import { Icon } from "./Icon";

/**
 * Shown inside Tauri when agentuxd could not be reached at startup and the
 * cockpit fell back to mock data. The window reloads on its own once the
 * backend connects; "Retry" probes right away.
 */
export function DaemonBanner({ reason }: { reason: string }) {
  const [checking, setChecking] = useState(false);
  const [stillDown, setStillDown] = useState(false);

  const retry = async () => {
    setChecking(true);
    const ok = await retryDaemon().catch(() => false);
    if (!ok) {
      setChecking(false);
      setStillDown(true);
    }
  };

  return (
    <div className="banner" role="status">
      <Icon name="info" size={15} />
      <div className="banner-text">
        <strong>agentuxd is not running</strong> — showing mock data. Start it with <code>aux daemon</code> (or{" "}
        <code>aux daemon --fake-agents</code> for a demo); the cockpit connects automatically.
        <div className="muted banner-detail">{stillDown ? `Still unreachable: ${reason}` : reason}</div>
      </div>
      <button className="btn" onClick={() => void retry()} disabled={checking}>
        {checking ? "Checking…" : "Retry"}
      </button>
    </div>
  );
}
