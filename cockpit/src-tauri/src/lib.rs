//! AgentUX cockpit shell. The window hosts the React UI; the `daemon` module
//! connects it to `agentuxd` over its Unix socket (commands plus a forwarded
//! event stream). Without a reachable daemon the UI runs on mock data.

pub mod daemon;

#[cfg(desktop)]
use tauri::Manager;

/// Label of the single window declared in `tauri.conf.json`.
#[cfg(desktop)]
const MAIN_WINDOW: &str = "main";

/// Brings the existing cockpit window forward: restore it if minimized, map it
/// if hidden, then ask the compositor for focus. Each step is best effort; on
/// Wayland the compositor decides whether the focus request is honoured.
#[cfg(desktop)]
fn reveal_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Must be the first plugin: a second `agentux-cockpit` process (Meta+A,
    // autostart, the launcher) hands over to the running one in this plugin's
    // setup and exits before anything else is initialised.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        reveal_main_window(app);
    }));

    builder
        .setup(|app| {
            daemon::init(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            daemon::daemon_probe,
            daemon::daemon_status,
            daemon::daemon_snapshot,
            daemon::daemon_run_history,
            daemon::daemon_list_projects,
            daemon::daemon_list_runs,
            daemon::daemon_start_run,
            daemon::daemon_approve,
            daemon::daemon_deny,
            daemon::daemon_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the AgentUX cockpit");
}
