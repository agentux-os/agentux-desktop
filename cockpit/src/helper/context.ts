import { createContext, useContext } from "react";
import type { HelperReply } from "../daemon/client";
import type { Mood } from "./Penguin";
import type { HelperSettings } from "./settings";
import type { TourStep } from "./Tour";

/** What the window hosting the helper offers it. */
export interface HelperHost {
  surface: "cockpit" | "welcome";
  /** The tour's steps (the cockpit has one; the wizard has none). */
  tour?: TourStep[];
  /** Opens a run so a tour step can point into its panel; returns how to undo it. */
  openSomeRun?: () => (() => void) | void;
  /** One or two lines on what the user is looking at, for AI answers. */
  describeView?: () => string;
  /** AI answers: whether they can work here, and how to ask. */
  ai?: {
    /** Why AI answers cannot work right now (mock data, an older agentuxd); absent when they can. */
    unavailable?: string;
    ask(input: { harness: string; question: string; context: string }): Promise<HelperReply>;
    /** Which agent CLIs are signed in, when the system can tell. */
    agents?: () => Promise<{ harness: string; installed: boolean; signedIn: boolean | null }[]>;
  };
}

export interface HelperContextValue {
  host: HelperHost;
  settings: HelperSettings;
  update: (patch: Partial<HelperSettings>) => void;
  whatsThis: boolean;
  setWhatsThis: (on: boolean) => void;
  askOpen: boolean;
  setAskOpen: (open: boolean) => void;
  touring: boolean;
  startTour: () => void;
  /** Points at the element marked `key` (Ask's Show me). */
  showMe: (key: string, returnFocus?: HTMLElement | null) => void;
  mood: Mood;
  setThinking: (on: boolean) => void;
  /** A message for screen readers. */
  announce: (text: string) => void;
}

export const HelperContext = createContext<HelperContextValue | null>(null);

export function useHelper(): HelperContextValue {
  const v = useContext(HelperContext);
  if (!v) throw new Error("useHelper must be used inside <HelperProvider>");
  return v;
}

/** Like `useHelper`, but null outside a provider (components shared with tests). */
export function useOptionalHelper(): HelperContextValue | null {
  return useContext(HelperContext);
}
