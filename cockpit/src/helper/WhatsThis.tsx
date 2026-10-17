import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { renderInline } from "../lib/inline";
import { helpEntry } from "./content";
import { Penguin } from "./Penguin";
import { openExternal, placeNear, useBox, useFocusTrap } from "./util";

/** Inside the helper's own UI: never intercepted. */
function inHelperUi(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest("[data-helper-ui]");
}

function helpElement(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? (target.closest("[data-help]") as HTMLElement | null) : null;
}

/**
 * The explainable element under the pointer. Disabled controls get no mouse
 * events (and, in What's this? mode, no pointer events either), so the event
 * lands on their parent: look for a marked element under the point inside it.
 */
function helpAt(e: MouseEvent): HTMLElement | null {
  const top = e.target instanceof Element ? e.target : null;
  if (!top) return null;
  const inside = Array.from(top.querySelectorAll<HTMLElement>("[data-help]")).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  });
  if (inside.length) {
    const area = (el: HTMLElement) => el.getBoundingClientRect().width * el.getBoundingClientRect().height;
    return inside.reduce((a, b) => (area(b) < area(a) ? b : a));
  }
  return helpElement(top);
}

/** Events a click is made of, all swallowed outside the helper while the mode is on. */
const SWALLOW = ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick", "auxclick", "contextmenu"] as const;

/**
 * What's this? mode: pointing outlines explainable elements (`data-help`),
 * clicking (or Enter on a focused one) explains it in a popover, and nothing
 * else reacts to the click. Escape closes the popover, then leaves the mode.
 */
export function WhatsThis({ onExit, onExplaining }: { onExit: () => void; onExplaining: (on: boolean) => void }) {
  const [hover, setHover] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState<HTMLElement | null>(null);
  const hoverBox = useBox(hover);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => onExplaining(!!open), [open, onExplaining]);
  useEffect(() => () => onExplaining(false), [onExplaining]);

  useEffect(() => {
    document.body.classList.add("helper-wt");
    // Make every explainable element reachable with Tab while the mode is on.
    const added: HTMLElement[] = [];
    const tabbable = () => {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-help]"))) {
        if (el.tabIndex < 0 && !el.hasAttribute("tabindex") && !el.closest("[data-helper-ui]")) {
          el.setAttribute("tabindex", "0");
          el.dataset.helperTabindex = "";
          added.push(el);
        }
      }
    };
    tabbable();
    const observer = new MutationObserver(tabbable);
    observer.observe(document.body, { childList: true, subtree: true });

    const swallow = (e: Event) => {
      if (inHelperUi(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onClick = (e: MouseEvent) => {
      if (inHelperUi(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(helpAt(e));
    };
    const onMove = (e: PointerEvent) => {
      if (inHelperUi(e.target)) return;
      setHover(helpAt(e));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (openRef.current) {
          const el = openRef.current;
          setOpen(null);
          el.focus();
        } else onExit();
        return;
      }
      if (inHelperUi(e.target)) return;
      if (e.key === "Enter" || e.key === " ") {
        const el = helpElement(e.target);
        if (el) {
          e.preventDefault();
          e.stopImmediatePropagation();
          setOpen(el);
        }
        return;
      }
      // Tab and arrows move as usual; the cockpit's single-key shortcuts are off.
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) e.stopImmediatePropagation();
    };
    const onFocus = (e: FocusEvent) => {
      if (!inHelperUi(e.target)) setHover(helpElement(e.target));
    };

    for (const t of SWALLOW) document.addEventListener(t, swallow, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("focusin", onFocus, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      observer.disconnect();
      document.body.classList.remove("helper-wt");
      for (const el of added) {
        if ("helperTabindex" in el.dataset) {
          el.removeAttribute("tabindex");
          delete el.dataset.helperTabindex;
        }
      }
      for (const t of SWALLOW) document.removeEventListener(t, swallow, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("focusin", onFocus, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onExit]);

  return (
    <>
      {hoverBox && hover !== open && (
        <div
          className="wt-hover"
          data-helper-ui
          aria-hidden="true"
          style={{
            top: hoverBox.top - 3,
            left: hoverBox.left - 3,
            width: hoverBox.width + 6,
            height: hoverBox.height + 6,
          }}
        />
      )}
      <div className="wt-badge" data-helper-ui role="status">
        <Icon name="question" size={14} /> What's this? Click anything to learn about it.
        <button className="link-btn" onClick={onExit}>
          Done <kbd>Esc</kbd>
        </button>
      </div>
      {open && (
        <Explain
          key={open.dataset.help}
          anchor={open}
          onClose={() => {
            setOpen(null);
            open.focus();
          }}
        />
      )}
    </>
  );
}

/** The penguin's explanation of one element, next to it. */
export function Explain({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const key = anchor.dataset.help ?? "";
  const entry = helpEntry(key);
  const box = useBox(anchor);
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState({ width: 360, height: 220 });
  const id = useId();
  useFocusTrap(ref);
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r && r.width && r.height && (Math.abs(r.width - size.width) > 1 || Math.abs(r.height - size.height) > 1)) {
      setSize({ width: r.width, height: r.height });
    }
  });
  useEffect(() => closeRef.current?.focus(), []);
  const at = placeNear(box, size);
  return (
    <div
      ref={ref}
      className="explain"
      role="dialog"
      aria-labelledby={`${id}-t`}
      aria-describedby={`${id}-w`}
      style={{ top: at.top, left: at.left }}
      data-helper-ui
    >
      <div className="explain-head">
        <Penguin mood="talking" size={30} />
        <h2 id={`${id}-t`}>{entry?.title ?? "Nothing to explain"}</h2>
        <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="x" size={14} />
        </button>
      </div>
      {entry ? (
        <div className="explain-body">
          <p id={`${id}-w`}>{renderInline(entry.what)}</p>
          {entry.how && (
            <>
              <h3>How it works</h3>
              <p>{renderInline(entry.how)}</p>
            </>
          )}
          {entry.do?.length ? (
            <>
              <h3>What you can do</h3>
              <ul>
                {entry.do.map((d) => (
                  <li key={d}>{renderInline(d)}</li>
                ))}
              </ul>
            </>
          ) : null}
          {entry.docs && (
            <button className="explain-more link-btn" onClick={() => void openExternal(entry.docs!.url)}>
              <Icon name="file" size={13} /> Learn more: {entry.docs.label}
            </button>
          )}
        </div>
      ) : (
        <p id={`${id}-w`}>I have no notes on this one yet.</p>
      )}
    </div>
  );
}
