import { useCallback, useEffect, useState } from "react";
import type { HeldCommand, NodeStatus, SetupClient } from "../setup/client";

const METHOD_LABEL: Record<string, string> = {
  "run.start": "Start a run",
  "preferences.set": "Replace the agent preferences",
  "run.cancel": "Cancel a run",
  "request.resolve": "Answer an approval",
  "bus.post": "Post on a run's bus",
  "limits.clear": "Lift a usage limit",
};

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === "string" ? err : String((err as { message?: unknown })?.message ?? err);
}

/** One line of what a held command would do. */
export function describeCommand(c: HeldCommand): string {
  const p = c.params as Record<string, unknown>;
  if (c.method === "run.start") {
    const agents = p.agents && typeof p.agents === "object" ? Object.entries(p.agents as Record<string, string>) : [];
    return [
      `in ${String(p.repository ?? "?")}`,
      p.prompt ? `"${String(p.prompt).slice(0, 160)}"` : "",
      agents.length ? `agents: ${agents.map(([r, h]) => `${r} ${h}`).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (c.method === "preferences.set") {
    const prefs = (p.preferences ?? {}) as { order?: string[] };
    return prefs.order?.length ? `order: ${prefs.order.join(", ")}` : "new agent preferences";
  }
  return JSON.stringify(p).slice(0, 200);
}

/**
 * This node's link to AgentUX Command: where it reports, and the commands
 * from Command that wait for someone here (the node policy's `confirm`).
 */
export function RemoteControl({ setup, pollMs = 10_000 }: { setup: () => Promise<SetupClient | null>; pollMs?: number }) {
  const [status, setStatus] = useState<NodeStatus | null>(null);
  const [held, setHeld] = useState<HeldCommand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await setup();
      if (!s) {
        setError("Remote control needs the AgentUX desktop.");
        return;
      }
      const [st, pending] = await Promise.all([s.nodeStatus(), s.nodePending()]);
      setStatus(st);
      setHeld(pending);
    } catch (err) {
      setError(errorText(err));
    }
  }, [setup]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), pollMs);
    return () => clearInterval(timer);
  }, [load, pollMs]);

  const decide = async (id: string, accept: boolean) => {
    setBusy(id);
    setError(null);
    try {
      const s = await setup();
      await s?.decideCommand(id, accept);
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  if (!status) return error ? <div className="form-error" role="alert">{error}</div> : <p className="muted">Loading…</p>;

  return (
    <div>
      {status.enrolled ? (
        <p>
          This node (<span className="mono">{status.nodeId}</span>) reports to{" "}
          <span className="mono">{status.commandUrl}</span> for <strong>{status.organizationId}</strong>. Gateway:{" "}
          <span className={status.gateway === "active" ? "ok" : "err"}>{status.gateway}</span>.
        </p>
      ) : (
        <p className="muted">
          Not connected to AgentUX Command. To manage this node from a Command server, run in a terminal{" "}
          <code>aux node enroll https://command.example.org</code> (it asks for the enrollment token the Command server issued),
          then <code>systemctl --user enable --now agentux-gateway</code>.
        </p>
      )}
      <p className="muted">
        What Command may do here is set in <code>/etc/agentux/node-policy.yaml</code>. Starting runs and changing agent
        preferences wait for you below.
      </p>
      {held.length > 0 ? (
        <ul className="held-list" aria-label="Commands waiting for you">
          {held.map((c) => (
            <li key={c.commandId}>
              <div>
                <strong>{METHOD_LABEL[c.method] ?? c.method}</strong>{" "}
                <span className="muted mono">
                  {c.commandId} · {new Date(c.receivedAt).toLocaleString()}
                </span>
                <div className="held-detail">{describeCommand(c)}</div>
              </div>
              <span className="key-actions">
                <button className="btn btn-primary" disabled={busy === c.commandId} onClick={() => void decide(c.commandId, true)}>
                  Accept
                </button>
                <button className="btn btn-quiet" disabled={busy === c.commandId} onClick={() => void decide(c.commandId, false)}>
                  Reject
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        status.enrolled && <p className="muted">No command from Command is waiting.</p>
      )}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
