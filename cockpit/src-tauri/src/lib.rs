//! AgentUX cockpit shell. The window hosts the React UI; the `daemon` module
//! connects it to `agentuxd` over its Unix socket (commands plus a forwarded
//! event stream). Without a reachable daemon the UI runs on mock data.

pub mod daemon;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            daemon::init(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            daemon::daemon_probe,
            daemon::daemon_status,
            daemon::daemon_snapshot,
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
