//! AgentUX Office for the desktop: a window on the Office of an AgentUX
//! Command server (`<server>/office/`). Office's own page (`ui/`) asks which
//! server; the server's pages get no access to the app (no capability names
//! a remote origin).

pub mod server;

use serde::Serialize;
use std::path::PathBuf;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

const MAIN_WINDOW: &str = "main";
/// The machine's default server, written when it is provisioned.
const SYSTEM_CONF: &str = "/etc/agentux/office.conf";
/// Overrides every other choice (for testing and kiosks).
const SERVER_ENV: &str = "AGENTUX_OFFICE_SERVER";

/// Office's setup page, served from the app.
fn setup_url() -> Url {
    #[cfg(any(windows, target_os = "android"))]
    let origin = "http://tauri.localhost/";
    #[cfg(not(any(windows, target_os = "android")))]
    let origin = "tauri://localhost/";
    Url::parse(origin)
        .and_then(|u| u.join("index.html"))
        .expect("a valid URL")
}

fn user_conf(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("office.json"))
}

/// The server Office opens, and where that choice comes from.
fn configured(app: &AppHandle) -> Option<(Url, &'static str)> {
    if let Ok(value) = std::env::var(SERVER_ENV) {
        if let Ok(url) = server::normalize(&value) {
            return Some((url, "environment"));
        }
    }
    let saved = user_conf(app)
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice::<server::Saved>(&bytes).ok())
        .and_then(|saved| server::normalize(&saved.server).ok());
    if let Some(url) = saved {
        return Some((url, "user"));
    }
    std::fs::read_to_string(SYSTEM_CONF)
        .ok()
        .and_then(|text| server::parse_conf(&text))
        .and_then(|value| server::normalize(&value).ok())
        .map(|url| (url, "system"))
}

#[derive(Serialize)]
struct Current {
    server: Option<String>,
    source: Option<&'static str>,
}

/// The server Office is set to, for the setup page.
#[tauri::command]
fn office_current(app: AppHandle) -> Current {
    match configured(&app) {
        Some((url, source)) => Current {
            server: Some(url.to_string()),
            source: Some(source),
        },
        None => Current {
            server: None,
            source: None,
        },
    }
}

/// Checks that `address` is a Command server, keeps it, and opens its Office.
/// Answers the server's instance id.
#[tauri::command]
async fn office_connect(app: AppHandle, address: String) -> Result<String, String> {
    let url = server::normalize(&address)?;
    let checked = url.clone();
    let instance = tauri::async_runtime::spawn_blocking(move || server::fetch_instance(&checked))
        .await
        .map_err(|e| e.to_string())??;
    let path = user_conf(&app).ok_or("Office has no config directory")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Cannot keep the server: {e}"))?;
    }
    let saved = serde_json::to_vec_pretty(&server::Saved {
        server: url.to_string(),
    })
    .map_err(|e| e.to_string())?;
    std::fs::write(&path, saved).map_err(|e| format!("Cannot keep the server: {e}"))?;
    open_office(&app, &url)?;
    Ok(instance)
}

/// Goes back to the server Office is set to (leaving the setup page).
#[tauri::command]
fn office_open(app: AppHandle) -> Result<(), String> {
    let (url, _) = configured(&app).ok_or("No server is set yet.")?;
    open_office(&app, &url)
}

fn open_office(app: &AppHandle, server: &Url) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW)
        .ok_or("Office's window is gone")?;
    window
        .navigate(server::office_url(server))
        .map_err(|e| e.to_string())
}

fn reveal(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let change = MenuItem::with_id(app, "change-server", "Change server…", true, None::<&str>)?;
    let reload = MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?;
    let office = Submenu::with_items(
        app,
        "Office",
        true,
        &[
            &change,
            &reload,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    Menu::with_items(app, &[&office])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // A second `agentux-office` brings the running window forward.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        reveal(app)
    }));

    builder
        .setup(|app| {
            let handle = app.handle().clone();
            let start = match configured(&handle) {
                Some((url, _)) => WebviewUrl::External(server::office_url(&url)),
                None => WebviewUrl::App("index.html".into()),
            };
            WebviewWindowBuilder::new(app, MAIN_WINDOW, start)
                .title("AgentUX Office")
                .inner_size(1280.0, 860.0)
                .min_inner_size(800.0, 560.0)
                .background_color(tauri::window::Color(11, 13, 16, 255))
                .menu(menu(&handle)?)
                .on_navigation(|url| {
                    let ok = server::may_navigate(url);
                    if !ok {
                        eprintln!("agentux-office: not opening {url}");
                    }
                    ok
                })
                .build()?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
                return;
            };
            match event.id().as_ref() {
                "change-server" => {
                    let _ = window.navigate(setup_url());
                }
                "reload" => {
                    let _ = window.eval("location.reload()");
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            office_current,
            office_connect,
            office_open
        ])
        .run(tauri::generate_context!())
        .expect("error while running AgentUX Office");
}
