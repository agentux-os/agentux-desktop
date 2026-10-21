import { planCommands, parseSpec } from "./commands";
import {
  AGENT_STEP,
  FIRST_LOGIN_STEPS,
  type AgentId,
  type GitConfig,
  type HeldCommand,
  type NodeStatus,
  type ItemStatus,
  type SetupClient,
  type SetupStatus,
  type SignInTarget,
} from "./client";

export interface MockSetupOptions {
  /** Time runs this many times faster. */
  speed?: number;
  /** Item ids whose install fails (and `first-login` to fail the agent CLIs once). */
  fail?: string[];
  /** First-login steps already finished when the mock starts. */
  firstLoginDone?: number;
  /** Catalog items installed from the start. */
  installed?: string[];
  arch?: string;
}

const STEP_MS = 2500;
const ITEM_MS = 3200;

/**
 * The wizard's backend, played in memory: first-login installs the agent CLIs
 * one step at a time, batches install item by item, and everything the UI
 * asks for is recorded in `calls`.
 */
export class MockSetupClient implements SetupClient {
  readonly mode = "mock" as const;
  readonly calls: string[] = [];
  closed: { openCockpit: boolean } | null = null;

  private readonly speed: number;
  private readonly fail: Set<string>;
  private readonly arch: string;
  private items: Record<string, ItemStatus> = {};
  private installed: Set<string>;
  private steps: { name: string; result: string; seconds: number }[] = [];
  private firstLoginState: "activating" | "failed" | "inactive" = "activating";
  private firstLoginFailedOnce = false;
  private queue: string[] = [];
  private busy = false;
  private git: GitConfig = { name: "", email: "", defaultBranch: "" };
  private key: string | null = null;
  private finished = false;
  private profile = "workstation";

  constructor(options: MockSetupOptions = {}) {
    this.speed = Math.max(0.1, options.speed ?? 1);
    this.fail = new Set(options.fail ?? []);
    this.arch = options.arch ?? "x86_64";
    this.installed = new Set(options.installed ?? []);
    const done = Math.min(options.firstLoginDone ?? 2, FIRST_LOGIN_STEPS.length);
    this.steps = FIRST_LOGIN_STEPS.slice(0, done).map((name, i) => ({ name, result: "ok", seconds: 20 + i * 7 }));
    this.scheduleFirstLogin();
  }

  get isFinished(): boolean {
    return this.finished;
  }

  private ms(n: number): number {
    return n / this.speed;
  }

  private scheduleFirstLogin(): void {
    if (this.steps.length >= FIRST_LOGIN_STEPS.length) {
      this.firstLoginState = "inactive";
      return;
    }
    this.firstLoginState = "activating";
    setTimeout(() => {
      const name = FIRST_LOGIN_STEPS[this.steps.length];
      if (name === "Antigravity CLI" && this.fail.has("first-login") && !this.firstLoginFailedOnce) {
        this.firstLoginFailedOnce = true;
        this.steps.push({ name, result: "failed", seconds: 41 });
        this.firstLoginState = "failed";
        return;
      }
      this.steps.push({ name, result: "ok", seconds: 30 });
      this.scheduleFirstLogin();
    }, this.ms(STEP_MS));
  }

  async status(scan = false): Promise<SetupStatus> {
    const ok = new Set(this.steps.filter((s) => s.result === "ok").map((s) => s.name));
    const agents = (Object.keys(AGENT_STEP) as AgentId[]).map((id) => ({
      id,
      command: id === "antigravity" ? "agy" : id,
      installed: ok.has(AGENT_STEP[id]),
      signedIn: id === "antigravity" ? null : this.calls.includes(`signin ${id}`),
    }));
    const done = this.steps.length === FIRST_LOGIN_STEPS.length && this.steps.every((s) => s.result === "ok");
    return {
      arch: this.arch,
      flathub: this.installed.size > 0 || Object.values(this.items).some((i) => i.state === "done"),
      items: structuredClone(this.items),
      agents,
      firstLogin: {
        active: this.firstLoginState,
        result: this.firstLoginState === "failed" ? "exit-code" : "success",
        done,
        steps: this.steps.map((s) => ({ ...s })),
      },
      profile: {
        catalogVersion: 1,
        requested: this.profile,
        applied: this.profile === "workstation" ? ["node", "desktop"] : [],
        pending: [],
        failed: [],
      },
      ...(scan ? { installed: [...this.installed].sort() } : {}),
    };
  }

  async selectProfile(profile: string): Promise<void> {
    this.calls.push(`profile ${profile}`);
    this.profile = profile;
  }

  async start(specs: string[]): Promise<void> {
    this.calls.push(`start ${specs.join(" ")}`);
    for (const spec of specs) {
      const { id, version } = parseSpec(spec);
      this.items[id] = { id, state: "queued", version: version ?? "", updated: now(), message: "" };
      this.queue.push(spec);
    }
    this.pump();
  }

  private pump(): void {
    if (this.busy) return;
    const spec = this.queue.shift();
    if (!spec) return;
    this.busy = true;
    const { id, version } = parseSpec(spec);
    const commands = planCommands([spec]).map((c) => c.command);
    let step = 0;
    const tick = () => {
      if (step < commands.length) {
        this.items[id] = { id, state: "running", version: version ?? "", updated: now(), message: commands[step] };
        step += 1;
        setTimeout(tick, this.ms(ITEM_MS / commands.length));
        return;
      }
      const failed = this.fail.has(id);
      this.items[id] = {
        id,
        state: failed ? "failed" : "done",
        version: version ?? "",
        updated: now(),
        message: failed ? "error: Unable to load summary from remote flathub: Could not resolve host: dl.flathub.org" : "Installation complete.",
      };
      if (failed) this.fail.delete(id);
      else this.installed.add(id);
      this.busy = false;
      this.pump();
    };
    tick();
  }

  async retryFirstLogin(): Promise<void> {
    this.calls.push("retry-first-login");
    if (this.firstLoginState === "failed") {
      this.steps = [];
      this.scheduleFirstLogin();
    }
  }

  async signIn(target: SignInTarget): Promise<void> {
    this.calls.push(`signin ${target}`);
  }

  async updateAgent(id: AgentId): Promise<void> {
    this.calls.push(`update-agent ${id}`);
  }

  async launch(itemId: string): Promise<void> {
    this.calls.push(`launch ${itemId}`);
  }

  async openUrl(url: string): Promise<void> {
    this.calls.push(`open-url ${url}`);
    if (!/jsdom/i.test(navigator.userAgent)) window.open(url, "_blank", "noopener");
  }

  async clone(source: string, into?: string): Promise<string> {
    this.calls.push(into ? `clone ${source} --into ${into}` : `clone ${source}`);
    const name = source.replace(/\/+$/, "").replace(/\.git$/, "").split(/[/:]/).pop();
    if (!name) throw new Error(`clone: not a repository URL or OWNER/REPO: ${source}`);
    const parent = (into ?? "~/src").replace(/^~/, "/home/you").replace(/\/+$/, "");
    return `${parent}/${name}`;
  }

  private stored = new Set<string>();

  async keys(): Promise<Record<string, boolean>> {
    return Object.fromEntries(
      ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"].map((k) => [k, this.stored.has(k)]),
    );
  }

  async setKey(variable: string, value: string): Promise<void> {
    if (!value.trim()) throw new Error("key: the key is empty");
    this.calls.push(`key set ${variable}`);
    this.stored.add(variable);
  }

  async removeKey(variable: string): Promise<void> {
    this.calls.push(`key remove ${variable}`);
    this.stored.delete(variable);
  }

  held: HeldCommand[] = [
    {
      commandId: "cmd-7f3a",
      method: "run.start",
      params: { repository: "https://github.com/acme/ledger-api", prompt: "Add rate limiting to the public API", agents: { implementer: "opencode" } },
      receivedAt: "2026-10-21T14:02:00Z",
    },
  ];

  node: NodeStatus = { enrolled: true, commandUrl: "https://command.example.org", organizationId: "org-acme", nodeId: "node-workstation", gateway: "active" };

  async nodeStatus(): Promise<NodeStatus> {
    return { ...this.node };
  }

  async enrollNode(input: { url: string; organization: string; nodeId?: string; token: string }): Promise<NodeStatus> {
    if (!input.token) throw new Error("node: the token is empty");
    this.calls.push(`node enroll ${input.url} ${input.organization}`);
    this.node = { enrolled: true, commandUrl: input.url, organizationId: input.organization, nodeId: input.nodeId ?? "node-demo", gateway: "active" };
    return { ...this.node };
  }

  async nodePending(): Promise<HeldCommand[]> {
    return [...this.held];
  }

  async decideCommand(commandId: string, accept: boolean): Promise<void> {
    this.calls.push(`node ${accept ? "confirm" : "reject"} ${commandId}`);
    this.held = this.held.filter((h) => h.commandId !== commandId);
  }

  async getGit(): Promise<GitConfig> {
    return { ...this.git };
  }

  async setGit(config: GitConfig): Promise<GitConfig> {
    if (!config.name.trim() || !config.email.includes("@")) throw new Error("git: a name and an e-mail address are needed");
    this.calls.push(`git ${config.name} ${config.email} ${config.defaultBranch}`);
    this.git = { ...config };
    return { ...this.git };
  }

  async sshKey(): Promise<string | null> {
    return this.key;
  }

  async generateSshKey(comment: string, passphrase: string): Promise<string> {
    this.calls.push(`ssh-key ${comment}${passphrase ? " (with passphrase)" : ""}`);
    this.key ??= `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIK3m9pZq0rX2c7vYh5wT1sLq8fJ4nB6dE0aG2uV9yQxM ${comment || "you@agentux"}`;
    return this.key;
  }

  async finish(): Promise<void> {
    this.calls.push("finish");
    this.finished = true;
  }

  async close(openCockpit: boolean): Promise<void> {
    this.calls.push(`close ${openCockpit ? "open-cockpit" : ""}`.trim());
    this.closed = { openCockpit };
  }
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}
