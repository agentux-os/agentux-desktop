import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest("[hidden]"));
}

/** Keeps Tab and Shift+Tab inside `ref` while `active`. */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    const root = ref.current;
    if (!root || !active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables(root);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || !root.contains(at))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (at === last || !root.contains(at))) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener("keydown", onKey);
    return () => root.removeEventListener("keydown", onKey);
  }, [ref, active]);
}

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function boxOf(el: HTMLElement | null): Box | null {
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function same(a: Box | null, b: Box | null): boolean {
  return (
    a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height)
  );
}

/** The element's box in the viewport, kept current through scrolling, resizing and layout changes. */
export function useBox(el: HTMLElement | null): Box | null {
  const [box, setBox] = useState<Box | null>(() => boxOf(el));
  useLayoutEffect(() => {
    setBox(boxOf(el));
    if (!el) return;
    let frame = 0;
    let last = boxOf(el);
    const tick = () => {
      const next = boxOf(el);
      if (!same(next, last)) {
        last = next;
        setBox(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [el]);
  return box;
}

/** Where a floating card of `size` goes next to `anchor`, inside the window. */
export function placeNear(
  anchor: Box | null,
  size: { width: number; height: number },
  gap = 12,
): { top: number; left: number; side: string } {
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;
  const m = 12;
  const clampX = (x: number) => Math.max(m, Math.min(vw - size.width - m, x));
  const clampY = (y: number) => Math.max(m, Math.min(vh - size.height - m, y));
  if (!anchor) return { top: clampY((vh - size.height) / 2), left: clampX((vw - size.width) / 2), side: "center" };
  const below = vh - (anchor.top + anchor.height);
  const above = anchor.top;
  const right = vw - (anchor.left + anchor.width);
  const left = anchor.left;
  const cx = anchor.left + anchor.width / 2 - size.width / 2;
  const cy = anchor.top + anchor.height / 2 - size.height / 2;
  if (below >= size.height + gap + m) return { top: anchor.top + anchor.height + gap, left: clampX(cx), side: "below" };
  if (right >= size.width + gap + m) return { top: clampY(cy), left: anchor.left + anchor.width + gap, side: "right" };
  if (above >= size.height + gap + m) return { top: anchor.top - size.height - gap, left: clampX(cx), side: "above" };
  if (left >= size.width + gap + m) return { top: clampY(cy), left: anchor.left - size.width - gap, side: "left" };
  // Bigger than every side (a large target): over its lower part.
  return { top: clampY(anchor.top + anchor.height - size.height - gap), left: clampX(cx), side: "inside" };
}

/** Opens a link in the user's browser: through agentux-setup in the app, a new tab elsewhere. */
export async function openExternal(url: string): Promise<void> {
  const { isTauri } = await import("../daemon/tauri/TauriDaemonClient");
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("setup_exec", { args: ["open-url", url], stdin: null });
    return;
  }
  window.open(url, "_blank", "noopener");
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Scrolls the element's nearest scrolling container (a column, the rail, a
 * panel) so the element's top is in view, without moving the window itself,
 * which the cockpit's layout keeps fixed.
 */
export function revealInScroller(el: HTMLElement): void {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (!/(auto|scroll)/.test(s.overflowY) || p.scrollHeight <= p.clientHeight) continue;
    const pr = p.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    if (er.top < pr.top || er.top > pr.bottom - 40) p.scrollTop += er.top - pr.top - 8;
    break;
  }
  const root = document.scrollingElement;
  if (root && root.scrollTop) root.scrollTop = 0;
}

/** The part of `box` inside the window (a target taller than the window is cut to it). */
export function clampBox(box: Box | null): Box | null {
  if (!box) return null;
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;
  const top = Math.max(0, box.top);
  const left = Math.max(0, box.left);
  const bottom = Math.min(vh, box.top + box.height);
  const right = Math.min(vw, box.left + box.width);
  if (bottom <= top || right <= left) return box;
  return { top, left, width: right - left, height: bottom - top };
}
