import type { AgentId, GitConfig, SetupClient, SetupStatus, SignInTarget } from "./client";

interface SetupOutput {
  code: number;
  stdout: string;
  stderr: string;
}

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

/** The wizard on a real system: every call is one `agentux-setup` run. */
export class TauriSetupClient implements SetupClient {
  readonly mode = "system" as const;

  constructor(private readonly invoke: Invoke = tauriInvoke) {}

  /** Runs `agentux-setup ARGS...`; rejects with its stderr on a non-zero exit. */
  async exec(args: string[], stdin?: string): Promise<string> {
    const out = await this.invoke<SetupOutput>("setup_exec", { args, stdin: stdin ?? null });
    if (out.code !== 0) {
      throw new Error(out.stderr.trim() || out.stdout.trim() || `agentux-setup ${args[0]} failed (exit ${out.code})`);
    }
    return out.stdout;
  }

  async status(scan = false): Promise<SetupStatus> {
    return JSON.parse(await this.exec(scan ? ["status", "--scan"] : ["status"])) as SetupStatus;
  }

  async selectProfile(profile: string): Promise<void> {
    await this.exec(["profile", profile]);
  }

  async start(specs: string[]): Promise<void> {
    if (specs.length) await this.exec(["start", ...specs]);
  }

  async retryFirstLogin(): Promise<void> {
    await this.exec(["retry-first-login"]);
  }

  async signIn(target: SignInTarget): Promise<void> {
    await this.exec(["signin", target]);
  }

  async updateAgent(id: AgentId): Promise<void> {
    await this.exec(["update-agent", id]);
  }

  async launch(itemId: string): Promise<void> {
    await this.exec(["launch", itemId]);
  }

  async openUrl(url: string): Promise<void> {
    await this.exec(["open-url", url]);
  }

  async clone(source: string, into?: string): Promise<string> {
    return (await this.exec(into ? ["clone", source, "--into", into] : ["clone", source])).trim();
  }

  async keys(): Promise<Record<string, boolean>> {
    return JSON.parse(await this.exec(["key", "list"])) as Record<string, boolean>;
  }

  async setKey(variable: string, value: string): Promise<void> {
    await this.exec(["key", "set", variable], value);
  }

  async removeKey(variable: string): Promise<void> {
    await this.exec(["key", "remove", variable]);
  }

  async getGit(): Promise<GitConfig> {
    return JSON.parse(await this.exec(["git", "--show"])) as GitConfig;
  }

  async setGit(config: GitConfig): Promise<GitConfig> {
    return JSON.parse(await this.exec(["git", config.name, config.email, config.defaultBranch])) as GitConfig;
  }

  async sshKey(): Promise<string | null> {
    const out = await this.invoke<SetupOutput>("setup_exec", { args: ["ssh-key", "--show"], stdin: null });
    return out.code === 0 ? out.stdout.trim() : null;
  }

  async generateSshKey(comment: string, passphrase: string): Promise<string> {
    return (await this.exec(comment ? ["ssh-key", comment] : ["ssh-key"], passphrase)).trim();
  }

  async finish(): Promise<void> {
    await this.exec(["finish"]);
  }

  async close(openCockpit: boolean): Promise<void> {
    await this.invoke("welcome_close", { openCockpit });
  }
}
