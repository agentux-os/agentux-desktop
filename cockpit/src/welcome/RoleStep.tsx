import { useCallback, useEffect, useState, type FormEvent } from "react";
import { help } from "../helper/content";
import type { NodeStatus, SetupClient } from "../setup/client";
import type { Profile } from "./profiles";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The step after the profile: what that role needs from Command. */
export function RoleStep({ profile, client, onError }: { profile: Profile; client: SetupClient; onError: (m: string) => void }) {
  return (
    <div className="wz-stack">
      {(profile.id === "command" || profile.id === "complete") && <CommandServer complete={profile.id === "complete"} />}
      {(profile.id === "workstation" || profile.id === "node" || profile.id === "complete") && (
        <ConnectNode client={client} profile={profile} onError={onError} />
      )}
      {profile.id === "executive" && (
        <section className="wz-card" aria-labelledby="exec-title">
          <h2 id="exec-title">Follow a Command server</h2>
          <p>
            The Office view shows an organization's missions, approvals and spending from its Command server. Ask your
            administrator for the server's address and an Office account; the AgentUX Office client opens it.
          </p>
          <p className="muted">Nothing runs or is stored on this machine for it.</p>
        </section>
      )}
    </div>
  );
}

/** What a Command server needs, in order. */
function CommandServer({ complete }: { complete: boolean }) {
  return (
    <section className="wz-card" aria-labelledby="command-title" {...help("wz.role.command")}>
      <h2 id="command-title">Set up the Command server</h2>
      <p>
        Command runs as containers next to its database and queues. Its services stay off until it has an image and a
        configuration, so nothing listens on the network by accident.
      </p>
      <ol className="wz-steps-list">
        <li>
          Write the configuration to <code>/etc/agentux/command/config.env</code>: the database password, the server's
          public address, and one token per node (<code>AGENTUX_COMMAND_NODE_TOKENS=node-a=…,node-b=…</code>). Start from{" "}
          <code>command.env.example</code> in agentux-command.
        </li>
        <li>
          Turn it on:{" "}
          <code>sudo AGENTUX_COMMAND_IMAGE=ghcr.io/agentux-os/agentux-command:latest agentux profile apply command</code>
        </li>
        <li>
          Give it a DNS name with TLS that the nodes can reach (a reverse proxy, or your network's certificate).
        </li>
        <li>
          On each node, connect it with its token:{" "}
          <code>aux node enroll https://command.example.org --organization your-org</code>
          {complete ? " (this machine's node is connected below)" : ""}.
        </li>
      </ol>
      <p className="muted wz-small">
        Nodes connect out to Command; you never list their addresses here, and no port opens on them. Each node decides
        in its own policy what Command may do on it.
      </p>
    </section>
  );
}

/** Connects this machine's node to a Command server (aux node enroll). */
function ConnectNode({ client, profile, onError }: { client: SetupClient; profile: Profile; onError: (m: string) => void }) {
  const [status, setStatus] = useState<NodeStatus | null>(null);
  const [url, setUrl] = useState(profile.id === "complete" ? "http://localhost:8080" : "");
  const [organization, setOrganization] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await client.nodeStatus());
    } catch (err) {
      onError(errorText(err));
    }
  }, [client, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !organization.trim() || !token.trim()) return;
    setBusy(true);
    try {
      await client.enrollNode({ url: url.trim(), organization: organization.trim(), nodeId: nodeId.trim() || undefined, token: token.trim() });
      setToken("");
      await load();
    } catch (err) {
      onError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="wz-card" aria-labelledby="connect-title" {...help("wz.role.connect")}>
      <h2 id="connect-title">{profile.id === "node" ? "Connect this node to Command" : "Connect to a Command server (optional)"}</h2>
      <p>
        {profile.id === "node"
          ? "A node takes its work from AgentUX Command. Enter the server your administrator gave you, and this node's token."
          : "If your team runs AgentUX Command, connect this machine so the team sees its runs and can send it work. Without it, this machine works on its own."}
      </p>
      {status?.enrolled ? (
        <p className="ok">
          Connected: <span className="mono">{status.nodeId}</span> reports to <span className="mono">{status.commandUrl}</span>{" "}
          ({status.organizationId}); gateway {status.gateway}.
        </p>
      ) : (
        <form className="wz-form" onSubmit={submit}>
          <label className="field">
            <span>Command server</span>
            <input className="mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://command.example.org" />
          </label>
          <label className="field">
            <span>Organization</span>
            <input value={organization} onChange={(e) => setOrganization(e.target.value)} placeholder="your-org" />
          </label>
          <label className="field">
            <span>Node token</span>
            <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
          </label>
          <label className="field">
            <span>
              Node name <span className="muted">(optional, defaults to node-&lt;hostname&gt;)</span>
            </span>
            <input className="mono" value={nodeId} onChange={(e) => setNodeId(e.target.value)} />
          </label>
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy || !url.trim() || !organization.trim() || !token.trim()}>
              {busy ? "Connecting…" : "Connect"}
            </button>
          </div>
        </form>
      )}
      <p className="muted wz-small">
        The token stays on this machine (readable by you only). Starting runs and changing agent preferences from Command
        wait for you in the cockpit's Settings → Remote control.
      </p>
    </section>
  );
}
