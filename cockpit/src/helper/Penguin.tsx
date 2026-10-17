import { useId } from "react";
import { LOGO_BACK, LOGO_PARTS } from "../components/Icon";
import FULL_MARK from "./penguin-full.svg?raw";

export type Mood = "idle" | "talking" | "thinking" | "pointing";

/**
 * The swimming penguin of the AgentUX mark (the compact mark: no wake), drawn
 * in the theme's accent (Lime on dark, Moss on light). Its mood is a CSS
 * animation (`helper.css`); `prefers-reduced-motion` stills it.
 */
export function Penguin({ mood = "idle", size = 40 }: { mood?: Mood; size?: number }) {
  const clip = `pg-tail-${useId().replace(/:/g, "")}`;
  return (
    <svg className={`penguin is-${mood}`} width={size} height={size} viewBox="-6 6 72 52" aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <polygon points="56.62,-17.11 70.49,-17.11 70.49,86.25 -27.96,86.25" />
          <rect x="11.66" y="13.1" width="31.8" height="13.04" />
        </clipPath>
      </defs>
      <g className="pg-bubbles">
        <circle cx="54" cy="18" r="2.2" />
        <circle cx="59" cy="12" r="1.6" />
        <circle cx="50" cy="10" r="1.2" />
      </g>
      <g className="pg-body">
        <path clipPath={`url(#${clip})`} d={LOGO_BACK} />
        <path d={LOGO_PARTS[0]} />
        <path className="pg-flipper" d={LOGO_PARTS[1]} />
        <path className="pg-eye" d={LOGO_PARTS[2]} />
      </g>
    </svg>
  );
}

/** The full mark, penguin and wake, for the tour's welcome. Uses `currentColor`. */
const FULL = FULL_MARK.replace(/#c6f36b/gi, "currentColor")
  .replace(/id="mg"/g, 'id="pf-mg"')
  .replace(/id="mk"/g, 'id="pf-mk"')
  .replace(/url\(#mg\)/g, "url(#pf-mg)")
  .replace(/url\(#mk\)/g, "url(#pf-mk)")
  .replace(/id="ct"/g, 'id="pf-ct"')
  .replace(/url\(#ct\)/g, "url(#pf-ct)")
  .replace(/\swidth="[^"]*"\sheight="[^"]*"/, "")
  .replace(/<title>[^<]*<\/title>/, "");

export function PenguinFull({ width = 180 }: { width?: number }) {
  return (
    <span className="penguin-full" style={{ width }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: FULL }} />
  );
}
