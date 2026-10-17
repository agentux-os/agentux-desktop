import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../components/Icon";
import { help } from "./content";
import { useHelper } from "./context";
import { Penguin } from "./Penguin";
import { takeTourRequest, TOUR_REQUEST_KEY, WELCOME_OPEN_KEY, welcomeOpen } from "./settings";
import { focusables, useBox } from "./util";

/**
 * The penguin in its corner (the sidebar's foot in the cockpit, the rail's
 * foot in the wizard): its menu, and the one offer it makes on its own, the
 * first-run tour.
 */
export function Mascot({ compact = false }: { compact?: boolean }) {
  const h = useHelper();
  const [menu, setMenu] = useState(false);
  const [offer, setOffer] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const box = useBox(menu || offer ? dock : null);
  const id = useId();
  const cockpit = h.host.surface === "cockpit" && !!h.host.tour?.length;
  const { enabled, tour } = h.settings;
  const { startTour } = h;

  // The first-run tour: started on request from the Welcome window, else
  // offered once the wizard is not open (or was skipped), until answered.
  useEffect(() => {
    if (!cockpit || !enabled) return;
    const check = () => {
      if (takeTourRequest()) {
        setOffer(false);
        startTour();
        return;
      }
      setOffer(tour === "new" && !welcomeOpen());
    };
    check();
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === TOUR_REQUEST_KEY || e.key === WELCOME_OPEN_KEY) check();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", check);
    const timer = window.setInterval(check, 30_000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", check);
      window.clearInterval(timer);
    };
  }, [cockpit, enabled, tour, startTour]);

  useEffect(() => {
    if (h.touring) setOffer(false);
  }, [h.touring]);

  // Focus the first item once the menu is placed (it is hidden until then).
  const placed = !!box;
  useEffect(() => {
    if (menu && placed && menuRef.current) focusables(menuRef.current)[0]?.focus();
  }, [menu, placed]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node))
        setMenu(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [menu]);

  if (!enabled) return null;

  const close = () => {
    setMenu(false);
    buttonRef.current?.focus();
  };
  const onMenuKey = (e: KeyboardEvent) => {
    const items = focusables(menuRef.current!);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const d = e.key === "ArrowDown" ? 1 : -1;
      items[(i + d + items.length) % items.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (e.key.length === 1 && e.key !== " ") {
      e.stopPropagation();
    }
  };
  // The menu and the bubble float next to the corner, outside the sidebar's scroll box.
  const floating = box
    ? {
        left: Math.min(box.left + box.width + 12, window.innerWidth - 300),
        bottom: Math.max(8, window.innerHeight - (box.top + box.height)),
      }
    : { visibility: "hidden" as const };
  const pick = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };

  return (
    <div ref={setDock} className={`mascot ${compact ? "is-compact" : ""}`} data-helper-ui>
      <button
        ref={buttonRef}
        className="mascot-btn"
        {...help("helper.penguin")}
        aria-label="AgentUX helper"
        aria-haspopup="menu"
        aria-expanded={menu}
        aria-controls={menu ? `${id}-menu` : undefined}
        title="AgentUX helper (F1 to ask, Shift+F1 for What's this?)"
        onClick={() => {
          setOffer(false);
          setMenu((m) => !m);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && menu) {
            e.preventDefault();
            e.stopPropagation();
            setMenu(false);
          }
        }}
      >
        <Penguin mood={offer ? "talking" : h.mood} size={compact ? 34 : 38} />
        {!compact && <span className="mascot-label">Help</span>}
      </button>
      <button
        className={`mascot-wt ${h.whatsThis ? "is-on" : ""}`}
        {...help("helper.whatsThis")}
        aria-pressed={h.whatsThis}
        aria-label="What's this?"
        title="What's this? (Shift+F1)"
        onClick={() => h.setWhatsThis(!h.whatsThis)}
      >
        <Icon name="question" size={15} />
      </button>

      {menu && (
        <div
          ref={menuRef}
          id={`${id}-menu`}
          className="mascot-menu"
          style={floating}
          role="menu"
          aria-label="Helper"
          onKeyDown={onMenuKey}
        >
          {cockpit && (
            <button role="menuitem" onClick={pick(startTour)}>
              <Icon name="arrowRight" size={14} /> Take the tour
            </button>
          )}
          <button role="menuitemcheckbox" aria-checked={h.whatsThis} onClick={pick(() => h.setWhatsThis(!h.whatsThis))}>
            <Icon name="question" size={14} /> What's this? <kbd>Shift F1</kbd>
          </button>
          <button role="menuitem" onClick={pick(() => h.setAskOpen(true))}>
            <Icon name="search" size={14} /> Ask the penguin <kbd>F1</kbd>
          </button>
          <hr />
          <button
            role="menuitem"
            onClick={pick(() => {
              h.update({ enabled: false });
              h.announce(
                cockpit
                  ? "The helper is off. Turn it back on with Penguin helper in the sidebar."
                  : "The helper is off. Turn it back on in the cockpit's sidebar.",
              );
            })}
          >
            <Icon name="x" size={14} /> Turn the helper off
          </button>
        </div>
      )}

      {offer && !menu && (
        <div className="mascot-bubble" style={floating} role="dialog" aria-labelledby={`${id}-offer`}>
          <p id={`${id}-offer`}>
            <strong>Hi, I'm the AgentUX penguin.</strong> New here? I can show you around the cockpit in about a minute.
          </p>
          <div className="mascot-bubble-actions">
            <button
              className="btn btn-quiet"
              onClick={() => {
                setOffer(false);
                h.update({ tour: "skipped" });
                h.announce("No tour. It is in my menu whenever you want it.");
              }}
            >
              Not now
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setOffer(false);
                startTour();
              }}
            >
              Show me around
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
