//! Which AgentUX Command server Office opens: what someone typed made into a
//! server address, the check that the address is a Command server, where
//! the choice is kept, and where the window may go.

use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::Url;

/// The product a Command server names in `GET /v1/instance`.
const PRODUCT: &str = "agentux-command";

/// The server's address (scheme, host and port, path `/`) from what someone
/// typed: `command.example.com`, `https://command.example.com/office/`.
/// HTTPS only, except on this machine.
pub fn normalize(input: &str) -> Result<Url, String> {
    let input = input.trim();
    if input.is_empty() {
        return Err("Type the address of your AgentUX Command server.".into());
    }
    let with_scheme = if input.contains("://") {
        input.to_string()
    } else {
        format!("https://{input}")
    };
    let mut url =
        Url::parse(&with_scheme).map_err(|e| format!("{input} is not an address: {e}"))?;
    match url.scheme() {
        "https" => {}
        "http" if is_loopback(&url) => {}
        "http" => {
            return Err(
                "Command must be reached over HTTPS (plain HTTP only on this machine).".into(),
            )
        }
        other => return Err(format!("{other}: is not a web address.")),
    }
    if url.host_str().unwrap_or_default().is_empty() {
        return Err(format!("{input} has no server name."));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Leave the user name and password out of the address.".into());
    }
    // Office lives at /office/ on Command's own origin, and calls Command's
    // API from the root: only the origin matters.
    let path = url.path().trim_end_matches('/');
    if !(path.is_empty() || path == "/office") {
        return Err(format!(
            "Command is served at the root of its address, not under {}.",
            url.path()
        ));
    }
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn is_loopback(url: &Url) -> bool {
    matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    )
}

/// Where Office is on `server`.
pub fn office_url(server: &Url) -> Url {
    server.join("office/").expect("a relative path joins")
}

/// What `GET /v1/instance` answers.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Instance {
    product: String,
    instance_id: String,
}

/// The instance id in a `GET /v1/instance` answer, when it is a Command
/// server's.
pub fn check_instance(body: &[u8]) -> Result<String, String> {
    let instance: Instance = serde_json::from_slice(body)
        .map_err(|_| "This is not an AgentUX Command server.".to_string())?;
    if instance.product != PRODUCT {
        return Err(format!(
            "This is not an AgentUX Command server ({}).",
            instance.product
        ));
    }
    if instance.instance_id.trim().is_empty() {
        return Err("The server did not say which Command instance it is.".into());
    }
    Ok(instance.instance_id)
}

/// Asks `server` who it is: its instance id, when it is a Command server.
/// Blocking; at most ten seconds.
pub fn fetch_instance(server: &Url) -> Result<String, String> {
    let url = server.join("v1/instance").expect("a relative path joins");
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(10)))
        .build()
        .into();
    let mut response = agent.get(url.as_str()).call().map_err(|e| match e {
        ureq::Error::StatusCode(status) => {
            format!("{server} answered {status}: is this an AgentUX Command server?")
        }
        other => format!("Cannot reach {server}: {other}"),
    })?;
    let body = response
        .body_mut()
        .with_config()
        .limit(64 * 1024)
        .read_to_vec()
        .map_err(|e| format!("Cannot read {server}'s answer: {e}"))?;
    check_instance(&body)
}

/// The server someone chose, kept in Office's config directory.
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct Saved {
    pub server: String,
}

/// The `server = <address>` line of the system default
/// (`/etc/agentux/office.conf`, set when the machine is provisioned).
pub fn parse_conf(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.starts_with('#'))
        .filter_map(|line| line.split_once('='))
        .find(|(key, _)| key.trim() == "server")
        .map(|(_, value)| value.trim().trim_matches('"').to_string())
        .filter(|value| !value.is_empty())
}

/// Whether the window may go to `url`: Office's own setup page, HTTPS (the
/// server, and its sign-in provider), and plain HTTP only on this machine.
pub fn may_navigate(url: &Url) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "https" => true,
        "http" => is_loopback(url) || url.host_str() == Some("tauri.localhost"),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_addresses_become_the_server_origin() {
        for (typed, server) in [
            ("command.example.com", "https://command.example.com/"),
            (
                "  https://command.example.com  ",
                "https://command.example.com/",
            ),
            (
                "https://command.example.com/office/",
                "https://command.example.com/",
            ),
            (
                "https://command.example.com/office",
                "https://command.example.com/",
            ),
            (
                "https://command.example.com:8443/?x=1#y",
                "https://command.example.com:8443/",
            ),
            ("http://localhost:8080", "http://localhost:8080/"),
            ("http://127.0.0.1:8080/office/", "http://127.0.0.1:8080/"),
        ] {
            assert_eq!(normalize(typed).unwrap().as_str(), server, "{typed}");
        }
    }

    #[test]
    fn other_addresses_are_refused() {
        for typed in [
            "",
            "   ",
            "http://command.example.com",
            "ftp://command.example.com",
            "file:///etc/passwd",
            "https://user:secret@command.example.com",
            "https://command.example.com/some/prefix",
            "https://",
        ] {
            assert!(normalize(typed).is_err(), "{typed:?} was accepted");
        }
    }

    #[test]
    fn office_is_under_the_server() {
        let server = normalize("command.example.com").unwrap();
        assert_eq!(
            office_url(&server).as_str(),
            "https://command.example.com/office/"
        );
    }

    #[test]
    fn only_command_servers_pass() {
        assert_eq!(
            check_instance(
                br#"{"product":"agentux-command","instanceId":"cmd-1234","protocolVersions":["1"]}"#
            )
            .unwrap(),
            "cmd-1234"
        );
        assert!(check_instance(br#"{"product":"other","instanceId":"x"}"#).is_err());
        assert!(check_instance(br#"{"product":"agentux-command","instanceId":" "}"#).is_err());
        assert!(check_instance(b"<html>").is_err());
    }

    #[test]
    fn the_system_default_is_its_server_line() {
        let conf = "# AgentUX Office\n\nserver = \"https://command.example.com\"\nother=1\n";
        assert_eq!(
            parse_conf(conf).as_deref(),
            Some("https://command.example.com")
        );
        assert_eq!(parse_conf("#server=https://x\n"), None);
        assert_eq!(parse_conf("server=\n"), None);
        assert_eq!(parse_conf(""), None);
    }

    #[test]
    fn the_window_stays_on_the_web_and_its_own_page() {
        for (url, ok) in [
            ("tauri://localhost/index.html", true),
            ("http://tauri.localhost/index.html", true),
            ("https://command.example.com/office/", true),
            ("https://login.example.com/authorize", true),
            ("http://localhost:8080/office/", true),
            ("http://command.example.com/office/", false),
            ("file:///etc/passwd", false),
            ("javascript:alert(1)", false),
            ("data:text/html,hi", false),
        ] {
            assert_eq!(may_navigate(&Url::parse(url).unwrap()), ok, "{url}");
        }
    }
}
