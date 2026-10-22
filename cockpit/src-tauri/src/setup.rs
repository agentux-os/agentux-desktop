//! The "Welcome to AgentUX" wizard: its window and its one backend command.
//!
//! The wizard is a second window (`welcome`) on the same frontend
//! (`index.html?view=welcome`). All of its work is done by
//! `/usr/libexec/agentux-setup` (shipped by the common desktop bundle), which this
//! module runs with an allowlisted subcommand: installs run in transient
//! systemd user units started by that script, so they keep going when the
//! window closes, and the script can be tested without a window.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

/// Label of the wizard window.
pub const WELCOME_WINDOW: &str = "welcome";
/// Command line flag that opens the wizard (`agentux-cockpit --welcome`).
pub const WELCOME_FLAG: &str = "--welcome";

/// Subcommands of `agentux-setup` the UI may run. The internal steps
/// (`vscode-settings`, `jetbrains-toolbox`, ...) and `autostart` are not
/// among them.
const ALLOWED: &[&str] = &[
    "plan",
    "start",
    "status",
    "profile",
    "retry-first-login",
    "signin",
    "update-agent",
    "launch",
    "open-url",
    "clone",
    "key",
    "node",
    "git",
    "ssh-key",
    "finish",
    "reset",
];

/// `$AGENTUX_SETUP` (for development), else the installed script.
fn setup_script() -> PathBuf {
    std::env::var_os("AGENTUX_SETUP")
        .filter(|p| !p.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/usr/libexec/agentux-setup"))
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct SetupOutput {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// Checks the arguments the UI passes: a known subcommand first, and no NUL
/// bytes (which a process argument cannot carry).
pub fn check_args(args: &[String]) -> Result<(), String> {
    let Some(sub) = args.first() else {
        return Err("agentux-setup: no subcommand".into());
    };
    if !ALLOWED.contains(&sub.as_str()) {
        return Err(format!("agentux-setup: subcommand not allowed from the UI: {sub}"));
    }
    if args.iter().any(|a| a.contains('\0')) {
        return Err("agentux-setup: NUL byte in an argument".into());
    }
    Ok(())
}

fn run_setup(script: PathBuf, args: Vec<String>, stdin: Option<String>) -> Result<SetupOutput, String> {
    let mut child = Command::new(&script)
        .args(&args)
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("cannot run {}: {e}", script.display()))?;
    if let (Some(input), Some(mut pipe)) = (stdin, child.stdin.take()) {
        // A short write (the script did not read) is not an error worth reporting.
        let _ = pipe.write_all(input.as_bytes());
        let _ = pipe.write_all(b"\n");
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    Ok(SetupOutput {
        code: out.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    })
}

/// Runs `agentux-setup ARGS...` (an allowlisted subcommand) and returns its
/// exit code and output. `stdin`, if given, is written to it as one line
/// (the SSH key passphrase).
#[tauri::command]
pub async fn setup_exec(args: Vec<String>, stdin: Option<String>) -> Result<SetupOutput, String> {
    check_args(&args)?;
    let script = setup_script();
    tauri::async_runtime::spawn_blocking(move || run_setup(script, args, stdin))
        .await
        .map_err(|e| e.to_string())?
}

/// Opens the wizard window, or brings it forward if it is open. It is a child
/// of the main window where there is one, so it stays above the cockpit.
pub fn open_welcome<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(WELCOME_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    let mut builder = WebviewWindowBuilder::new(app, WELCOME_WINDOW, WebviewUrl::App("index.html?view=welcome".into()))
        .title("Welcome to AgentUX")
        .inner_size(1120.0, 780.0)
        .min_inner_size(860.0, 600.0)
        .center();
    // Above the cockpit when it shows; on its own while the cockpit waits
    // for the wizard.
    if let Some(main) = app.get_webview_window(crate::MAIN_WINDOW) {
        if main.is_visible().unwrap_or(false) {
            builder = builder.parent(&main)?;
        }
    }
    builder.build()?;
    Ok(())
}

/// Whether this user still has to go through the wizard: `agentux-setup
/// should-run` says yes (a user account, not the live session, no
/// `welcome.done`). Until it is finished the cockpit shows only the wizard.
/// Without the script (development), never.
pub fn welcome_pending() -> bool {
    run_setup(setup_script(), vec!["should-run".into()], None).is_ok_and(|out| out.code == 0)
}

/// Opens the wizard from the UI (the cockpit's menu).
#[tauri::command]
pub async fn welcome_open<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    open_welcome(&app).map_err(|e| e.to_string())
}

/// Closes the wizard; with `open_cockpit`, brings the cockpit forward.
#[tauri::command]
pub async fn welcome_close<R: Runtime>(app: AppHandle<R>, open_cockpit: bool) -> Result<(), String> {
    if open_cockpit {
        crate::reveal_main_window(&app);
    }
    if let Some(window) = app.get_webview_window(WELCOME_WINDOW) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Whether a command line asks for the wizard.
pub fn wants_welcome<S: AsRef<str>>(argv: &[S]) -> bool {
    argv.iter().skip(1).any(|a| a.as_ref() == WELCOME_FLAG)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn allows_only_listed_subcommands() {
        assert!(check_args(&args(&["status", "--scan"])).is_ok());
        assert!(check_args(&args(&["profile", "workstation"])).is_ok());
        assert!(check_args(&args(&["start", "vscode", "java@temurin-21"])).is_ok());
        assert!(check_args(&args(&["autostart"])).is_err());
        assert!(check_args(&args(&["jetbrains-toolbox"])).is_err());
        assert!(check_args(&args(&[])).is_err());
        assert!(check_args(&args(&["git", "a\0b", "x@y", "main"])).is_err());
    }

    #[test]
    fn welcome_flag_is_found_after_the_program_name() {
        assert!(wants_welcome(&["agentux-cockpit", "--welcome"]));
        assert!(!wants_welcome(&["agentux-cockpit"]));
        assert!(!wants_welcome(&["--welcome"]));
    }

    #[cfg(unix)]
    #[test]
    fn runs_the_script_with_stdin() {
        let dir = std::env::temp_dir().join(format!("agentux-setup-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("agentux-setup");
        std::fs::write(&script, "#!/bin/sh\nread -r line\necho \"$1:$line\"\necho err >&2\nexit 3\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        let out = run_setup(script, args(&["ssh-key"]), Some("secret".into())).unwrap();
        assert_eq!(out, SetupOutput { code: 3, stdout: "ssh-key:secret\n".into(), stderr: "err\n".into() });
        std::fs::remove_dir_all(dir).unwrap();
    }
}
