//! A small client for the `agentuxd` API: newline-delimited JSON-RPC 2.0 over
//! a Unix socket (agentux-core `docs/api.md`).
//!
//! Results and events are kept as raw `serde_json::Value`s on purpose. The
//! cockpit only forwards them to the frontend, where the adapter in
//! `src/daemon/tauri/mapping.ts` turns them into the UI model. Keeping them
//! untyped here means a daemon that grows new fields, request kinds or event
//! kinds does not break the stream; the typed `agentux-api` client would
//! reject an unknown enum variant.

use std::path::Path;
use std::{fmt, io};

use serde::Serialize;
use serde_json::{json, Value};

/// JSON-RPC method names served by `agentuxd`.
pub mod method {
    pub const PROJECTS_REGISTER: &str = "projects.register";
    pub const PROJECTS_LIST: &str = "projects.list";
    pub const RUNS_START: &str = "runs.start";
    pub const RUNS_LIST: &str = "runs.list";
    pub const RUNS_CANCEL: &str = "runs.cancel";
    pub const SESSIONS_LIST: &str = "sessions.list";
    pub const REQUESTS_LIST: &str = "requests.list";
    pub const REQUESTS_APPROVE: &str = "requests.approve";
    pub const REQUESTS_DENY: &str = "requests.deny";
    pub const EVENTS_SUBSCRIBE: &str = "events.subscribe";
    /// A run's agent bus log (agentux-core 0.2.0).
    pub const BUS_LIST: &str = "bus.list";
    /// The human prompts a session (agentux-core #9); probed with
    /// `Client::serves` before use, older daemons answer -32601.
    pub const SESSIONS_PROMPT: &str = "sessions.prompt";
    /// The human posts on a run's bus (agentux-core #9); probed like
    /// `sessions.prompt`.
    pub const BUS_POST: &str = "bus.post";
    /// A run's stored events in pages (agentux-core #9). Older daemons answer
    /// -32601; the history then comes from a replayed subscription.
    pub const RUNS_EVENTS: &str = "runs.events";
    /// Server-to-client notification carrying one event.
    pub const EVENT: &str = "event";
    /// Server-to-client notification, once per subscription, where the replay
    /// of stored events ends (agentux-core #9; older daemons never send it).
    pub const REPLAY_DONE: &str = "replay_done";
    /// Terminal mode (agentux-core #11): a harness TUI or a shell on a PTY the
    /// daemon manages. Output streams as notifications on the connection that
    /// opened or attached the terminal, which also owns what it opened.
    pub const TERMINALS_OPEN: &str = "terminals.open";
    pub const TERMINALS_ATTACH: &str = "terminals.attach";
    pub const TERMINALS_WRITE: &str = "terminals.write";
    pub const TERMINALS_RESIZE: &str = "terminals.resize";
    pub const TERMINALS_CLOSE: &str = "terminals.close";
    pub const TERMINALS_LIST: &str = "terminals.list";
    /// Server-to-client notification: `{ terminalId, data }`, data base64.
    pub const TERMINAL_OUTPUT: &str = "terminal_output";
    /// Server-to-client notification, a terminal's last: `{ terminalId, code }`.
    pub const TERMINAL_EXIT: &str = "terminal_exit";
}

#[derive(Debug)]
pub enum ClientError {
    /// The socket could not be reached: the daemon is not running.
    Unavailable(String),
    Io(io::Error),
    /// The daemon answered with a JSON-RPC error.
    Rpc { code: i64, message: String },
    /// The daemon sent something this client does not understand, or closed
    /// the connection mid-request.
    Protocol(String),
}

impl fmt::Display for ClientError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unavailable(m) => f.write_str(m),
            Self::Io(e) => write!(f, "{e}"),
            Self::Rpc { message, .. } => f.write_str(message),
            Self::Protocol(m) => write!(f, "protocol error: {m}"),
        }
    }
}

impl std::error::Error for ClientError {}

impl From<io::Error> for ClientError {
    fn from(e: io::Error) -> Self {
        Self::Io(e)
    }
}

/// JSON-RPC "method not found": the daemon predates that method.
pub const METHOD_NOT_FOUND: i64 = -32601;

/// `bus.list` params.
fn bus_list_params(run_id: &str) -> Value {
    json!({ "runId": run_id })
}

/// What a probe call says about a method: anything but "method not found"
/// (typically -32602, invalid params, since the probe sends none) means the
/// daemon serves it. `None`: the call failed for another reason.
fn served(result: &Result<Value, ClientError>) -> Option<bool> {
    match result {
        Ok(_) => Some(true),
        Err(ClientError::Rpc { code, .. }) => Some(*code != METHOD_NOT_FOUND),
        Err(_) => None,
    }
}

/// `runs.events` params: the page after `since_seq` (from the start when
/// `None`), at most `limit` events.
fn run_events_params(run_id: &str, since_seq: Option<i64>, limit: u32) -> Value {
    let mut params = json!({ "runId": run_id, "limit": limit });
    if let Some(since) = since_seq {
        params["sinceSeq"] = since.into();
    }
    params
}

/// `bus.post` params. `to` is passed through as the daemon's `BusEndpoint`
/// (`{kind: "session", sessionId}`, `{kind: "role", role}`, `{kind: "run"}`);
/// without it, `in_reply_to` answers that message's sender. A blank subject
/// is left out.
pub fn bus_post_params(
    run_id: &str,
    to: Option<Value>,
    body: &str,
    subject: Option<&str>,
    in_reply_to: Option<i64>,
) -> Value {
    let mut params = json!({ "runId": run_id, "body": body });
    if let Some(to) = to.filter(|t| !t.is_null()) {
        params["to"] = to;
    }
    if let Some(subject) = subject.map(str::trim).filter(|s| !s.is_empty()) {
        params["subject"] = subject.into();
    }
    if let Some(id) = in_reply_to {
        params["inReplyTo"] = id.into();
    }
    params
}

/// `events.subscribe` params: replay from `since` (else only new events),
/// limited to `run_id` when given.
fn subscribe_params(since: Option<i64>, run_id: Option<&str>) -> Value {
    let mut params = json!({});
    if let Some(since) = since {
        params["since"] = since.into();
    }
    if let Some(run_id) = run_id {
        params["runId"] = run_id.into();
    }
    params
}

fn protocol(e: serde_json::Error) -> ClientError {
    ClientError::Protocol(e.to_string())
}

/// What a Tauri command returns to the frontend on failure.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    /// JSON-RPC error code, when the daemon answered with an error.
    pub code: Option<i64>,
    pub message: String,
    /// `true` when the daemon could not be reached at all.
    pub unavailable: bool,
}

impl From<ClientError> for CommandError {
    fn from(e: ClientError) -> Self {
        let code = match &e {
            ClientError::Rpc { code, .. } => Some(*code),
            _ => None,
        };
        let unavailable = matches!(e, ClientError::Unavailable(_));
        Self {
            code,
            message: e.to_string(),
            unavailable,
        }
    }
}

/// Builds one request line (with the trailing newline).
pub(crate) fn request_line(id: u64, method: &str, params: &Value) -> Result<Vec<u8>, ClientError> {
    let mut request = json!({ "jsonrpc": "2.0", "id": id, "method": method });
    if !params.is_null() {
        request["params"] = params.clone();
    }
    let mut line = serde_json::to_vec(&request).map_err(protocol)?;
    line.push(b'\n');
    Ok(line)
}

/// Builds one notification line (a request without `id`: no response), with
/// the trailing newline.
pub(crate) fn notification_line(method: &str, params: &Value) -> Result<Vec<u8>, ClientError> {
    let mut line =
        serde_json::to_vec(&json!({ "jsonrpc": "2.0", "method": method, "params": params }))
            .map_err(protocol)?;
    line.push(b'\n');
    Ok(line)
}

/// Interprets one line read while waiting for the response to request `id`.
/// `None` means "not ours, keep reading" (a notification or another id).
pub(crate) fn parse_response(line: &str, id: u64) -> Option<Result<Value, ClientError>> {
    let value: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => return Some(Err(protocol(e))),
    };
    if value.get("id").and_then(Value::as_u64) != Some(id) {
        return None;
    }
    if let Some(error) = value.get("error") {
        let code = error.get("code").and_then(Value::as_i64).unwrap_or(0);
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown error")
            .to_string();
        return Some(Err(ClientError::Rpc { code, message }));
    }
    Some(Ok(value.get("result").cloned().unwrap_or(Value::Null)))
}

/// What a subscription delivers.
#[derive(Debug, Clone, PartialEq)]
pub enum Notice {
    /// One event's params (`{seq, at, runId, kind, ...}`).
    Event(Value),
    /// The replay of stored events is over; `seq` is the newest event in the
    /// log when it was read. Everything after it is live.
    ReplayDone { seq: i64 },
}

/// Extracts a subscription notice from a line; `None` for anything else.
fn parse_notice(line: &str) -> Result<Option<Notice>, ClientError> {
    let mut value: Value = serde_json::from_str(line).map_err(protocol)?;
    let params = value.get_mut("params").map(Value::take);
    match value.get("method").and_then(Value::as_str) {
        Some(method::EVENT) => match params {
            Some(params @ Value::Object(_)) => Ok(Some(Notice::Event(params))),
            _ => Err(ClientError::Protocol("event without params".into())),
        },
        Some(method::REPLAY_DONE) => {
            let seq = params
                .as_ref()
                .and_then(|p| p.get("seq"))
                .and_then(Value::as_i64)
                .ok_or_else(|| ClientError::Protocol("replay_done without seq".into()))?;
            Ok(Some(Notice::ReplayDone { seq }))
        }
        _ => Ok(None),
    }
}

#[cfg(unix)]
mod imp {
    use super::*;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
    use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
    use tokio::net::UnixStream;

    /// One connection; requests are sent one at a time.
    pub struct Client {
        lines: Lines<BufReader<OwnedReadHalf>>,
        writer: OwnedWriteHalf,
        next_id: u64,
    }

    impl Client {
        pub async fn connect(socket: &Path) -> Result<Self, ClientError> {
            let stream = UnixStream::connect(socket).await.map_err(|e| {
                ClientError::Unavailable(format!(
                    "cannot connect to agentuxd at {}: {e}",
                    socket.display()
                ))
            })?;
            let (reader, writer) = stream.into_split();
            Ok(Self {
                lines: BufReader::new(reader).lines(),
                writer,
                next_id: 1,
            })
        }

        /// Sends one request and waits for its response. `params` may be
        /// `Value::Null` for methods without parameters.
        pub async fn call(&mut self, method: &str, params: Value) -> Result<Value, ClientError> {
            let id = self.next_id;
            self.next_id += 1;
            let line = request_line(id, method, &params)?;
            self.writer.write_all(&line).await?;
            loop {
                let line = self.lines.next_line().await?.ok_or_else(|| {
                    ClientError::Protocol("the daemon closed the connection".into())
                })?;
                if let Some(result) = parse_response(&line, id) {
                    return result;
                }
            }
        }

        /// A run's agent bus log, oldest first (`bus.list`). Daemons before
        /// agentux-core 0.2.0 do not serve it: their runs have an empty log.
        pub async fn list_bus(&mut self, run_id: &str) -> Result<Value, ClientError> {
            match self.call(method::BUS_LIST, bus_list_params(run_id)).await {
                Err(ClientError::Rpc { code, .. }) if code == METHOD_NOT_FOUND => Ok(json!([])),
                other => other,
            }
        }

        /// One page of a run's stored events (`runs.events`):
        /// `{ events, more, headSeq }`. -32601 from daemons before
        /// agentux-core #9.
        pub async fn run_events(
            &mut self,
            run_id: &str,
            since_seq: Option<i64>,
            limit: u32,
        ) -> Result<Value, ClientError> {
            self.call(method::RUNS_EVENTS, run_events_params(run_id, since_seq, limit))
                .await
        }

        /// Whether the daemon serves `method`, by calling it with empty
        /// params. Only for methods that refuse those (-32602) without side
        /// effects.
        pub async fn serves(&mut self, method: &str) -> Result<bool, ClientError> {
            let result = self.call(method, json!({})).await;
            match served(&result) {
                Some(yes) => Ok(yes),
                None => result.map(|_| true),
            }
        }

        /// Turns this connection into an event stream. `since` replays stored
        /// events with a greater `seq` first; `None` streams only new events.
        /// `run_id` limits the stream to one run. Returns the daemon's newest
        /// `seq` at subscription time.
        pub async fn subscribe(
            mut self,
            since: Option<i64>,
            run_id: Option<&str>,
        ) -> Result<(i64, Subscription), ClientError> {
            let params = subscribe_params(since, run_id);
            let result = self.call(method::EVENTS_SUBSCRIBE, params).await?;
            let seq = result
                .get("seq")
                .and_then(Value::as_i64)
                .ok_or_else(|| ClientError::Protocol("events.subscribe returned no seq".into()))?;
            Ok((seq, Subscription { client: self }))
        }
    }

    pub struct Subscription {
        client: Client,
    }

    impl Subscription {
        /// The next event or replay marker, or `None` when the daemon closes
        /// the connection.
        pub async fn next_notice(&mut self) -> Result<Option<Notice>, ClientError> {
            while let Some(line) = self.client.lines.next_line().await? {
                if let Some(notice) = parse_notice(&line)? {
                    return Ok(Some(notice));
                }
            }
            Ok(None)
        }

        /// The next event's params (`{seq, at, runId, kind, ...}`), skipping
        /// the replay marker, or `None` when the daemon closes the connection.
        pub async fn next(&mut self) -> Result<Option<Value>, ClientError> {
            loop {
                match self.next_notice().await? {
                    Some(Notice::Event(event)) => return Ok(Some(event)),
                    Some(Notice::ReplayDone { .. }) => continue,
                    None => return Ok(None),
                }
            }
        }
    }
}

#[cfg(not(unix))]
mod imp {
    //! `agentuxd` only listens on a Unix socket; elsewhere every connection
    //! fails and the cockpit falls back to mock data.
    use super::*;

    const UNSUPPORTED: &str = "agentuxd is only reachable over a Unix socket on this platform";

    pub struct Client;

    impl Client {
        pub async fn connect(_socket: &Path) -> Result<Self, ClientError> {
            Err(ClientError::Unavailable(UNSUPPORTED.into()))
        }

        pub async fn call(&mut self, _method: &str, _params: Value) -> Result<Value, ClientError> {
            Err(ClientError::Unavailable(UNSUPPORTED.into()))
        }

        pub async fn list_bus(&mut self, _run_id: &str) -> Result<Value, ClientError> {
            Err(ClientError::Unavailable(UNSUPPORTED.into()))
        }

        pub async fn serves(&mut self, _method: &str) -> Result<bool, ClientError> {
            Err(ClientError::Unavailable(UNSUPPORTED.into()))
        }

        pub async fn run_events(
            &mut self,
            _run_id: &str,
            _since_seq: Option<i64>,
            _limit: u32,
        ) -> Result<Value, ClientError> {
            Err(ClientError::Unavailable(UNSUPPORTED.into()))
        }

        pub async fn subscribe(
            self,
            _since: Option<i64>,
            _run_id: Option<&str>,
        ) -> Result<(i64, Subscription), ClientError> {
            Err(ClientError::Unavailable(UNSUPPORTED.into()))
        }
    }

    pub struct Subscription;

    impl Subscription {
        pub async fn next_notice(&mut self) -> Result<Option<Notice>, ClientError> {
            Ok(None)
        }

        pub async fn next(&mut self) -> Result<Option<Value>, ClientError> {
            Ok(None)
        }
    }
}

pub use imp::{Client, Subscription};

/// Whether `result` is the daemon saying it does not know the method.
pub fn is_method_not_found<T>(result: &Result<T, ClientError>) -> bool {
    matches!(result, Err(ClientError::Rpc { code, .. }) if *code == METHOD_NOT_FOUND)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_lines_omit_null_params() {
        let line = request_line(3, "projects.list", &Value::Null).unwrap();
        assert_eq!(line.last(), Some(&b'\n'));
        let value: Value = serde_json::from_slice(&line).unwrap();
        assert_eq!(
            value,
            json!({"jsonrpc": "2.0", "id": 3, "method": "projects.list"})
        );
        let line = request_line(4, "runs.cancel", &json!({"runId": "ab"})).unwrap();
        let value: Value = serde_json::from_slice(&line).unwrap();
        assert_eq!(value["params"]["runId"], "ab");
    }

    #[test]
    fn bus_list_names_the_run() {
        assert_eq!(bus_list_params("r1"), json!({"runId": "r1"}));
    }

    #[test]
    fn a_method_is_served_unless_the_daemon_does_not_know_it() {
        let rpc = |code| {
            Err(ClientError::Rpc {
                code,
                message: "x".into(),
            })
        };
        assert_eq!(served(&rpc(METHOD_NOT_FOUND)), Some(false));
        assert_eq!(served(&rpc(-32602)), Some(true));
        assert_eq!(served(&Ok(json!(null))), Some(true));
        assert_eq!(served(&Err(ClientError::Protocol("closed".into()))), None);
    }

    #[test]
    fn subscribe_params_name_since_and_run() {
        assert_eq!(subscribe_params(None, None), json!({}));
        assert_eq!(
            subscribe_params(Some(0), Some("r1")),
            json!({"since": 0, "runId": "r1"})
        );
    }

    #[test]
    fn responses_are_matched_by_id() {
        assert!(parse_response(r#"{"jsonrpc":"2.0","method":"event","params":{}}"#, 1).is_none());
        assert!(parse_response(r#"{"jsonrpc":"2.0","id":2,"result":[]}"#, 1).is_none());
        let ok = parse_response(r#"{"jsonrpc":"2.0","id":1,"result":[1]}"#, 1).unwrap();
        assert_eq!(ok.unwrap(), json!([1]));
        let err = parse_response(
            r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32002,"message":"not pending"}}"#,
            1,
        )
        .unwrap()
        .unwrap_err();
        let err = CommandError::from(err);
        assert_eq!(err.code, Some(-32002));
        assert_eq!(err.message, "not pending");
        assert!(!err.unavailable);
    }

    #[test]
    fn events_keep_unknown_fields() {
        let line = r#"{"jsonrpc":"2.0","method":"event","params":{"seq":9,"kind":"session","session":{"id":"s1"}}}"#;
        let Some(Notice::Event(event)) = parse_notice(line).unwrap() else {
            panic!("not an event");
        };
        assert_eq!(event["kind"], "session");
        assert_eq!(event["session"]["id"], "s1");
        assert!(parse_notice(r#"{"jsonrpc":"2.0","method":"other","params":{}}"#)
            .unwrap()
            .is_none());
        assert!(parse_notice("not json").is_err());
    }

    #[test]
    fn the_replay_marker_is_a_notice() {
        let line = r#"{"jsonrpc":"2.0","method":"replay_done","params":{"seq":57}}"#;
        assert_eq!(
            parse_notice(line).unwrap(),
            Some(Notice::ReplayDone { seq: 57 })
        );
        assert!(parse_notice(r#"{"jsonrpc":"2.0","method":"replay_done","params":{}}"#).is_err());
    }

    #[test]
    fn run_events_params_page_after_a_seq() {
        assert_eq!(
            run_events_params("r1", None, 1000),
            json!({"runId": "r1", "limit": 1000})
        );
        assert_eq!(
            run_events_params("r1", Some(11), 10),
            json!({"runId": "r1", "limit": 10, "sinceSeq": 11})
        );
    }

    #[test]
    fn bus_post_params_leave_out_what_is_not_given() {
        assert_eq!(
            bus_post_params("r1", Some(json!({"kind": "run"})), "hi", Some("  "), None),
            json!({"runId": "r1", "to": {"kind": "run"}, "body": "hi"})
        );
        assert_eq!(
            bus_post_params("r1", None, "Thanks", Some("Re: plan"), Some(5)),
            json!({"runId": "r1", "body": "Thanks", "subject": "Re: plan", "inReplyTo": 5})
        );
        assert_eq!(
            bus_post_params("r1", Some(Value::Null), "x", None, Some(2)),
            json!({"runId": "r1", "body": "x", "inReplyTo": 2})
        );
    }
}
