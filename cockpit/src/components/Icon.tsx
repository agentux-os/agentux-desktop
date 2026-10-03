import type { SVGProps } from "react";

/** Small stroke icon set (24px grid, drawn at 16px by default). */
const PATHS = {
  board: "M3 4h5v16H3zM10 4h5v10h-5zM17 4h4v7h-4z",
  inbox: "M3 13l3-8h12l3 8v6H3zM3 13h5l1.5 2.5h5L16 13h5",
  bus: "M4 5h16v10H9l-5 4zM8 9h8M8 12h5",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6L6 18",
  terminal: "M4 5h16v14H4zM7.5 9.5l3 2.5-3 2.5M12.5 15h4",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L20 20",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  execute: "M5 5l7 7-7 7M13 19h6",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z",
  pr: "M6 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6 7.5v9M6 16.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM18 16.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM18 16.5V9a3 3 0 0 0-3-3h-4M13 3.5L10.5 6 13 8.5",
  plan: "M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1",
  shield: "M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6z",
  question: "M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z",
  keyboard: "M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  chevronDown: "M6 9l6 6 6-6",
  plus: "M12 5v14M5 12h14",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8v.01",
  branch: "M6 3v12M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9c0 4-6 3-12 6",
  folder: "M3 6h6l2 2h10v11H3z",
  send: "M4 12l16-8-6 16-2.5-6.5z",
  coins: "M9 10a6 3 0 1 0 0-.01M3 10v4c0 1.7 2.7 3 6 3s6-1.3 6-3v-4M15 7.2c3.3.1 6 1.4 6 2.8v4c0 1.7-2.7 3-6 3",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The AgentUX mark: four agents around one shared core. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--accent)" />
      <g stroke="var(--accent-ink)" strokeWidth="2.2" strokeLinecap="round">
        <path d="M9 9l7 7M23 9l-7 7M9 23l7-7M23 23l-7-7" />
      </g>
      <g fill="var(--accent-ink)">
        <circle cx="16" cy="16" r="3.6" />
        <circle cx="8.5" cy="8.5" r="2.4" />
        <circle cx="23.5" cy="8.5" r="2.4" />
        <circle cx="8.5" cy="23.5" r="2.4" />
        <circle cx="23.5" cy="23.5" r="2.4" />
      </g>
    </svg>
  );
}
