/**
 * A pretend terminal for mock mode: a line-editing echo "shell", so terminal
 * mode can be tried without agentuxd. It keeps a scrollback (as the daemon
 * does) so a view that comes back gets the screen again.
 */

/** Same cap as agentuxd's scrollback. */
const SCROLLBACK_BYTES = 256 * 1024;

const PROMPT = "\x1b[32mmock\x1b[0m:\x1b[34m~/worktree\x1b[0m$ ";

export interface FakeTerminalOptions {
  /** Banner lines printed first (each prefixed `[agentux] ` like the daemon's notes). */
  banner: string[];
  /** The program it stands for, named in the echo (`claude`, `codex`, `sh`, ...). */
  program: string;
}

export class FakeTerminal {
  private scrollback = "";
  private line = "";
  private listeners = new Set<(text: string) => void>();
  private exitListeners = new Set<(code: number | null) => void>();
  exited = false;
  running = false;

  constructor(private readonly opts: FakeTerminalOptions) {
    for (const b of opts.banner) this.print(`\x1b[2m[agentux] ${b}\x1b[0m\r\n`);
  }

  /** Output so far (up to the scrollback cap). */
  get screen(): string {
    return this.scrollback;
  }

  onOutput(listener: (text: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onExit(listener: (code: number | null) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  /** The program starts: greeting and prompt. */
  start(): void {
    if (this.running || this.exited) return;
    this.running = true;
    this.print(
      `\x1b[1mMock ${this.opts.program}\x1b[0m: no agentuxd here, so this terminal echoes what you type.\r\n` +
        `Type \x1b[1mexit\x1b[0m or press Ctrl+D to quit.\r\n\r\n${PROMPT}`,
    );
  }

  /** Keyboard input from the emulator. Input before `start` is dropped (as the daemon does while waiting). */
  input(data: string): void {
    if (!this.running || this.exited) return;
    for (let i = 0; i < data.length; i++) {
      const ch = data[i];
      if (ch === "\x1b") {
        // An escape sequence (arrows, function keys): skip it.
        const m = /^\x1b(\[[0-9;?]*[ -/]*[@-~]|O.|.)?/.exec(data.slice(i));
        i += (m?.[0].length ?? 1) - 1;
        continue;
      }
      if (ch === "\r" || ch === "\n") {
        const line = this.line;
        this.line = "";
        this.print("\r\n");
        if (line.trim() === "exit") return this.exit(0);
        if (line.trim()) this.print(`${this.opts.program}: ${line}\r\n`);
        this.print(PROMPT);
      } else if (ch === "\x7f" || ch === "\b") {
        if (this.line) {
          this.line = [...this.line].slice(0, -1).join("");
          this.print("\b \b");
        }
      } else if (ch === "\x03") {
        this.line = "";
        this.print(`^C\r\n${PROMPT}`);
      } else if (ch === "\x04") {
        if (!this.line) return this.exit(0);
      } else if (ch >= " ") {
        this.line += ch;
        this.print(ch);
      }
    }
  }

  /** The process ends (`null`: killed, as on close). */
  exit(code: number | null): void {
    if (this.exited) return;
    this.exited = true;
    this.running = false;
    this.exitListeners.forEach((l) => l(code));
  }

  private print(text: string): void {
    this.scrollback += text;
    if (this.scrollback.length > SCROLLBACK_BYTES) this.scrollback = this.scrollback.slice(-SCROLLBACK_BYTES);
    this.listeners.forEach((l) => l(text));
  }
}
