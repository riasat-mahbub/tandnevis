//! System-browser OAuth with a loopback callback, PKCE, state, and OIDC nonce.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use sha2::Digest;
use std::{
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    time::{Duration, Instant},
};
use url::Url;
use uuid::Uuid;

const AUTHORIZE_URL: &str = "https://auth.openai.com/api/accounts/authorize";
const RESOURCE: &str = "https://api.openai.com/v1";
const CALLBACK_PATH: &str = "/auth/callback";
const SCOPES: &str =
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

pub struct AuthorizationAttempt {
    pub state: String,
    pub nonce: String,
    pub verifier: String,
    pub redirect_uri: String,
    pub existing_client_id: Option<String>,
    pub force_consent: bool,
}

pub struct AuthorizationCode {
    pub code: String,
    pub client_id: String,
    pub attempt: AuthorizationAttempt,
}

fn pkce_verifier() -> String {
    // Four UUIDv4 values produce 128 URL-safe characters, at the RFC 7636 maximum.
    format!(
        "{}{}{}{}",
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    )
}

pub fn build_authorization(
    attempt: &AuthorizationAttempt,
    host_id: &str,
    email: Option<&str>,
    id_token_hint: Option<&str>,
) -> Result<String, String> {
    let challenge = URL_SAFE_NO_PAD.encode(sha2::Sha256::digest(attempt.verifier.as_bytes()));
    let mut url =
        Url::parse(AUTHORIZE_URL).map_err(|_| "Could not prepare ChatGPT sign-in.".to_string())?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair(
            "client_id",
            attempt
                .existing_client_id
                .as_deref()
                .unwrap_or("dynamic_agent_client"),
        );
        if attempt.existing_client_id.is_none() {
            query.append_pair("agent_name_hint", "Shorthand Writer");
        }
        query.append_pair("ext_agent_host_id", host_id);
        if let Some(token) = id_token_hint {
            query.append_pair("id_token_hint", token);
        }
        if let Some(email) = email {
            query.append_pair("login_hint", email);
        }
        if attempt.force_consent {
            query.append_pair("prompt", "consent");
        }
        query.append_pair("response_type", "code");
        query.append_pair("redirect_uri", &attempt.redirect_uri);
        query.append_pair("scope", SCOPES);
        query.append_pair("resource", RESOURCE);
        query.append_pair("state", &attempt.state);
        query.append_pair("nonce", &attempt.nonce);
        query.append_pair("code_challenge_method", "S256");
        query.append_pair("code_challenge", &challenge);
    }
    Ok(url.into())
}

pub fn start(
    host_id: &str,
    existing_client_id: Option<String>,
    email: Option<&str>,
    id_token_hint: Option<&str>,
    force_consent: bool,
) -> Result<AuthorizationCode, String> {
    let local_uuid = host_id
        .strip_prefix("urn:uuid:")
        .and_then(|value| Uuid::parse_str(value).ok());
    if local_uuid.is_none() || host_id.len() > 64 {
        return Err("The local ChatGPT host identity is invalid.".into());
    }
    if existing_client_id
        .as_deref()
        .is_some_and(|id| !valid_client_id(id))
    {
        return Err("The saved ChatGPT registration is invalid. Reconnect in Settings.".into());
    }
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|_| "Could not start the local ChatGPT sign-in callback.".to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "Could not configure the ChatGPT sign-in callback.".to_string())?;
    let port = listener
        .local_addr()
        .map_err(|_| "Could not read the ChatGPT callback port.".to_string())?
        .port();
    let attempt = AuthorizationAttempt {
        state: Uuid::new_v4().simple().to_string(),
        nonce: Uuid::new_v4().simple().to_string(),
        verifier: pkce_verifier(),
        redirect_uri: format!("http://127.0.0.1:{port}{CALLBACK_PATH}"),
        existing_client_id,
        force_consent,
    };
    let url = build_authorization(&attempt, host_id, email, id_token_hint)?;
    open_system_browser(&url)?;
    let callback = wait_for_callback(listener, &attempt)?;
    let Some(code) = callback.code else {
        return Err(
            "ChatGPT plan access was not enabled. Reconnect in Settings and allow plan usage."
                .into(),
        );
    };
    let client_id = callback.client_id.ok_or_else(|| {
        "ChatGPT registration did not return a client ID. Try signing in again.".to_string()
    })?;
    Ok(AuthorizationCode {
        code,
        client_id,
        attempt,
    })
}

fn valid_client_id(value: &str) -> bool {
    (5..=200).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
        && value != "dynamic_agent_client"
}

struct Callback {
    code: Option<String>,
    client_id: Option<String>,
}

fn wait_for_callback(
    listener: TcpListener,
    attempt: &AuthorizationAttempt,
) -> Result<Callback, String> {
    let deadline = Instant::now() + Duration::from_secs(180);
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((stream, _address)) => {
                if let Some(callback) = handle_callback(stream, attempt)? {
                    return callback;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(40))
            }
            Err(_) => return Err("The ChatGPT sign-in callback was interrupted.".into()),
        }
    }
    Err("ChatGPT sign-in timed out. Try again in Settings.".into())
}

/// `Ok(None)` means this was an unrelated local request; keep the callback alive.
/// `Ok(Some(Ok(...)))` is a valid code; `Ok(Some(Err(...)))` is an OAuth denial.
fn handle_callback(
    stream: TcpStream,
    attempt: &AuthorizationAttempt,
) -> Result<Option<Result<Callback, String>>, String> {
    stream.set_read_timeout(Some(Duration::from_secs(3))).ok();
    let mut reader = BufReader::new(stream);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() || request_line.len() > 16_384 {
        return Ok(None);
    }
    let mut parts = request_line.split_whitespace();
    let (Some("GET"), Some(target), Some("HTTP/1.1" | "HTTP/1.0")) =
        (parts.next(), parts.next(), parts.next())
    else {
        return Ok(None);
    };
    let target = match Url::parse(&format!("http://127.0.0.1{target}")) {
        Ok(url) if url.path() == CALLBACK_PATH => url,
        _ => return Ok(None),
    };
    let mut stream = reader.into_inner();
    let mut values = std::collections::HashMap::new();
    for (name, value) in target.query_pairs().into_owned() {
        if values.insert(name, value).is_some() {
            respond(
                &mut stream,
                400,
                "The sign-in response was duplicated. Return to Shorthand Writer.",
            );
            return Ok(None);
        }
    }
    if values.get("state").map(String::as_str) != Some(attempt.state.as_str()) {
        respond(
            &mut stream,
            400,
            "This sign-in response was not recognized. Return to Shorthand Writer.",
        );
        return Ok(None);
    }
    if values.get("error").is_some() {
        respond(
            &mut stream,
            200,
            "Sign-in was not completed. You can close this window.",
        );
        return Ok(Some(Err("ChatGPT sign-in was not completed. Allow ChatGPT plan usage in the browser and try again.".into())));
    }
    let code = values
        .get("code")
        .filter(|code| {
            !code.is_empty()
                && code.len() <= 4096
                && code.bytes().all(|byte| byte.is_ascii_graphic())
        })
        .cloned();
    let returned_client_id = values.get("client_id").cloned();
    if returned_client_id
        .as_deref()
        .is_some_and(|id| !valid_client_id(id))
    {
        respond(&mut stream, 400, "The sign-in response did not contain a valid registration. Return to Shorthand Writer.");
        return Ok(None);
    }
    let client_id = match attempt.existing_client_id.as_ref() {
        Some(expected) => match returned_client_id {
            Some(actual) if &actual != expected => {
                respond(
                    &mut stream,
                    400,
                    "The selected ChatGPT registration did not match. Return to the app.",
                );
                return Ok(Some(Err(
                    "The ChatGPT account registration changed during sign-in.".into(),
                )));
            }
            _ => Some(expected.clone()),
        },
        None => returned_client_id,
    };
    if code.is_none() || client_id.is_none() {
        respond(
            &mut stream,
            400,
            "The sign-in response was incomplete. Return to Shorthand Writer and try again.",
        );
        return Ok(None);
    }
    respond(
        &mut stream,
        200,
        "Sign-in received. Return to Shorthand Writer.",
    );
    Ok(Some(Ok(Callback { code, client_id })))
}

fn respond(stream: &mut TcpStream, status: u16, message: &str) {
    let body = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>Shorthand Writer</title><p>{message}</p>"
    );
    let response = format!("HTTP/1.1 {status} OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}", body.len(), body);
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

#[cfg(windows)]
fn open_system_browser(url: &str) -> Result<(), String> {
    use windows::{
        core::PCWSTR,
        Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
    };
    let operation = "open"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let url = url
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR::from_raw(operation.as_ptr()),
            PCWSTR::from_raw(url.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if result.0 as usize > 32 {
        Ok(())
    } else {
        Err("Could not open the system browser for ChatGPT sign-in.".into())
    }
}

#[cfg(not(windows))]
fn open_system_browser(_url: &str) -> Result<(), String> {
    Err("ChatGPT sign-in is currently supported in the Windows desktop app.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_registration_requests_user_defined_client_and_plan_scopes() {
        let attempt = AuthorizationAttempt {
            state: "state".into(),
            nonce: "nonce".into(),
            verifier: "a".repeat(43),
            redirect_uri: "http://127.0.0.1:54321/auth/callback".into(),
            existing_client_id: None,
            force_consent: false,
        };
        let url = Url::parse(&build_authorization(&attempt, "urn:uuid:test", None, None).unwrap())
            .unwrap();
        let values = url
            .query_pairs()
            .into_owned()
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(
            values.get("client_id").map(String::as_str),
            Some("dynamic_agent_client")
        );
        assert_eq!(
            values.get("agent_name_hint").map(String::as_str),
            Some("Shorthand Writer")
        );
        assert!(values
            .get("scope")
            .unwrap()
            .contains("chatgpt.tokens.use.direct"));
        assert_eq!(
            values.get("redirect_uri").map(String::as_str),
            Some(attempt.redirect_uri.as_str())
        );
        assert_eq!(
            values.get("code_challenge_method").map(String::as_str),
            Some("S256")
        );
    }

    #[test]
    fn returning_registration_reuses_issued_client_id_and_omits_agent_hint() {
        let attempt = AuthorizationAttempt {
            state: "state".into(),
            nonce: "nonce".into(),
            verifier: "a".repeat(43),
            redirect_uri: "http://127.0.0.1:54321/auth/callback".into(),
            existing_client_id: Some("oaiapp_test-123".into()),
            force_consent: true,
        };
        let url = Url::parse(
            &build_authorization(&attempt, "urn:uuid:test", Some("writer@example.com"), None)
                .unwrap(),
        )
        .unwrap();
        let values = url
            .query_pairs()
            .into_owned()
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(
            values.get("client_id").map(String::as_str),
            Some("oaiapp_test-123")
        );
        assert!(!values.contains_key("agent_name_hint"));
        assert_eq!(
            values.get("login_hint").map(String::as_str),
            Some("writer@example.com")
        );
        assert_eq!(values.get("prompt").map(String::as_str), Some("consent"));
    }

    #[test]
    fn registration_id_is_never_the_dynamic_entrypoint() {
        assert!(!valid_client_id("dynamic_agent_client"));
        assert!(valid_client_id("oaiapp_test-123"));
        assert!(!valid_client_id("https://example.org"));
    }
}
