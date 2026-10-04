//! Keeps one event subscription to `agentuxd` alive: subscribes, forwards every
//! event, and when the daemon goes away reconnects with exponential backoff,
//! resuming from the last `seq` it forwarded so nothing is missed or repeated.
//! Independent of Tauri so it can be tested against a fake daemon.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

use super::client::{Client, ClientError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkState {
    Connecting,
    Connected,
    Disconnected,
}

/// Connection state reported to the frontend (`daemon://status`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub state: LinkState,
    /// Socket path in use, if one could be determined.
    pub socket: Option<String>,
    /// Human-readable detail: the error, or what is connected.
    pub detail: String,
    /// Highest event `seq` forwarded so far.
    pub last_seq: Option<i64>,
    /// When disconnected: how long until the next attempt.
    pub retry_in_ms: Option<u64>,
}

/// Where the stream delivers what it sees.
pub trait Sink {
    fn status(&mut self, status: &Status);
    fn event(&mut self, event: Value);
}

#[derive(Debug, Clone)]
pub struct Backoff {
    min: Duration,
    max: Duration,
    next: Duration,
}

impl Backoff {
    pub fn new(min: Duration, max: Duration) -> Self {
        Self { min, max, next: min }
    }

    /// The delay to wait now; doubles the following one up to `max`.
    pub fn next_delay(&mut self) -> Duration {
        let delay = self.next;
        self.next = (self.next * 2).min(self.max);
        delay
    }

    pub fn reset(&mut self) {
        self.next = self.min;
    }
}

impl Default for Backoff {
    fn default() -> Self {
        Self::new(Duration::from_millis(500), Duration::from_secs(15))
    }
}

/// How one connection ended.
#[derive(Debug)]
pub enum Ended {
    /// The daemon closed the connection after it was established.
    Closed,
    /// Connecting, subscribing or reading failed. `connected` tells whether
    /// the subscription had been established before the failure.
    Failed { error: ClientError, connected: bool },
}

fn status(socket: &Path, state: LinkState, detail: String, last_seq: Option<i64>) -> Status {
    Status {
        state,
        socket: Some(socket.display().to_string()),
        detail,
        last_seq,
        retry_in_ms: None,
    }
}

/// Runs one connection: subscribe from `last_seq`, forward events until the
/// daemon closes the stream or an error occurs. `last_seq` is advanced past
/// every forwarded event, so the next call resumes where this one stopped.
pub async fn follow_once(socket: &Path, last_seq: &mut Option<i64>, sink: &mut impl Sink) -> Ended {
    let failed = |error, connected| Ended::Failed { error, connected };
    let mut sub = loop {
        let client = match Client::connect(socket).await {
            Ok(c) => c,
            Err(e) => return failed(e, false),
        };
        let (head, sub) = match client.subscribe(*last_seq, None).await {
            Ok(s) => s,
            Err(e) => return failed(e, false),
        };
        match *last_seq {
            // First connection: only events from now on; the frontend loads
            // the current state with list calls.
            None => *last_seq = Some(head),
            // The daemon's event log is behind what we saw: its store was
            // reset. Resubscribe from its head instead of waiting for seqs
            // that will never come.
            Some(seen) if head < seen => {
                *last_seq = Some(head);
                continue;
            }
            Some(_) => {}
        }
        break sub;
    };
    sink.status(&status(
        socket,
        LinkState::Connected,
        format!("connected to agentuxd at {}", socket.display()),
        *last_seq,
    ));
    loop {
        match sub.next().await {
            Ok(Some(event)) => {
                if let Some(seq) = event.get("seq").and_then(Value::as_i64) {
                    if last_seq.is_some_and(|seen| seq <= seen) {
                        continue; // already forwarded
                    }
                    *last_seq = Some(seq);
                }
                sink.event(event);
            }
            Ok(None) => return Ended::Closed,
            Err(e) => return failed(e, true),
        }
    }
}

/// Follows the daemon forever, reconnecting with `backoff` while it is down.
/// `stop` is checked between connections (tests use it to end the loop).
pub async fn follow(
    socket: &Path,
    mut backoff: Backoff,
    sink: &mut impl Sink,
    mut stop: impl FnMut() -> bool,
) {
    let mut last_seq = None;
    while !stop() {
        sink.status(&status(
            socket,
            LinkState::Connecting,
            format!("connecting to agentuxd at {}", socket.display()),
            last_seq,
        ));
        let detail = match follow_once(socket, &mut last_seq, sink).await {
            Ended::Closed => {
                backoff.reset();
                "agentuxd closed the connection".to_string()
            }
            Ended::Failed { error, connected } => {
                if connected {
                    backoff.reset();
                }
                error.to_string()
            }
        };
        if stop() {
            break;
        }
        let delay = backoff.next_delay();
        let mut st = status(socket, LinkState::Disconnected, detail, last_seq);
        st.retry_in_ms = Some(delay.as_millis() as u64);
        sink.status(&st);
        tokio::time::sleep(delay).await;
    }
}

/// A run's stored events, oldest first, as `{ head, events }`: subscribes to
/// the run from the start and collects the replayed backlog. `head` is the
/// daemon's newest seq at subscription time. The daemon does not mark the end
/// of a replay, so collection stops at the first event past `head` (a live
/// one), when `head` itself arrives, or once no event came for `idle`
/// (the backlog is written in one go, so a pause means it is over).
pub async fn run_history(
    socket: &Path,
    run_id: &str,
    idle: Duration,
) -> Result<Value, ClientError> {
    let client = Client::connect(socket).await?;
    let (head, mut sub) = client.subscribe(Some(0), Some(run_id)).await?;
    let mut events = Vec::new();
    loop {
        let next = match tokio::time::timeout(idle, sub.next()).await {
            Err(_) => break,
            Ok(next) => next?,
        };
        let Some(event) = next else { break };
        let seq = event.get("seq").and_then(Value::as_i64).unwrap_or(i64::MAX);
        if seq > head {
            break;
        }
        events.push(event);
        if seq == head {
            break;
        }
    }
    Ok(json!({ "head": head, "events": events }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_doubles_up_to_max_and_resets() {
        let mut b = Backoff::new(Duration::from_millis(100), Duration::from_millis(350));
        let delays: Vec<u64> = (0..4).map(|_| b.next_delay().as_millis() as u64).collect();
        assert_eq!(delays, [100, 200, 350, 350]);
        b.reset();
        assert_eq!(b.next_delay(), Duration::from_millis(100));
    }
}

/// Tests against a fake `agentuxd` on a temporary Unix socket.
#[cfg(all(test, unix))]
mod socket_tests {
    use super::*;
    use crate::daemon::client::{method, Client};
    use serde_json::json;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::UnixListener;

    fn temp_socket() -> PathBuf {
        static N: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "cockpit-test-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("agentuxd.sock");
        let _ = std::fs::remove_file(&path);
        path
    }

    /// One accepted connection of the fake daemon.
    struct Conn {
        lines: tokio::io::Lines<BufReader<tokio::net::unix::OwnedReadHalf>>,
        writer: tokio::net::unix::OwnedWriteHalf,
    }

    impl Conn {
        async fn accept(listener: &UnixListener) -> Self {
            let (stream, _) = listener.accept().await.unwrap();
            let (r, writer) = stream.into_split();
            Self {
                lines: BufReader::new(r).lines(),
                writer,
            }
        }

        async fn request(&mut self) -> Value {
            let line = self.lines.next_line().await.unwrap().expect("a request");
            serde_json::from_str(&line).unwrap()
        }

        async fn send(&mut self, value: Value) {
            let mut line = serde_json::to_vec(&value).unwrap();
            line.push(b'\n');
            self.writer.write_all(&line).await.unwrap();
        }

        async fn event(&mut self, seq: i64) {
            self.send(json!({
                "jsonrpc": "2.0",
                "method": method::EVENT,
                "params": {"seq": seq, "at": 1, "runId": "r1", "kind": "log", "text": format!("e{seq}")}
            }))
            .await;
        }
    }

    #[derive(Default)]
    struct Recorder {
        statuses: Vec<Status>,
        seqs: Vec<i64>,
    }

    impl Sink for Recorder {
        fn status(&mut self, status: &Status) {
            self.statuses.push(status.clone());
        }
        fn event(&mut self, event: Value) {
            self.seqs.push(event["seq"].as_i64().unwrap());
        }
    }

    #[tokio::test]
    async fn call_returns_results_and_errors() {
        let path = temp_socket();
        let listener = UnixListener::bind(&path).unwrap();
        let server = tokio::spawn(async move {
            let mut conn = Conn::accept(&listener).await;
            let req = conn.request().await;
            assert_eq!(req["method"], "projects.list");
            assert!(req.get("params").is_none());
            // A stray notification before the response must be skipped.
            conn.event(1).await;
            conn.send(json!({"jsonrpc": "2.0", "id": req["id"], "result": [{"id": "p1"}]}))
                .await;
            let req = conn.request().await;
            assert_eq!(req["params"], json!({"requestId": "q1"}));
            conn.send(json!({"jsonrpc": "2.0", "id": req["id"],
                "error": {"code": -32002, "message": "request q1 is not pending"}}))
                .await;
        });

        let mut client = Client::connect(&path).await.unwrap();
        let projects = client.call("projects.list", Value::Null).await.unwrap();
        assert_eq!(projects, json!([{"id": "p1"}]));
        let err = client
            .call("requests.approve", json!({"requestId": "q1"}))
            .await
            .unwrap_err();
        match err {
            ClientError::Rpc { code, message } => {
                assert_eq!(code, -32002);
                assert_eq!(message, "request q1 is not pending");
            }
            other => panic!("unexpected {other:?}"),
        }
        server.await.unwrap();
    }

    #[tokio::test]
    async fn connect_to_missing_socket_is_unavailable() {
        let path = temp_socket();
        match Client::connect(&path).await {
            Err(ClientError::Unavailable(m)) => assert!(m.contains("agentuxd.sock")),
            Err(e) => panic!("unexpected {e:?}"),
            Ok(_) => panic!("connected to a missing socket"),
        }
    }

    #[tokio::test]
    async fn stream_resumes_from_last_seq_after_reconnect() {
        let path = temp_socket();
        let listener = UnixListener::bind(&path).unwrap();
        let server = tokio::spawn(async move {
            // First connection: no `since`, head is 5; two events, then the
            // daemon goes away.
            let mut conn = Conn::accept(&listener).await;
            let req = conn.request().await;
            assert_eq!(req["method"], method::EVENTS_SUBSCRIBE);
            assert_eq!(req["params"], json!({}));
            conn.send(json!({"jsonrpc": "2.0", "id": req["id"], "result": {"seq": 5}}))
                .await;
            conn.event(6).await;
            conn.event(7).await;
            drop(conn);

            // Reconnect: must resume after 7. Replay includes a duplicate (7)
            // that must not be forwarded twice.
            let mut conn = Conn::accept(&listener).await;
            let req = conn.request().await;
            assert_eq!(req["params"], json!({"since": 7}));
            conn.send(json!({"jsonrpc": "2.0", "id": req["id"], "result": {"seq": 8}}))
                .await;
            conn.event(7).await;
            conn.event(8).await;
            conn.event(9).await;
            drop(conn);
            listener
        });

        let mut sink = Recorder::default();
        let backoff = Backoff::new(Duration::from_millis(10), Duration::from_millis(20));
        // `stop` is checked before and after each connection: stop on the
        // check that follows the second connection.
        let mut checks = 0;
        follow(&path, backoff, &mut sink, || {
            checks += 1;
            checks == 4
        })
        .await;
        let _listener = server.await.unwrap();

        assert_eq!(sink.seqs, [6, 7, 8, 9]);
        let connected: Vec<_> = sink
            .statuses
            .iter()
            .filter(|s| s.state == LinkState::Connected)
            .map(|s| s.last_seq)
            .collect();
        assert_eq!(connected, [Some(5), Some(7)]);
    }

    #[tokio::test]
    async fn stream_reports_disconnected_with_retry_when_daemon_is_down() {
        let path = temp_socket();
        let mut sink = Recorder::default();
        let backoff = Backoff::new(Duration::from_millis(5), Duration::from_millis(10));
        // Two `stop` checks per attempt: stop before the fourth attempt.
        let mut checks = 0;
        follow(&path, backoff, &mut sink, || {
            checks += 1;
            checks > 6
        })
        .await;
        let retries: Vec<_> = sink
            .statuses
            .iter()
            .filter(|s| s.state == LinkState::Disconnected)
            .map(|s| s.retry_in_ms)
            .collect();
        assert_eq!(retries, [Some(5), Some(10), Some(10)]);
        assert!(sink.seqs.is_empty());
    }

    #[tokio::test]
    async fn stream_resubscribes_when_daemon_log_was_reset() {
        let path = temp_socket();
        let listener = UnixListener::bind(&path).unwrap();
        let server = tokio::spawn(async move {
            let mut conn = Conn::accept(&listener).await;
            let req = conn.request().await;
            assert_eq!(req["params"], json!({"since": 40}));
            // A fresh daemon store: head is far behind what the client saw.
            conn.send(json!({"jsonrpc": "2.0", "id": req["id"], "result": {"seq": 2}}))
                .await;
            let mut conn = Conn::accept(&listener).await;
            let req = conn.request().await;
            assert_eq!(req["params"], json!({"since": 2}));
            conn.send(json!({"jsonrpc": "2.0", "id": req["id"], "result": {"seq": 2}}))
                .await;
            conn.event(3).await;
        });

        let mut sink = Recorder::default();
        let mut last_seq = Some(40);
        let ended = follow_once(&path, &mut last_seq, &mut sink).await;
        assert!(matches!(ended, Ended::Closed), "{ended:?}");
        assert_eq!(sink.seqs, [3]);
        assert_eq!(last_seq, Some(3));
        server.await.unwrap();
    }
    #[tokio::test]
    async fn run_history_collects_the_backlog_up_to_head() {
        let path = temp_socket();
        let listener = UnixListener::bind(&path).unwrap();
        let server = tokio::spawn(async move {
            // Head reached: stops at seq == head.
            let mut conn = Conn::accept(&listener).await;
            let req = conn.request().await;
            assert_eq!(req["method"], method::EVENTS_SUBSCRIBE);
            assert_eq!(req["params"], json!({"since": 0, "runId": "r1"}));
            conn.send(json!({"jsonrpc": "2.0", "id": req["id"], "result": {"seq": 7}}))
                .await;
            conn.event(3).await;
            conn.event(7).await;

            // The run's last event is older than head: stops when idle.
            let mut conn = Conn::accept(&listener).await;
            let req = conn.request().await;
            conn.send(json!({"jsonrpc": "2.0", "id": req["id"], "result": {"seq": 9}}))
                .await;
            conn.event(2).await;
            // Keep the connection open past the idle timeout.
            tokio::time::sleep(Duration::from_millis(300)).await;
            drop(conn);

            // A live event past head ends it too.
            let mut conn = Conn::accept(&listener).await;
            let req = conn.request().await;
            conn.send(json!({"jsonrpc": "2.0", "id": req["id"], "result": {"seq": 4}}))
                .await;
            conn.event(1).await;
            conn.event(5).await;
        });

        let seqs = |v: &Value| -> Vec<i64> {
            v["events"]
                .as_array()
                .unwrap()
                .iter()
                .map(|e| e["seq"].as_i64().unwrap())
                .collect()
        };
        let idle = Duration::from_millis(100);
        let h = run_history(&path, "r1", idle).await.unwrap();
        assert_eq!((h["head"].as_i64(), seqs(&h)), (Some(7), vec![3, 7]));
        let h = run_history(&path, "r1", idle).await.unwrap();
        assert_eq!((h["head"].as_i64(), seqs(&h)), (Some(9), vec![2]));
        let h = run_history(&path, "r1", idle).await.unwrap();
        assert_eq!((h["head"].as_i64(), seqs(&h)), (Some(4), vec![1]));
        server.await.unwrap();
    }
}
