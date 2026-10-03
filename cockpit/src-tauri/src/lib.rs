//! AgentUX cockpit shell. The UI talks to `agentuxd` through the DaemonClient
//! interface in the frontend; until the daemon exists it runs on mock data, so
//! the Rust side only hosts the window.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the AgentUX cockpit");
}
