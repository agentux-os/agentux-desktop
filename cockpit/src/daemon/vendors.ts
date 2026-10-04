import type { Vendor } from "./types";

export interface VendorInfo {
  id: Vendor;
  /** Name of the harness CLI. */
  label: string;
  /** Two-letter monogram used in compact badges. */
  mono: string;
  maker: string;
  /** CSS custom property holding the vendor accent colour. */
  colorVar: string;
  defaultModel: string;
  /**
   * Illustrative USD prices per million tokens, used by the mock only. The real
   * daemon reports cost as computed from each harness's own usage data.
   */
  price: { input: number; output: number };
  /** Illustrative context window in tokens, used by the mock only. */
  contextWindow: number;
}

export const VENDOR_INFO: Record<Vendor, VendorInfo> = {
  "claude-code": {
    id: "claude-code",
    label: "Claude Code",
    mono: "CC",
    maker: "Anthropic",
    colorVar: "--vendor-claude",
    defaultModel: "claude-sonnet",
    price: { input: 3, output: 15 },
    contextWindow: 200_000,
  },
  codex: {
    id: "codex",
    label: "Codex",
    mono: "CX",
    maker: "OpenAI",
    colorVar: "--vendor-codex",
    defaultModel: "gpt-codex",
    price: { input: 1.25, output: 10 },
    contextWindow: 272_000,
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    mono: "OC",
    maker: "sst",
    colorVar: "--vendor-opencode",
    defaultModel: "kimi-k2",
    price: { input: 0.6, output: 2.5 },
    contextWindow: 256_000,
  },
  antigravity: {
    id: "antigravity",
    label: "Antigravity",
    mono: "AG",
    maker: "Google",
    colorVar: "--vendor-antigravity",
    defaultModel: "gemini-pro",
    price: { input: 1.25, output: 10 },
    contextWindow: 272_000,
  },
};

export function costOf(vendor: Vendor, input: number, output: number): number {
  const p = VENDOR_INFO[vendor].price;
  return (input * p.input + output * p.output) / 1_000_000;
}

/** What the UI shows for a harness: the vendor's identity, or a neutral one for unknown harnesses. */
export function harnessInfo(vendor: Vendor | undefined, harness?: string): Pick<VendorInfo, "label" | "mono" | "maker" | "colorVar"> {
  if (vendor) return VENDOR_INFO[vendor];
  const label = harness?.trim() || "Agent";
  return { label, mono: label.slice(0, 2).toUpperCase(), maker: "unknown harness", colorVar: "--text-muted" };
}
