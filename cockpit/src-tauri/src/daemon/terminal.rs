//! Terminal mode: a harness TUI or a shell on a pseudo-terminal that
//! `agentuxd` manages (agentux-core `docs/api.md`, "Terminal mode").
//!
//! The daemon ties a terminal to the connection that opened it: closing that
//! connection closes the terminal (and, for a harness TUI, hands the session
//! back to ACP). Output streams as `terminal_output` / `terminal_exit`
//! notifications on the connection that opened or attached it. So every
//! terminal the cockpit shows gets its own connection, kept here by terminal
//! id, and its notifications are re-emitted to the UI on the Tauri event
//! `terminal://<stream>`, where `stream` is a key the UI picked (and listens
//! on) before asking: output that comes right after the open cannot be missed.
//!
//! - `open`: a new connection that opens the terminal and owns it.
//! - `attach`: a new connection that replays the scrollback and streams live
//!   output (a reconnect after the view was rebuilt). If this cockpit owns the
//!   terminal, the owning connection stays (so the terminal stays open) but
//!   stops forwarding; the attached one streams instead.
//! - `write` / `resize`: notifications on the terminal's connection (no
//!   round trip per keystroke).
//! - `close`: `terminals.close`, a short wait for `terminal_exit`, then the
//!   connection is dropped. `detach` drops only an attached connection.
//! - `close_all`: drops every connection (window closed or reloaded).
//!
//! Connections are made through a `Connector`, so tests can run the same code
//! against a fake daemon on TCP as well as on a Unix socket.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader, Lines};
use tokio::sync::{watch, Mutex as AsyncMutex};
use tokio::task::JoinHandle;

use super::client::{
    method, notification_line, parse_response, request_line, ClientError,
};

pub type BoxRead = Box<dyn AsyncRead + Unpin + Send>;
pub type BoxWrite = Box<dyn AsyncWrite + Unpin + Send>;
pub type ConnectFuture =
    Pin<Box<dyn Future<Output = Result<(BoxRead, BoxWrite), ClientError>> + Send>>;
/// Opens one connection to the daemon.
pub type Connector = Arc<dyn Fn() -> ConnectFuture + Send + Sync>;
/// Delivers a terminal event to the UI: `(stream, event)`.
pub type Emit = Arc<dyn Fn(&str, TerminalEvent) + Send + Sync>;

/// JSON-RPC "not found": no such terminal (it exited and was forgotten).
pub const NOT_FOUND: i64 = -32001;

/// How long `close` waits for `terminal_exit` before dropping the connection
/// (the daemon sends SIGHUP, then SIGKILL after 3 s).
const CLOSE_GRACE: Duration = Duration::from_secs(4);

/// What the UI receives on `terminal://<stream>`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TerminalEvent {
    /// Raw terminal bytes, base64 as the daemon sent them.
    #[serde(rename_all = "camelCase")]
    Output { terminal_id: String, data: String },
    /// The process exited (`code` is `None` when it was killed by a signal).
    /// The terminal's last event.
    #[serde(rename_all = "camelCase")]
    Exit {
        terminal_id: String,
        code: Option<i64>,
    },
    /// The connection to the daemon went away without a `terminal_exit`
    /// (the daemon stopped): the terminal is gone with it.
    #[serde(rename_all = "camelCase")]
    Closed { terminal_id: String, reason: String },
}

/// The Tauri event a stream's terminal events are emitted on.
pub fn channel(stream: &str) -> String {
    format!("terminal://{stream}")
}

/// Whether `stream` may be used in a Tauri event name (alphanumerics, `-`,
/// `/`, `:` and `_`), and is not empty or absurdly long.
pub fn valid_stream(stream: &str) -> bool {
    !stream.is_empty()
        && stream.len() <= 128
        && stream
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '/'))
}

/// `terminals.open` params. `command` is passed through (`harness-tui` or
/// `shell`; the daemon picks `harness-tui` with a session, `shell` with only a
/// run). Sizes below 1 are raised to 1 (the daemon refuses 0).
pub fn open_params(
    session_id: Option<&str>,
    run_id: Option<&str>,
    command: Option<&str>,
    cols: u16,
    rows: u16,
) -> Value {
    let mut params = json!({ "cols": cols.max(1), "rows": rows.max(1) });
    if let Some(id) = session_id.filter(|s| !s.is_empty()) {
        params["sessionId"] = id.into();
    }
    if let Some(id) = run_id.filter(|s| !s.is_empty()) {
        params["runId"] = id.into();
    }
    if let Some(command) = command.filter(|s| !s.is_empty()) {
        params["command"] = command.into();
    }
    params
}

/// The terminal notification in `line` for `terminal_id`, if it is one.
fn notice(line: &str, terminal_id: &str) -> Option<TerminalEvent> {
    let value: Value = serde_json::from_str(line).ok()?;
    let params = value.get("params")?;
    if params.get("terminalId")?.as_str()? != terminal_id {
        return None;
    }
    let terminal_id = terminal_id.to_string();
    match value.get("method")?.as_str()? {
        method::TERMINAL_OUTPUT => Some(TerminalEvent::Output {
            terminal_id,
            data: params.get("data")?.as_str()?.to_string(),
        }),
        method::TERMINAL_EXIT => Some(TerminalEvent::Exit {
            terminal_id,
            code: params.get("code").and_then(Value::as_i64),
        }),
        _ => None,
    }
}

fn terminal_id_of(terminal: &Value) -> Result<String, ClientError> {
    terminal
        .get("terminalId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| ClientError::Protocol("the terminal has no terminalId".into()))
}

type Writer = Arc<AsyncMutex<BoxWrite>>;
type LineReader = Lines<BufReader<BoxRead>>;

async fn send_line(writer: &Writer, line: &[u8]) -> Result<(), ClientError> {
    let mut w = writer.lock().await;
    w.write_all(line).await?;
    w.flush().await?;
    Ok(())
}

/// One connection streaming one terminal.
struct Link {
    id: u64,
    writer: Writer,
    /// Whether its notifications go to the UI (an owner whose terminal is
    /// attached elsewhere stays quiet).
    forward: Arc<AtomicBool>,
    reader: JoinHandle<()>,
}

impl Drop for Link {
    fn drop(&mut self) {
        // The reader holds the read half: aborting it drops it, and with the
        // writer this closes the connection.
        self.reader.abort();
    }
}

/// A terminal this cockpit holds a connection to.
struct Entry {
    /// The connection that opened it (closing it closes the terminal).
    owner: Option<Link>,
    /// An attached connection that streams to the UI instead of the owner.
    view: Option<Link>,
    /// Set to `true` once `terminal_exit` arrived.
    exited: watch::Sender<bool>,
}

impl Entry {
    fn writer(&self) -> Option<Writer> {
        self.owner
            .as_ref()
            .or(self.view.as_ref())
            .map(|l| Arc::clone(&l.writer))
    }
}

type Entries = Arc<Mutex<HashMap<String, Entry>>>;

fn lock(entries: &Entries) -> MutexGuard<'_, HashMap<String, Entry>> {
    entries.lock().unwrap_or_else(|e| e.into_inner())
}

/// The terminals this cockpit holds connections to.
pub struct Terminals {
    connect: Connector,
    emit: Emit,
    entries: Entries,
    next_link: AtomicU64,
    /// Ids of requests sent on a terminal's connection after its open/attach
    /// (which used 1); unique per process, so unique per connection.
    next_request: AtomicU64,
}

impl Terminals {
    pub fn new(connect: Connector, emit: Emit) -> Self {
        Self {
            connect,
            emit,
            entries: Arc::new(Mutex::new(HashMap::new())),
            next_link: AtomicU64::new(1),
            next_request: AtomicU64::new(2),
        }
    }

    /// `terminals.open` on a new connection that then owns the terminal; its
    /// events go to `stream`. Returns the daemon's `Terminal`.
    pub async fn open(&self, params: Value, stream: &str) -> Result<Value, ClientError> {
        let (terminal, lines, writer, early) =
            self.handshake(method::TERMINALS_OPEN, params).await?;
        let id = terminal_id_of(&terminal)?;
        self.install(&id, stream, lines, writer, early, true);
        Ok(terminal)
    }

    /// `terminals.attach` on a new connection: the scrollback, then live
    /// output, to `stream`. A terminal this cockpit owns keeps its owning
    /// connection, which stops forwarding.
    pub async fn attach(&self, terminal_id: &str, stream: &str) -> Result<Value, ClientError> {
        let (terminal, lines, writer, early) = self
            .handshake(
                method::TERMINALS_ATTACH,
                json!({ "terminalId": terminal_id }),
            )
            .await?;
        self.install(terminal_id, stream, lines, writer, early, false);
        Ok(terminal)
    }

    /// Input for the terminal (`data` is base64), as a notification.
    pub async fn write(&self, terminal_id: &str, data: &str) -> Result<(), ClientError> {
        self.notify(
            terminal_id,
            method::TERMINALS_WRITE,
            json!({ "terminalId": terminal_id, "data": data }),
        )
        .await
    }

    pub async fn resize(&self, terminal_id: &str, cols: u16, rows: u16) -> Result<(), ClientError> {
        self.notify(
            terminal_id,
            method::TERMINALS_RESIZE,
            json!({ "terminalId": terminal_id, "cols": cols.max(1), "rows": rows.max(1) }),
        )
        .await
    }

    /// Closes the terminal: `terminals.close` on its connection, a short wait
    /// for its `terminal_exit` (forwarded to the UI), then the connection is
    /// dropped, which closes a terminal it owns in any case. A terminal this
    /// cockpit holds no connection to is closed with a one-off request; one
    /// that is already gone is not an error.
    pub async fn close(&self, terminal_id: &str) -> Result<(), ClientError> {
        let params = json!({ "terminalId": terminal_id });
        let held = {
            let entries = lock(&self.entries);
            entries
                .get(terminal_id)
                .and_then(|e| Some((e.writer()?, e.exited.subscribe())))
        };
        let Some((writer, mut exited)) = held else {
            return match self.call(method::TERMINALS_CLOSE, params).await {
                Err(ClientError::Rpc { code, .. }) if code == NOT_FOUND => Ok(()),
                other => other.map(|_| ()),
            };
        };
        let id = self.next_request.fetch_add(1, Ordering::Relaxed);
        let line = request_line(id, method::TERMINALS_CLOSE, &params)?;
        if send_line(&writer, &line).await.is_ok() {
            // Ends early when the entry goes away (exit, or the link died).
            let _ = tokio::time::timeout(CLOSE_GRACE, exited.wait_for(|done| *done)).await;
        }
        self.forget(terminal_id);
        Ok(())
    }

    /// Stops streaming the terminal to the UI without closing it: drops an
    /// attached connection (a terminal this cockpit owns stays open, quiet,
    /// until it is closed or attached again).
    pub fn detach(&self, terminal_id: &str) {
        let mut entries = lock(&self.entries);
        let Some(entry) = entries.get_mut(terminal_id) else {
            return;
        };
        entry.view = None;
        if let Some(owner) = &entry.owner {
            owner.forward.store(false, Ordering::SeqCst);
            return;
        }
        let removed = entries.remove(terminal_id);
        drop(entries);
        drop(removed);
    }

    /// Drops every connection: the terminals this cockpit opened close.
    pub fn close_all(&self) {
        let drained: Vec<Entry> = lock(&self.entries).drain().map(|(_, e)| e).collect();
        drop(drained);
    }

    /// Ids of the terminals this cockpit holds a connection to.
    pub fn held(&self) -> Vec<String> {
        let mut ids: Vec<String> = lock(&self.entries).keys().cloned().collect();
        ids.sort();
        ids
    }

    /// `terminals.list`, each terminal with `held: true` when this cockpit
    /// opened it and still owns it.
    pub async fn list(&self, params: Value) -> Result<Value, ClientError> {
        let mut list = self.call(method::TERMINALS_LIST, params).await?;
        if let Value::Array(items) = &mut list {
            let entries = lock(&self.entries);
            for item in items.iter_mut() {
                let held = item
                    .get("terminalId")
                    .and_then(Value::as_str)
                    .and_then(|id| entries.get(id))
                    .is_some_and(|e| e.owner.is_some());
                if let Value::Object(map) = item {
                    map.insert("held".into(), held.into());
                }
            }
        }
        Ok(list)
    }

    /// One request on a short-lived connection.
    pub async fn call(&self, method: &str, params: Value) -> Result<Value, ClientError> {
        let (reader, mut writer) = (self.connect)().await?;
        writer.write_all(&request_line(1, method, &params)?).await?;
        writer.flush().await?;
        let mut lines = BufReader::new(reader).lines();
        loop {
            let line = lines.next_line().await?.ok_or_else(closed)?;
            if let Some(result) = parse_response(&line, 1) {
                return result;
            }
        }
    }

    // ---- internals --------------------------------------------------------

    /// Connects, sends request 1 and reads up to its response. Lines that
    /// came before it are kept (the daemon sends output only after the
    /// response, but nothing is lost if one does not).
    async fn handshake(
        &self,
        method: &str,
        params: Value,
    ) -> Result<(Value, LineReader, BoxWrite, Vec<String>), ClientError> {
        let (reader, mut writer) = (self.connect)().await?;
        writer.write_all(&request_line(1, method, &params)?).await?;
        writer.flush().await?;
        let mut lines = BufReader::new(reader).lines();
        let mut early = Vec::new();
        loop {
            let line = lines.next_line().await?.ok_or_else(closed)?;
            match parse_response(&line, 1) {
                Some(result) => return Ok((result?, lines, writer, early)),
                None => early.push(line),
            }
        }
    }

    async fn notify(&self, terminal_id: &str, method: &str, params: Value) -> Result<(), ClientError> {
        let writer = lock(&self.entries).get(terminal_id).and_then(Entry::writer);
        match writer {
            Some(writer) => send_line(&writer, &notification_line(method, &params)?).await,
            None => self.call(method, params).await.map(|_| ()),
        }
    }

    fn forget(&self, terminal_id: &str) {
        let removed = lock(&self.entries).remove(terminal_id);
        drop(removed);
    }

    /// Starts forwarding a connection's notifications and records it. The
    /// reader is spawned under the lock, so it cannot end before its entry
    /// exists.
    fn install(
        &self,
        terminal_id: &str,
        stream: &str,
        lines: LineReader,
        writer: BoxWrite,
        early: Vec<String>,
        owner: bool,
    ) {
        let mut entries = lock(&self.entries);
        let link_id = self.next_link.fetch_add(1, Ordering::Relaxed);
        let forward = Arc::new(AtomicBool::new(true));
        let reader = tokio::spawn(pump(Pump {
            lines,
            early,
            terminal_id: terminal_id.to_string(),
            stream: stream.to_string(),
            link_id,
            forward: Arc::clone(&forward),
            emit: Arc::clone(&self.emit),
            entries: Arc::clone(&self.entries),
        }));
        let link = Link {
            id: link_id,
            writer: Arc::new(AsyncMutex::new(writer)),
            forward,
            reader,
        };
        let entry = entries
            .entry(terminal_id.to_string())
            .or_insert_with(|| Entry {
                owner: None,
                view: None,
                exited: watch::channel(false).0,
            });
        if owner {
            entry.owner = Some(link);
        } else {
            if let Some(o) = &entry.owner {
                o.forward.store(false, Ordering::SeqCst);
            }
            entry.view = Some(link);
        }
    }
}

fn closed() -> ClientError {
    ClientError::Protocol("the daemon closed the connection".into())
}

struct Pump {
    lines: LineReader,
    early: Vec<String>,
    terminal_id: String,
    stream: String,
    link_id: u64,
    forward: Arc<AtomicBool>,
    emit: Emit,
    entries: Entries,
}

/// Forwards one connection's terminal notifications until `terminal_exit` or
/// the end of the connection, then updates the registry.
async fn pump(p: Pump) {
    let Pump {
        mut lines,
        early,
        terminal_id,
        stream,
        link_id,
        forward,
        emit,
        entries,
    } = p;
    let mut early = early.into_iter();
    let mut exited = false;
    loop {
        let line = match early.next() {
            Some(line) => line,
            None => match lines.next_line().await {
                Ok(Some(line)) => line,
                _ => break,
            },
        };
        let Some(event) = notice(&line, &terminal_id) else {
            continue; // responses to our requests, other terminals
        };
        let is_exit = matches!(event, TerminalEvent::Exit { .. });
        if forward.load(Ordering::SeqCst) {
            emit(&stream, event);
        }
        if is_exit {
            exited = true;
            break;
        }
    }

    let mut map = lock(&entries);
    let Some(entry) = map.get_mut(&terminal_id) else {
        return;
    };
    let mine = |l: &Option<Link>| l.as_ref().is_some_and(|l| l.id == link_id);
    if !mine(&entry.owner) && !mine(&entry.view) {
        return; // replaced meanwhile
    }
    if exited {
        let _ = entry.exited.send(true);
        // Dropping the entry drops this task's own handle; aborting a task
        // that is about to return is harmless.
        let removed = map.remove(&terminal_id);
        drop(map);
        drop(removed);
        return;
    }
    let was_forwarding = forward.load(Ordering::SeqCst);
    if mine(&entry.view) {
        entry.view = None;
    } else {
        entry.owner = None;
    }
    let empty = entry.owner.is_none() && entry.view.is_none();
    if empty {
        let removed = map.remove(&terminal_id);
        drop(map);
        drop(removed);
    } else {
        drop(map);
    }
    if was_forwarding {
        emit(
            &stream,
            TerminalEvent::Closed {
                terminal_id,
                reason: "the connection to agentuxd closed".into(),
            },
        );
    }
}

/// Connects over the daemon's Unix socket.
#[cfg(unix)]
pub fn unix_connector(socket: std::path::PathBuf) -> Connector {
    Arc::new(move || {
        let socket = socket.clone();
        Box::pin(async move {
            let stream = tokio::net::UnixStream::connect(&socket).await.map_err(|e| {
                ClientError::Unavailable(format!(
                    "cannot connect to agentuxd at {}: {e}",
                    socket.display()
                ))
            })?;
            let (r, w) = stream.into_split();
            Ok((Box::new(r) as BoxRead, Box::new(w) as BoxWrite))
        })
    })
}

/// A connector that always fails with `message` (no socket, or a platform
/// without Unix sockets).
pub fn unavailable_connector(message: String) -> Connector {
    Arc::new(move || {
        let message = message.clone();
        Box::pin(async move { Err(ClientError::Unavailable(message)) })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_params_leave_out_what_is_not_given() {
        assert_eq!(
            open_params(Some("s1"), None, Some("harness-tui"), 80, 24),
            json!({"sessionId": "s1", "command": "harness-tui", "cols": 80, "rows": 24})
        );
        assert_eq!(
            open_params(None, Some("r1"), Some("shell"), 0, 0),
            json!({"runId": "r1", "command": "shell", "cols": 1, "rows": 1})
        );
        assert_eq!(
            open_params(Some(""), Some("r1"), None, 120, 40),
            json!({"runId": "r1", "cols": 120, "rows": 40})
        );
    }

    #[test]
    fn notices_are_matched_by_terminal() {
        let out = r#"{"jsonrpc":"2.0","method":"terminal_output","params":{"terminalId":"t1","data":"aGk="}}"#;
        assert_eq!(
            notice(out, "t1"),
            Some(TerminalEvent::Output {
                terminal_id: "t1".into(),
                data: "aGk=".into()
            })
        );
        assert_eq!(notice(out, "t2"), None);
        let exit = r#"{"jsonrpc":"2.0","method":"terminal_exit","params":{"terminalId":"t1","code":null}}"#;
        assert_eq!(
            notice(exit, "t1"),
            Some(TerminalEvent::Exit {
                terminal_id: "t1".into(),
                code: None
            })
        );
        assert_eq!(notice(r#"{"jsonrpc":"2.0","id":2,"result":null}"#, "t1"), None);
        assert_eq!(notice("not json", "t1"), None);
    }

    #[test]
    fn events_serialize_for_the_ui() {
        let v = serde_json::to_value(TerminalEvent::Output {
            terminal_id: "t1".into(),
            data: "aGk=".into(),
        })
        .unwrap();
        assert_eq!(v, json!({"kind": "output", "terminalId": "t1", "data": "aGk="}));
        let v = serde_json::to_value(TerminalEvent::Exit {
            terminal_id: "t1".into(),
            code: Some(2),
        })
        .unwrap();
        assert_eq!(v, json!({"kind": "exit", "terminalId": "t1", "code": 2}));
        let v = serde_json::to_value(TerminalEvent::Closed {
            terminal_id: "t1".into(),
            reason: "gone".into(),
        })
        .unwrap();
        assert_eq!(v, json!({"kind": "closed", "terminalId": "t1", "reason": "gone"}));
    }

    #[test]
    fn streams_must_fit_an_event_name() {
        assert!(valid_stream("term-3-a9f"));
        assert!(!valid_stream(""));
        assert!(!valid_stream("a b"));
        assert!(!valid_stream("x.y"));
        assert_eq!(channel("term-1"), "terminal://term-1");
    }
}

/// Tests against a fake `agentuxd`: over TCP (runs everywhere) and over a
/// Unix socket (the real transport).
#[cfg(test)]
mod socket_tests {
    use super::*;
    use tokio::net::TcpListener;
    use tokio::sync::mpsc;

    const WAIT: Duration = Duration::from_secs(5);

    /// One accepted connection of the fake daemon.
    struct Conn {
        lines: LineReader,
        writer: BoxWrite,
    }

    impl Conn {
        async fn request(&mut self) -> Value {
            let line = tokio::time::timeout(WAIT, self.lines.next_line())
                .await
                .expect("a request in time")
                .unwrap()
                .expect("a request");
            serde_json::from_str(&line).unwrap()
        }

        async fn send(&mut self, value: Value) {
            let mut line = serde_json::to_vec(&value).unwrap();
            line.push(b'\n');
            self.writer.write_all(&line).await.unwrap();
            self.writer.flush().await.unwrap();
        }

        async fn reply(&mut self, req: &Value, result: Value) {
            self.send(json!({"jsonrpc": "2.0", "id": req["id"], "result": result}))
                .await;
        }

        async fn output(&mut self, terminal_id: &str, data: &str) {
            self.send(json!({"jsonrpc": "2.0", "method": "terminal_output",
                "params": {"terminalId": terminal_id, "data": data}}))
                .await;
        }

        async fn exit(&mut self, terminal_id: &str, code: Option<i64>) {
            self.send(json!({"jsonrpc": "2.0", "method": "terminal_exit",
                "params": {"terminalId": terminal_id, "code": code}}))
                .await;
        }

        /// Waits until the client drops the connection.
        async fn closed(&mut self) {
            let next = tokio::time::timeout(WAIT, self.lines.next_line())
                .await
                .expect("the client to close the connection in time");
            assert!(matches!(next, Ok(None) | Err(_)), "unexpected {next:?}");
        }
    }

    enum Server {
        Tcp(TcpListener),
        #[cfg(unix)]
        Unix(tokio::net::UnixListener, std::path::PathBuf),
    }

    impl Server {
        async fn tcp() -> Self {
            Self::Tcp(TcpListener::bind("127.0.0.1:0").await.unwrap())
        }

        #[cfg(unix)]
        fn unix() -> Self {
            use std::sync::atomic::AtomicU32;
            static N: AtomicU32 = AtomicU32::new(0);
            let dir = std::env::temp_dir().join(format!(
                "cockpit-term-{}-{}",
                std::process::id(),
                N.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join("agentuxd.sock");
            let _ = std::fs::remove_file(&path);
            Self::Unix(tokio::net::UnixListener::bind(&path).unwrap(), path)
        }

        fn connector(&self) -> Connector {
            match self {
                Self::Tcp(l) => {
                    let addr = l.local_addr().unwrap();
                    Arc::new(move || {
                        Box::pin(async move {
                            let s = tokio::net::TcpStream::connect(addr).await?;
                            let (r, w) = s.into_split();
                            Ok((Box::new(r) as BoxRead, Box::new(w) as BoxWrite))
                        })
                    })
                }
                #[cfg(unix)]
                Self::Unix(_, path) => unix_connector(path.clone()),
            }
        }

        async fn accept(&self) -> Conn {
            let (r, w): (BoxRead, BoxWrite) = match self {
                Self::Tcp(l) => {
                    let (s, _) = tokio::time::timeout(WAIT, l.accept()).await.unwrap().unwrap();
                    let (r, w) = s.into_split();
                    (Box::new(r), Box::new(w))
                }
                #[cfg(unix)]
                Self::Unix(l, _) => {
                    let (s, _) = tokio::time::timeout(WAIT, l.accept()).await.unwrap().unwrap();
                    let (r, w) = s.into_split();
                    (Box::new(r), Box::new(w))
                }
            };
            Conn {
                lines: BufReader::new(r).lines(),
                writer: w,
            }
        }
    }

    type Events = mpsc::UnboundedReceiver<(String, TerminalEvent)>;

    fn terminals(server: &Server) -> (Arc<Terminals>, Events) {
        let (tx, rx) = mpsc::unbounded_channel();
        let emit: Emit = Arc::new(move |stream: &str, event| {
            let _ = tx.send((stream.to_string(), event));
        });
        (Arc::new(Terminals::new(server.connector(), emit)), rx)
    }

    async fn next_event(rx: &mut Events) -> (String, TerminalEvent) {
        tokio::time::timeout(WAIT, rx.recv())
            .await
            .expect("an event in time")
            .expect("the emitter is alive")
    }

    fn terminal(id: &str, state: &str) -> Value {
        json!({"terminalId": id, "sessionId": "s1", "runId": "r1", "command": "harness-tui",
            "fallback": null, "argv": ["claude", "--resume", "v1"], "cwd": "/wt",
            "cols": 80, "rows": 24, "state": state, "exitCode": null, "createdAt": 1})
    }

    fn output(id: &str, data: &str) -> TerminalEvent {
        TerminalEvent::Output {
            terminal_id: id.into(),
            data: data.into(),
        }
    }

    async fn until_released(terms: &Terminals) {
        tokio::time::timeout(WAIT, async {
            while !terms.held().is_empty() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("the terminal to be released");
    }

    /// Opens `t1` on `server` with events on stream `s`.
    async fn open_t1(server: &Server, terms: &Arc<Terminals>) -> Conn {
        let opener = {
            let terms = Arc::clone(terms);
            tokio::spawn(async move {
                terms
                    .open(open_params(Some("s1"), None, Some("harness-tui"), 80, 24), "s")
                    .await
            })
        };
        let mut conn = server.accept().await;
        let req = conn.request().await;
        assert_eq!(req["method"], "terminals.open");
        assert_eq!(
            req["params"],
            json!({"sessionId": "s1", "command": "harness-tui", "cols": 80, "rows": 24})
        );
        conn.reply(&req, terminal("t1", "running")).await;
        let opened = opener.await.unwrap().unwrap();
        assert_eq!(opened["terminalId"], "t1");
        conn
    }

    async fn open_output_write_exit(server: Server) {
        let (terms, mut rx) = terminals(&server);
        let mut conn = open_t1(&server, &terms).await;
        assert_eq!(terms.held(), vec!["t1".to_string()]);

        conn.output("t1", "aGk=").await;
        conn.output("t2", "b3RoZXI=").await; // another terminal's: not forwarded
        conn.output("t1", "DQo=").await;
        assert_eq!(next_event(&mut rx).await, ("s".into(), output("t1", "aGk=")));
        assert_eq!(next_event(&mut rx).await, ("s".into(), output("t1", "DQo=")));

        // Input and resizes are notifications on the terminal's connection.
        terms.write("t1", "bHMNCg==").await.unwrap();
        let req = conn.request().await;
        assert_eq!(
            req,
            json!({"jsonrpc": "2.0", "method": "terminals.write",
                "params": {"terminalId": "t1", "data": "bHMNCg=="}})
        );
        terms.resize("t1", 132, 40).await.unwrap();
        let req = conn.request().await;
        assert!(req.get("id").is_none());
        assert_eq!(req["method"], "terminals.resize");
        assert_eq!(req["params"], json!({"terminalId": "t1", "cols": 132, "rows": 40}));

        conn.exit("t1", Some(0)).await;
        assert_eq!(
            next_event(&mut rx).await,
            (
                "s".into(),
                TerminalEvent::Exit {
                    terminal_id: "t1".into(),
                    code: Some(0)
                }
            )
        );
        until_released(&terms).await;
        conn.closed().await;
    }

    async fn close_then_drop(server: Server) {
        let (terms, mut rx) = terminals(&server);
        let mut conn = open_t1(&server, &terms).await;

        let closer = {
            let terms = Arc::clone(&terms);
            tokio::spawn(async move { terms.close("t1").await })
        };
        let req = conn.request().await;
        assert_eq!(req["method"], "terminals.close");
        assert_eq!(req["params"], json!({"terminalId": "t1"}));
        assert!(req["id"].as_u64().unwrap() > 1);
        conn.reply(&req, Value::Null).await;
        conn.exit("t1", None).await;

        tokio::time::timeout(WAIT, closer)
            .await
            .expect("close to return")
            .unwrap()
            .unwrap();
        assert_eq!(
            next_event(&mut rx).await.1,
            TerminalEvent::Exit {
                terminal_id: "t1".into(),
                code: None
            }
        );
        assert!(terms.held().is_empty());
        conn.closed().await;
    }

    #[tokio::test]
    async fn open_streams_output_takes_input_and_ends_on_exit_tcp() {
        open_output_write_exit(Server::tcp().await).await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn open_streams_output_takes_input_and_ends_on_exit_unix() {
        open_output_write_exit(Server::unix()).await;
    }

    #[tokio::test]
    async fn close_asks_the_daemon_then_drops_the_connection_tcp() {
        close_then_drop(Server::tcp().await).await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn close_asks_the_daemon_then_drops_the_connection_unix() {
        close_then_drop(Server::unix()).await;
    }

    #[tokio::test]
    async fn close_all_drops_every_connection() {
        let server = Server::tcp().await;
        let (terms, _rx) = terminals(&server);
        let mut conn = open_t1(&server, &terms).await;
        terms.close_all();
        assert!(terms.held().is_empty());
        conn.closed().await;
    }

    #[tokio::test]
    async fn attach_moves_the_stream_and_keeps_the_owner() {
        let server = Server::tcp().await;
        let (terms, mut rx) = terminals(&server);
        let mut owner = open_t1(&server, &terms).await;

        let attacher = {
            let terms = Arc::clone(&terms);
            tokio::spawn(async move { terms.attach("t1", "s2").await })
        };
        let mut view = server.accept().await;
        let req = view.request().await;
        assert_eq!(req["method"], "terminals.attach");
        assert_eq!(req["params"], json!({"terminalId": "t1"}));
        view.reply(&req, terminal("t1", "running")).await;
        attacher.await.unwrap().unwrap();

        // The owner stays quiet; the attached connection streams to s2.
        owner.output("t1", "b2xk").await;
        view.output("t1", "c2Nyb2xsYmFjaw==").await;
        assert_eq!(
            next_event(&mut rx).await,
            ("s2".into(), output("t1", "c2Nyb2xsYmFjaw=="))
        );

        // Input still goes through the owning connection.
        terms.write("t1", "eA==").await.unwrap();
        assert_eq!(owner.request().await["method"], "terminals.write");

        // Detaching drops the attached connection only.
        terms.detach("t1");
        view.closed().await;
        assert_eq!(terms.held(), vec!["t1".to_string()]);

        // The daemon going away is reported to nobody (the owner is quiet).
        drop(owner);
        until_released(&terms).await;
        assert!(rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn a_lost_connection_is_reported() {
        let server = Server::tcp().await;
        let (terms, mut rx) = terminals(&server);
        let conn = open_t1(&server, &terms).await;
        drop(conn);
        let (stream, event) = next_event(&mut rx).await;
        assert_eq!(stream, "s");
        assert!(matches!(event, TerminalEvent::Closed { ref terminal_id, .. } if terminal_id == "t1"));
        until_released(&terms).await;
    }

    #[tokio::test]
    async fn open_errors_and_list_marks_held_terminals() {
        let server = Server::tcp().await;
        let (terms, _rx) = terminals(&server);

        let opener = {
            let terms = Arc::clone(&terms);
            tokio::spawn(async move { terms.open(json!({"cols": 0, "rows": 0}), "s").await })
        };
        let mut conn = server.accept().await;
        let req = conn.request().await;
        conn.send(json!({"jsonrpc": "2.0", "id": req["id"],
            "error": {"code": -32602, "message": "sessionId or runId is required"}}))
            .await;
        match opener.await.unwrap() {
            Err(ClientError::Rpc { code, .. }) => assert_eq!(code, -32602),
            other => panic!("unexpected {other:?}"),
        }
        assert!(terms.held().is_empty());

        let _owner = open_t1(&server, &terms).await;
        let lister = {
            let terms = Arc::clone(&terms);
            tokio::spawn(async move { terms.list(json!({"sessionId": "s1"})).await })
        };
        let mut conn = server.accept().await;
        let req = conn.request().await;
        assert_eq!(req["method"], "terminals.list");
        assert_eq!(req["params"], json!({"sessionId": "s1"}));
        conn.reply(&req, json!([terminal("t1", "running"), terminal("t9", "waiting")]))
            .await;
        let list = lister.await.unwrap().unwrap();
        assert_eq!(list[0]["held"], true);
        assert_eq!(list[1]["held"], false);

        // Closing a terminal this cockpit does not hold, that is already
        // gone, is fine.
        let closer = {
            let terms = Arc::clone(&terms);
            tokio::spawn(async move { terms.close("t9").await })
        };
        let mut conn = server.accept().await;
        let req = conn.request().await;
        assert_eq!(req["method"], "terminals.close");
        conn.send(json!({"jsonrpc": "2.0", "id": req["id"],
            "error": {"code": NOT_FOUND, "message": "no such terminal"}}))
            .await;
        closer.await.unwrap().unwrap();
    }
}
