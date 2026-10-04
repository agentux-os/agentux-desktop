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
    /// Server-to-client notification carrying one event.
    pub const EVENT: &str = "event";
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

/// Builds one request line (without the trailing newline).
fn request_line(id: u64, method: &str, params: &Value) -> Result<Vec<u8>, ClientError> {
    let mut request = json!({ "jsonrpc": "2.0", "id": id, "method": method });
    if !params.is_null() {
        request["params"] = params.clone();
    }
    let mut line = serde_json::to_vec(&request).map_err(protocol)?;
    line.push(b'\n');
    Ok(line)
}

/// Interprets one line read while waiting for the response to request `id`.
/// `None` means "not ours, keep reading" (a notification or another id).
fn parse_response(line: &str, id: u64) -> Option<Result<Value, ClientError>> {
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

/// Extracts the event from a notification line; `None` for anything else.
fn parse_event(line: &str) -> Result<Option<Value>, ClientError> {
    let mut value: Value = serde_json::from_str(line).map_err(protocol)?;
    if value.get("method").and_then(Value::as_str) != Some(method::EVENT) {
        return Ok(None);
    }
    match value.get_mut("params").map(Value::take) {
        Some(params @ Value::Object(_)) => Ok(Some(params)),
        _ => Err(ClientError::Protocol("event without params".into())),
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
        /// The next event's params (`{seq, at, runId, kind, ...}`), or `None`
        /// when the daemon closes the connection.
        pub async fn next(&mut self) -> Result<Option<Value>, ClientError> {
            while let Some(line) = self.client.lines.next_line().await? {
                if let Some(event) = parse_event(&line)? {
                    return Ok(Some(event));
                }
            }
            Ok(None)
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
        pub async fn next(&mut self) -> Result<Option<Value>, ClientError> {
            Ok(None)
        }
    }
}

pub use imp::{Client, Subscription};

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
        let event = parse_event(line).unwrap().unwrap();
        assert_eq!(event["kind"], "session");
        assert_eq!(event["session"]["id"], "s1");
        assert!(parse_event(r#"{"jsonrpc":"2.0","method":"other","params":{}}"#)
            .unwrap()
            .is_none());
        assert!(parse_event("not json").is_err());
    }
}
