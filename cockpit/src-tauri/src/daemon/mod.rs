//! Bridge between the cockpit UI and `agentuxd`.
//!
//! - Commands (`daemon_*`) each open a short-lived connection to the daemon
//!   socket and return the raw JSON result; the frontend adapter maps it.
//! - A background task keeps one event subscription open and re-emits every
//!   event as the Tauri event `daemon://event`, and connection changes as
//!   `daemon://status`. It reconnects with backoff while the daemon is down and
//!   resumes from the last `seq` it forwarded.
//! - Terminals (`terminal_*`, see `terminal.rs`) each get their own
//!   connection, since the daemon ties a terminal to the connection that
//!   opened it; their output is emitted as `terminal://<stream>`.

pub mod client;
pub mod stream;
pub mod terminal;

use std::env;
use std::future::Future;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use client::{method, Client, ClientError, CommandError};
use stream::{Backoff, LinkState, Sink, Status};
use terminal::{TerminalEvent, Terminals};

pub const EVENT_CHANNEL: &str = "daemon://event";
pub const STATUS_CHANNEL: &str = "daemon://status";

/// How long a command may wait for the daemon before giving up.
const CALL_TIMEOUT: Duration = Duration::from_secs(15);
/// How long the startup probe waits; the UI shows mock data meanwhile.
const PROBE_TIMEOUT: Duration = Duration::from_millis(1500);

/// `$AGENTUX_SOCKET`, else `$XDG_RUNTIME_DIR/agentux/agentuxd.sock` (same
/// rule as `agentux_api::default_socket_path`).
pub fn socket_path() -> Option<PathBuf> {
    if let Some(path) = env::var_os("AGENTUX_SOCKET").filter(|p| !p.is_empty()) {
        return Some(PathBuf::from(path));
    }
    let runtime = env::var_os("XDG_RUNTIME_DIR").filter(|p| !p.is_empty())?;
    Some(PathBuf::from(runtime).join("agentux").join("agentuxd.sock"))
}

const NO_SOCKET: &str = "cannot locate the agentuxd socket: set XDG_RUNTIME_DIR or AGENTUX_SOCKET";

/// Shared state: the socket path and the last status the stream reported.
pub struct DaemonState {
    socket: Option<PathBuf>,
    status: Mutex<Status>,
}

impl DaemonState {
    fn new(socket: Option<PathBuf>) -> Self {
        let status = Status {
            state: if socket.is_some() {
                LinkState::Connecting
            } else {
                LinkState::Disconnected
            },
            socket: socket.as_ref().map(|p| p.display().to_string()),
            detail: if socket.is_some() {
                "starting".into()
            } else {
                NO_SOCKET.into()
            },
            last_seq: None,
            retry_in_ms: None,
        };
        Self {
            socket,
            status: Mutex::new(status),
        }
    }

    fn socket(&self) -> Result<&PathBuf, CommandError> {
        self.socket.as_ref().ok_or_else(|| CommandError {
            code: None,
            message: NO_SOCKET.into(),
            unavailable: true,
        })
    }
}

/// Registers the managed state and starts the event stream. Call from
/// `Builder::setup`.
pub fn init<R: Runtime>(app: &AppHandle<R>) {
    let socket = socket_path();
    app.manage(DaemonState::new(socket.clone()));
    app.manage(terminals(app, socket.clone()));
    let Some(socket) = socket else { return };
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut sink = TauriSink { app: handle };
        stream::follow(&socket, Backoff::default(), &mut sink, || false).await;
    });
}

/// The terminal registry, emitting each terminal's events to the UI.
fn terminals<R: Runtime>(app: &AppHandle<R>, socket: Option<PathBuf>) -> Terminals {
    let connect = match socket {
        #[cfg(unix)]
        Some(path) => terminal::unix_connector(path),
        #[cfg(not(unix))]
        Some(_) => terminal::unavailable_connector(
            "agentuxd is only reachable over a Unix socket on this platform".into(),
        ),
        None => terminal::unavailable_connector(NO_SOCKET.into()),
    };
    let handle = app.clone();
    let emit: terminal::Emit = std::sync::Arc::new(move |stream: &str, event: TerminalEvent| {
        let _ = handle.emit(&terminal::channel(stream), event);
    });
    Terminals::new(connect, emit)
}

/// Drops every terminal connection (the window closed or reloaded: nothing
/// shows those terminals any more, and the sessions they hold go back to ACP).
pub fn release_terminals<R: Runtime, M: Manager<R>>(manager: &M) {
    if let Some(terms) = manager.try_state::<Terminals>() {
        terms.close_all();
    }
}

struct TauriSink<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> Sink for TauriSink<R> {
    fn status(&mut self, status: &Status) {
        if let Some(state) = self.app.try_state::<DaemonState>() {
            if let Ok(mut current) = state.status.lock() {
                *current = status.clone();
            }
        }
        let _ = self.app.emit(STATUS_CHANNEL, status);
    }

    fn event(&mut self, event: Value) {
        let _ = self.app.emit(EVENT_CHANNEL, event);
    }
}

/// Waits for `work` (calls on a fresh connection to `socket`) up to `timeout`.
async fn timed<T>(
    timeout: Duration,
    work: impl Future<Output = Result<T, ClientError>>,
) -> Result<T, CommandError> {
    match tokio::time::timeout(timeout, work).await {
        Ok(result) => result.map_err(CommandError::from),
        Err(_) => Err(CommandError {
            code: None,
            message: format!(
                "agentuxd did not answer within {:.1}s",
                timeout.as_secs_f32()
            ),
            unavailable: false,
        }),
    }
}

/// One request on a fresh connection.
async fn call(state: &DaemonState, method: &str, params: Value) -> Result<Value, CommandError> {
    let socket = state.socket()?;
    timed(CALL_TIMEOUT, async {
        Client::connect(socket).await?.call(method, params).await
    })
    .await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    pub reachable: bool,
    pub socket: Option<String>,
    pub detail: String,
}

/// Whether the daemon answers right now. Used once at startup to choose
/// between the real client and mock data.
#[tauri::command]
pub async fn daemon_probe(state: State<'_, DaemonState>) -> Result<Probe, ()> {
    let socket = state.socket.as_ref().map(|p| p.display().to_string());
    let result = match state.socket() {
        Ok(path) => {
            timed(PROBE_TIMEOUT, async {
                Client::connect(path)
                    .await?
                    .call(method::PROJECTS_LIST, Value::Null)
                    .await
            })
            .await
        }
        Err(e) => Err(e),
    };
    Ok(match result {
        Ok(_) => Probe {
            reachable: true,
            detail: format!("agentuxd at {}", socket.as_deref().unwrap_or("?")),
            socket,
        },
        Err(e) => Probe {
            reachable: false,
            socket,
            detail: e.message,
        },
    })
}

/// The event stream's current connection state.
#[tauri::command]
pub fn daemon_status(state: State<'_, DaemonState>) -> Status {
    state
        .status
        .lock()
        .map(|s| s.clone())
        .unwrap_or_else(|e| e.into_inner().clone())
}

/// How long `daemon_run_history` waits for more replayed events, only on
/// daemons without `runs.events` and `replay_done` (before agentux-core #9).
const HISTORY_IDLE: Duration = Duration::from_millis(400);

/// Projects, runs, all requests and all sessions in one round trip, for the
/// initial load and after every reconnect. Daemons without `sessions.list`
/// (before agentux-core #6) give no sessions.
#[tauri::command]
pub async fn daemon_snapshot(state: State<'_, DaemonState>) -> Result<Value, CommandError> {
    let socket = state.socket()?;
    timed(CALL_TIMEOUT, async {
        let mut c = Client::connect(socket).await?;
        let projects = c.call(method::PROJECTS_LIST, Value::Null).await?;
        let runs = c.call(method::RUNS_LIST, json!({})).await?;
        let requests = c.call(method::REQUESTS_LIST, json!({ "pending": false })).await?;
        let sessions = match c.call(method::SESSIONS_LIST, json!({})).await {
            Err(ClientError::Rpc { code, .. }) if code == client::METHOD_NOT_FOUND => json!([]),
            other => other?,
        };
        Ok(json!({ "projects": projects, "runs": runs, "requests": requests, "sessions": sessions }))
    })
    .await
}

/// A run's stored events (`{ head, events, source }`, see
/// `stream::run_history`), for the session entries and bus traffic that
/// happened before the cockpit's event stream started.
#[tauri::command]
pub async fn daemon_run_history(
    state: State<'_, DaemonState>,
    run_id: String,
) -> Result<Value, CommandError> {
    let socket = state.socket()?;
    timed(
        CALL_TIMEOUT,
        stream::run_history(socket, &run_id, HISTORY_IDLE),
    )
    .await
}

#[tauri::command]
pub async fn daemon_list_projects(state: State<'_, DaemonState>) -> Result<Value, CommandError> {
    call(&state, method::PROJECTS_LIST, Value::Null).await
}

#[tauri::command]
pub async fn daemon_list_runs(
    state: State<'_, DaemonState>,
    project_id: Option<String>,
) -> Result<Value, CommandError> {
    let params = match project_id {
        Some(id) => json!({ "projectId": id }),
        None => json!({}),
    };
    call(&state, method::RUNS_LIST, params).await
}

/// Registers the project at `path` (idempotent) and starts a run on it.
#[tauri::command]
pub async fn daemon_start_run(
    state: State<'_, DaemonState>,
    path: String,
    prompt: Option<String>,
    title: Option<String>,
    issue: Option<u64>,
) -> Result<Value, CommandError> {
    let socket = state.socket()?;
    timed(CALL_TIMEOUT, async {
        let mut c = Client::connect(socket).await?;
        let project = c
            .call(method::PROJECTS_REGISTER, json!({ "path": path }))
            .await?;
        let project_id = project
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| ClientError::Protocol("projects.register returned no id".into()))?
            .to_string();
        let mut params = json!({ "projectId": project_id });
        if let Some(prompt) = prompt.filter(|p| !p.trim().is_empty()) {
            params["prompt"] = prompt.into();
        }
        if let Some(title) = title.filter(|t| !t.trim().is_empty()) {
            params["title"] = title.into();
        }
        if let Some(issue) = issue {
            params["issue"] = issue.into();
        }
        c.call(method::RUNS_START, params).await
    })
    .await
}

fn resolve_params(request_id: String, answer: Option<String>) -> Value {
    let mut params = json!({ "requestId": request_id });
    if let Some(answer) = answer {
        params["answer"] = answer.into();
    }
    params
}

#[tauri::command]
pub async fn daemon_approve(
    state: State<'_, DaemonState>,
    request_id: String,
    answer: Option<String>,
) -> Result<Value, CommandError> {
    call(&state, method::REQUESTS_APPROVE, resolve_params(request_id, answer)).await
}

#[tauri::command]
pub async fn daemon_deny(
    state: State<'_, DaemonState>,
    request_id: String,
    answer: Option<String>,
) -> Result<Value, CommandError> {
    call(&state, method::REQUESTS_DENY, resolve_params(request_id, answer)).await
}

/// A run's agent bus log (`bus.list`), oldest first; `[]` from daemons
/// before agentux-core 0.2.0.
#[tauri::command]
pub async fn daemon_bus_list(
    state: State<'_, DaemonState>,
    run_id: String,
) -> Result<Value, CommandError> {
    let socket = state.socket()?;
    timed(CALL_TIMEOUT, async {
        Client::connect(socket).await?.list_bus(&run_id).await
    })
    .await
}

/// Optional methods the daemon serves, probed on one connection. The UI keeps
/// what needs them disabled otherwise.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub sessions_prompt: bool,
    pub bus_post: bool,
    /// `terminals.*` (agentux-core #11): terminal mode.
    pub terminals: bool,
}

#[tauri::command]
pub async fn daemon_capabilities(
    state: State<'_, DaemonState>,
) -> Result<Capabilities, CommandError> {
    let socket = state.socket()?;
    timed(CALL_TIMEOUT, async {
        let mut c = Client::connect(socket).await?;
        Ok(Capabilities {
            sessions_prompt: c.serves(method::SESSIONS_PROMPT).await?,
            bus_post: c.serves(method::BUS_POST).await?,
            // `terminals.list` with no filter is valid: any answer but
            // -32601 means terminal mode is served.
            terminals: c.serves(method::TERMINALS_LIST).await?,
        })
    })
    .await
}

/// Sends the human's prompt into a session (`sessions.prompt`), on daemons
/// that serve it (see `daemon_capabilities`).
#[tauri::command]
pub async fn daemon_send_prompt(
    state: State<'_, DaemonState>,
    session_id: String,
    text: String,
) -> Result<Value, CommandError> {
    call(
        &state,
        method::SESSIONS_PROMPT,
        json!({ "sessionId": session_id, "text": text }),
    )
    .await
}

/// Posts the human's message on a run's bus (`bus.post`), on daemons that
/// serve it (see `daemon_capabilities`). `to` is a daemon `BusEndpoint`
/// (session, role or run); without it, `in_reply_to` answers that message's
/// sender. Returns `{ messageId, exchange, turn, deliveredTo, queuedForRole }`.
#[tauri::command]
pub async fn daemon_bus_post(
    state: State<'_, DaemonState>,
    run_id: String,
    to: Option<Value>,
    body: String,
    subject: Option<String>,
    in_reply_to: Option<i64>,
) -> Result<Value, CommandError> {
    call(
        &state,
        method::BUS_POST,
        client::bus_post_params(&run_id, to, &body, subject.as_deref(), in_reply_to),
    )
    .await
}

#[tauri::command]
pub async fn daemon_cancel(
    state: State<'_, DaemonState>,
    run_id: String,
) -> Result<Value, CommandError> {
    call(&state, method::RUNS_CANCEL, json!({ "runId": run_id })).await
}

// ---- terminal mode ------------------------------------------------------------

fn check_stream(stream: &str) -> Result<(), CommandError> {
    if terminal::valid_stream(stream) {
        Ok(())
    } else {
        Err(CommandError {
            code: None,
            message: format!("invalid terminal stream name {stream:?}"),
            unavailable: false,
        })
    }
}

/// Opens a terminal (`terminals.open`) on a connection of its own; its output
/// and exit are emitted on `terminal://<stream>` (the UI listens there before
/// calling). `command`: `harness-tui` (with `session_id`) or `shell`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn terminal_open(
    terms: State<'_, Terminals>,
    session_id: Option<String>,
    run_id: Option<String>,
    command: Option<String>,
    cols: u16,
    rows: u16,
    stream: String,
) -> Result<Value, CommandError> {
    check_stream(&stream)?;
    let params = terminal::open_params(
        session_id.as_deref(),
        run_id.as_deref(),
        command.as_deref(),
        cols,
        rows,
    );
    timed(CALL_TIMEOUT, terms.open(params, &stream)).await
}

/// Streams an existing terminal (`terminals.attach`: scrollback, then live
/// output) to `terminal://<stream>`; used when the view is rebuilt while the
/// terminal still runs.
#[tauri::command]
pub async fn terminal_attach(
    terms: State<'_, Terminals>,
    terminal_id: String,
    stream: String,
) -> Result<Value, CommandError> {
    check_stream(&stream)?;
    timed(CALL_TIMEOUT, terms.attach(&terminal_id, &stream)).await
}

/// Input for a terminal; `data` is base64 of the bytes.
#[tauri::command]
pub async fn terminal_write(
    terms: State<'_, Terminals>,
    terminal_id: String,
    data: String,
) -> Result<(), CommandError> {
    timed(CALL_TIMEOUT, terms.write(&terminal_id, &data)).await
}

#[tauri::command]
pub async fn terminal_resize(
    terms: State<'_, Terminals>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), CommandError> {
    timed(CALL_TIMEOUT, terms.resize(&terminal_id, cols, rows)).await
}

/// Closes a terminal and drops its connection.
#[tauri::command]
pub async fn terminal_close(
    terms: State<'_, Terminals>,
    terminal_id: String,
) -> Result<(), CommandError> {
    timed(CALL_TIMEOUT, terms.close(&terminal_id)).await
}

/// Stops streaming a terminal without closing it.
#[tauri::command]
pub fn terminal_detach(terms: State<'_, Terminals>, terminal_id: String) {
    terms.detach(&terminal_id);
}

/// `terminals.list`, each with `held` (this cockpit opened it and owns it).
#[tauri::command]
pub async fn terminal_list(
    terms: State<'_, Terminals>,
    session_id: Option<String>,
    run_id: Option<String>,
) -> Result<Value, CommandError> {
    let mut params = json!({});
    if let Some(id) = session_id {
        params["sessionId"] = id.into();
    }
    if let Some(id) = run_id {
        params["runId"] = id.into();
    }
    timed(CALL_TIMEOUT, terms.list(params)).await
}
