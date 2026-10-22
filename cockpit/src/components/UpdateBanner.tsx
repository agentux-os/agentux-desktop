import { useEffect, useState } from "react";
import type { SetupClient, UpdateImage, UpdateStatus } from "../setup/client";
import { Icon } from "./Icon";

/** How often the staged-update status is read again. */
const POLL_MS = 10 * 60 * 1000;
/** The staged image this user was already told about (one notification each). */
const NOTIFIED_KEY = "agentux.update.notified";
/** The image this user last ran, to say once what changed after a restart. */
const BOOTED_KEY = "agentux.update.booted";

const RELEASES = "https://github.com/agentux-os/agentux-os/releases";

function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Without storage the notice may repeat; nothing else depends on it.
  }
}

/** "AgentUX v0.6.6", or the image version when the release is not known. */
export function imageName(image: UpdateImage): string {
  return image.release ? `AgentUX ${image.release}` : `AgentUX ${image.version ?? "update"}`;
}

/** The release notes of `image`, or every release when its name is not known. */
export function notesUrl(image: UpdateImage): string {
  return image.release ? `${RELEASES}/tag/${encodeURIComponent(image.release)}` : RELEASES;
}

/**
 * What agentux-os's background updates (stage-update) have to say: an image
 * staged for the next boot, with Restart; or, once after a restart into a
 * new image, what this machine now runs.
 */
export function UpdateBanner({ setup }: { setup: () => Promise<SetupClient> }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [justUpdated, setJustUpdated] = useState<UpdateImage | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const read = async () => {
      try {
        const client = await setup();
        const next = await client.updateStatus();
        if (!alive || !next) return;
        setStatus(next);
        const booted = next.booted?.digest;
        if (booted) {
          const before = remembered(BOOTED_KEY);
          if (before && before !== booted && next.booted) setJustUpdated(next.booted);
          remember(BOOTED_KEY, booted);
        }
        const staged = next.staged;
        if (staged?.digest && remembered(NOTIFIED_KEY) !== staged.digest) {
          remember(NOTIFIED_KEY, staged.digest);
          await client
            .notify(`${imageName(staged)} is ready`, "Restart when it suits you to use it; your work is not interrupted.")
            .catch(() => undefined);
        }
      } catch {
        // No status (an older image, or no agentux-os): nothing to show.
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [setup]);

  const restart = async () => {
    setRestarting(true);
    setError(null);
    try {
      await (await setup()).restart();
    } catch (e) {
      setRestarting(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const staged = status?.staged;
  if (staged) {
    return (
      <div className="banner banner-info" role="status">
        <Icon name="check" size={14} />
        <div className="banner-text">
          <strong>{imageName(staged)} is ready.</strong> Restart to use it; until then nothing changes.{" "}
          <a href={notesUrl(staged)} target="_blank" rel="noreferrer">
            What's new
          </a>
          {error && <span className="err"> · {error}</span>}
        </div>
        <button className="btn btn-primary" onClick={() => void restart()} disabled={restarting}>
          {restarting ? "Restarting…" : "Restart"}
        </button>
      </div>
    );
  }
  if (justUpdated) {
    return (
      <div className="banner banner-info" role="status">
        <Icon name="check" size={14} />
        <div className="banner-text">
          <strong>This machine now runs {imageName(justUpdated)}.</strong>{" "}
          <a href={notesUrl(justUpdated)} target="_blank" rel="noreferrer">
            What's new
          </a>
        </div>
        <button className="btn btn-quiet" onClick={() => setJustUpdated(null)}>
          Dismiss
        </button>
      </div>
    );
  }
  return null;
}
