/** Opens the welcome wizard: its own window in the app, a new tab in a browser. */
export async function openWelcome(): Promise<void> {
  const { isTauri } = await import("../daemon/tauri/TauriDaemonClient");
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("welcome_open");
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set("view", "welcome");
  window.open(url.toString(), "_blank", "noopener");
}
