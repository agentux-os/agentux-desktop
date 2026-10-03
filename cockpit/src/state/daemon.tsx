import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import type { DaemonClient } from "../daemon/client";
import type { CockpitState } from "../daemon/types";

const DaemonContext = createContext<DaemonClient | null>(null);

export function DaemonProvider({ client, children }: { client: DaemonClient; children: ReactNode }) {
  useEffect(() => {
    void client.connect();
    return () => client.disconnect();
  }, [client]);
  return <DaemonContext.Provider value={client}>{children}</DaemonContext.Provider>;
}

export function useDaemon(): DaemonClient {
  const client = useContext(DaemonContext);
  if (!client) throw new Error("useDaemon must be used inside <DaemonProvider>");
  return client;
}

/** Current cockpit state; re-renders on every daemon update. */
export function useCockpit(): CockpitState {
  const client = useDaemon();
  return useSyncExternalStore(client.subscribe, client.getState);
}
