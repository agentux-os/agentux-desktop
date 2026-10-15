import { useCallback, useEffect, useState } from "react";
import { itemById } from "../setup/catalog";
import type { SetupClient, SetupStatus } from "../setup/client";

const POLL_MS = 1500;

export interface SetupStatusState {
  status: SetupStatus | null;
  /** Catalog items installed: found by the last scan, plus items done since. */
  installed: Set<string>;
  error: string | null;
  refresh: (scan?: boolean) => Promise<void>;
}

/**
 * Polls `status` while the wizard is open, and scans for installed items
 * once at the start; items whose install finishes count as installed.
 */
export function useSetupStatus(client: SetupClient, pollMs = POLL_MS): SetupStatusState {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (scan = false) => {
      try {
        const s = await client.status(scan);
        setStatus(s);
        setError(null);
        const done = Object.values(s.items).filter((i) => i.state === "done");
        setInstalled((prev) => {
          const next = new Set(scan && s.installed ? s.installed : prev);
          for (const item of done) {
            next.add(item.id);
            // Any JetBrains IDE item installs Toolbox itself.
            if (itemById(item.id)?.method === "jetbrains-toolbox") next.add("jetbrains-toolbox");
          }
          return next.size === prev.size && [...next].every((id) => prev.has(id)) ? prev : next;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [client],
  );

  useEffect(() => {
    let cancelled = false;
    void refresh(true);
    const timer = setInterval(() => {
      if (!cancelled) void refresh(false);
    }, pollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refresh, pollMs]);

  return { status, installed, error, refresh };
}
