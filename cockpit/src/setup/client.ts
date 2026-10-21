/**
 * What the welcome wizard needs from the system. `TauriSetupClient` runs
 * `/usr/libexec/agentux-setup` through the cockpit's `setup_exec` command;
 * `MockSetupClient` (a plain browser, or `?setup=mock`) plays it in memory.
 */

export type ItemState = "queued" | "running" | "done" | "failed";

export interface ItemStatus {
  id: string;
  state: ItemState;
  version: string;
  /** Unix seconds of the last change. */
  updated: number;
  /** The step being run, or the last line of the item's log. */
  message: string;
}

export type AgentId = "claude" | "codex" | "opencode" | "antigravity";

export interface AgentStatus {
  id: AgentId;
  /** The CLI's command name. */
  command: string;
  installed: boolean;
  /** Whether credentials were found; null when the CLI's are not known. */
  signedIn: boolean | null;
}

export interface FirstLoginStatus {
  /** systemd ActiveState of agentux-first-login.service (active, activating, failed, inactive...). */
  active: string;
  result: string;
  done: boolean;
  /** Steps finished in the current run (first-login.steps), in order. */
  steps: { name: string; result: string; seconds: number }[];
}

export interface ProfileStatus {
  catalogVersion: number;
  requested: string | null;
  applied: string[];
  pending: string[];
  failed: string[];
}

export interface SetupStatus {
  arch: string;
  /** The user's flathub remote exists. */
  flathub: boolean;
  items: Record<string, ItemStatus>;
  agents: AgentStatus[];
  firstLogin: FirstLoginStatus;
  profile: ProfileStatus;
  /** Catalog items found installed (only from `status(true)`). */
  installed?: string[];
}

export interface GitConfig {
  name: string;
  email: string;
  defaultBranch: string;
}

export type SignInTarget = AgentId | "github";

export interface NodeStatus {
  enrolled: boolean;
  commandUrl?: string;
  organizationId?: string;
  nodeId?: string;
  /** systemd state of agentux-gateway.service. */
  gateway: string;
}

export interface HeldCommand {
  commandId: string;
  method: string;
  params: Record<string, unknown>;
  receivedAt: string;
}

export interface SetupClient {
  readonly mode: "mock" | "system";
  /** `scan` also looks for what is installed already (slower). */
  status(scan?: boolean): Promise<SetupStatus>;
  /** Persist the selected OS profile for the system first-boot applier. */
  selectProfile(profile: string): Promise<void>;
  /** Queue `ITEM[@VERSION]` specs; they install in the background. */
  start(specs: string[]): Promise<void>;
  retryFirstLogin(): Promise<void>;
  /** Opens a terminal with the vendor's sign-in command. */
  signIn(target: SignInTarget): Promise<void>;
  /** Opens a terminal that updates an agent CLI to its latest release. */
  updateAgent(id: AgentId): Promise<void>;
  launch(itemId: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  /** Clones a repository (an https or SSH URL, or GitHub's OWNER/REPO) into `into` (default ~/src); resolves to its directory. */
  clone(source: string, into?: string): Promise<string>;
  /** Which API keys are in the secret service (never their values). */
  keys(): Promise<Record<string, boolean>>;
  /** Stores an API key in the secret service, for agentuxd to give the agent CLIs. */
  setKey(variable: string, value: string): Promise<void>;
  removeKey(variable: string): Promise<void>;
  /** This node's link to AgentUX Command (never the token). */
  nodeStatus(): Promise<NodeStatus>;
  /** Commands from Command waiting for someone at this node. */
  nodePending(): Promise<HeldCommand[]>;
  /** Accept (run) or reject a waiting command. */
  decideCommand(commandId: string, accept: boolean): Promise<void>;
  getGit(): Promise<GitConfig>;
  setGit(config: GitConfig): Promise<GitConfig>;
  /** The public key of ~/.ssh/id_ed25519, or null. */
  sshKey(): Promise<string | null>;
  /** Creates ~/.ssh/id_ed25519 if missing; returns its public key. */
  generateSshKey(comment: string, passphrase: string): Promise<string>;
  /** Marks the wizard done for this user (it stops opening at login). */
  finish(): Promise<void>;
  /** Closes the wizard window; `openCockpit` brings the cockpit forward. */
  close(openCockpit: boolean): Promise<void>;
}

/** The order first-login runs its steps in (files/usr/libexec/agentux/first-login in agentux-os). */
export const FIRST_LOGIN_STEPS = ["Claude Code", "OpenCode", "Antigravity CLI", "Codex", "dev tools", "ACP adapters"];

/** The first-login step that installs each agent CLI. */
export const AGENT_STEP: Record<AgentId, string> = {
  claude: "Claude Code",
  opencode: "OpenCode",
  antigravity: "Antigravity CLI",
  codex: "Codex",
};

export async function createSetupClient(): Promise<SetupClient> {
  const forced = new URLSearchParams(window.location.search).get("setup") === "mock";
  const { isTauri } = await import("../daemon/tauri/TauriDaemonClient");
  if (isTauri() && !forced) {
    const { TauriSetupClient } = await import("./tauri");
    return new TauriSetupClient();
  }
  const { MockSetupClient } = await import("./mock");
  const params = new URLSearchParams(window.location.search);
  return new MockSetupClient({
    speed: Number(params.get("speed")) || 1,
    fail: (params.get("fail") ?? "").split(",").filter(Boolean),
  });
}
