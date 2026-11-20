//! Narrow HTTPS client for the documented Sign in with ChatGPT hosts.
//!
//! Redirects are disabled so a bearer token can never be forwarded to another host.

use serde::de::DeserializeOwned;

const MAX_ERROR_BODY_BYTES: usize = 64_000;

pub struct HttpResponse {
    pub status: u16,
    pub request_id: Option<String>,
    pub body: Vec<u8>,
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::{ffi::c_void, ptr};
    use url::Url;
    use windows::{
        core::PCWSTR,
        Win32::Networking::WinHttp::{
            WinHttpCloseHandle, WinHttpConnect, WinHttpOpen, WinHttpOpenRequest,
            WinHttpQueryHeaders, WinHttpReadData, WinHttpReceiveResponse, WinHttpSendRequest,
            WinHttpSetOption, WinHttpSetTimeouts, WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
            WINHTTP_FLAG_SECURE, WINHTTP_OPTION_REDIRECT_POLICY,
            WINHTTP_OPTION_REDIRECT_POLICY_NEVER, WINHTTP_QUERY_CUSTOM, WINHTTP_QUERY_FLAG_NUMBER,
            WINHTTP_QUERY_STATUS_CODE,
        },
    };

    struct Handle(*mut c_void);
    impl Handle {
        fn new(value: *mut c_void) -> Result<Self, String> {
            if value.is_null() {
                Err("Could not initialize the secure ChatGPT connection.".into())
            } else {
                Ok(Self(value))
            }
        }
    }
    impl Drop for Handle {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    let _ = WinHttpCloseHandle(self.0);
                }
            }
        }
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn allowed_host(host: &str) -> bool {
        matches!(host, "auth.openai.com" | "api.openai.com")
    }

    fn query_request_id(request: *mut c_void) -> Option<String> {
        let name = wide("x-request-id");
        let mut size = 0u32;
        let mut index = 0u32;
        unsafe {
            let _ = WinHttpQueryHeaders(
                request,
                WINHTTP_QUERY_CUSTOM,
                PCWSTR::from_raw(name.as_ptr()),
                None,
                &mut size,
                &mut index,
            );
        }
        if size == 0 || size > 2048 {
            return None;
        }
        let mut buffer = vec![0u16; (size as usize).div_ceil(2)];
        if unsafe {
            WinHttpQueryHeaders(
                request,
                WINHTTP_QUERY_CUSTOM,
                PCWSTR::from_raw(name.as_ptr()),
                Some(buffer.as_mut_ptr().cast()),
                &mut size,
                &mut index,
            )
        }
        .is_err()
        {
            return None;
        }
        let value = String::from_utf16_lossy(&buffer[..(size as usize / 2).min(buffer.len())])
            .trim_matches('\0')
            .to_owned();
        if value.is_empty()
            || value.len() > 128
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            None
        } else {
            Some(value)
        }
    }

    pub fn request(
        method: &str,
        url: &str,
        headers: &[(&str, &str)],
        body: &[u8],
        mut on_chunk: impl FnMut(&[u8]) -> Result<(), String>,
    ) -> Result<HttpResponse, String> {
        let parsed = Url::parse(url).map_err(|_| "Invalid secure ChatGPT endpoint.")?;
        if parsed.scheme() != "https"
            || parsed.port().is_some_and(|port| port != 443)
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.fragment().is_some()
            || !parsed.host_str().is_some_and(allowed_host)
        {
            return Err(
                "The ChatGPT request was blocked because its destination was not approved.".into(),
            );
        }
        let host = parsed.host_str().unwrap();
        let target = format!(
            "{}{}",
            parsed.path(),
            parsed.query().map(|q| format!("?{q}")).unwrap_or_default()
        );
        let host_w = wide(host);
        let method_w = wide(method);
        let target_w = wide(&target);
        let user_agent_w = wide("Shorthand Writer");
        let header_text = headers
            .iter()
            .map(|(name, value)| format!("{name}: {value}\r\n"))
            .collect::<String>();
        let mut headers_w: Vec<u16> = header_text.encode_utf16().collect();
        headers_w.push(0);
        let session = unsafe {
            Handle::new(WinHttpOpen(
                PCWSTR::from_raw(user_agent_w.as_ptr()),
                WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                PCWSTR::null(),
                PCWSTR::null(),
                0,
            ))?
        };
        unsafe {
            WinHttpSetTimeouts(session.0, 15_000, 30_000, 30_000, 300_000)
                .map_err(|_| "The secure ChatGPT request could not be configured.")?;
        }
        let connection = unsafe {
            Handle::new(WinHttpConnect(
                session.0,
                PCWSTR::from_raw(host_w.as_ptr()),
                443,
                0,
            ))?
        };
        let request = unsafe {
            Handle::new(WinHttpOpenRequest(
                connection.0,
                PCWSTR::from_raw(method_w.as_ptr()),
                PCWSTR::from_raw(target_w.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                ptr::null(),
                WINHTTP_FLAG_SECURE,
            ))?
        };
        let no_redirect = WINHTTP_OPTION_REDIRECT_POLICY_NEVER.to_le_bytes();
        unsafe {
            WinHttpSetOption(
                Some(request.0.cast_const()),
                WINHTTP_OPTION_REDIRECT_POLICY,
                Some(&no_redirect),
            )
            .map_err(|_| "The secure ChatGPT request could not be configured.")?;
            WinHttpSendRequest(
                request.0,
                Some(&headers_w),
                (!body.is_empty()).then_some(body.as_ptr().cast::<c_void>()),
                body.len() as u32,
                body.len() as u32,
                0,
            )
            .map_err(|_| "Could not send the secure ChatGPT request.")?;
            WinHttpReceiveResponse(request.0, ptr::null_mut())
                .map_err(|_| "ChatGPT did not return a response.")?;
        }
        let mut status = 0u32;
        let mut status_len = std::mem::size_of::<u32>() as u32;
        unsafe {
            WinHttpQueryHeaders(
                request.0,
                WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                PCWSTR::null(),
                Some((&mut status as *mut u32).cast()),
                &mut status_len,
                ptr::null_mut(),
            )
            .map_err(|_| "Could not read the ChatGPT response status.")?;
        }
        let request_id = query_request_id(request.0);
        let is_success = (200..300).contains(&(status as u16));
        let mut error_body = Vec::new();
        let mut buffer = [0u8; 8192];
        loop {
            let mut read = 0u32;
            unsafe {
                WinHttpReadData(
                    request.0,
                    buffer.as_mut_ptr().cast(),
                    buffer.len() as u32,
                    &mut read,
                )
                .map_err(|_| "The ChatGPT response was interrupted.")?;
            }
            if read == 0 {
                break;
            }
            if is_success {
                on_chunk(&buffer[..read as usize])?;
            } else if error_body.len() < MAX_ERROR_BODY_BYTES {
                let remaining = MAX_ERROR_BODY_BYTES - error_body.len();
                error_body.extend_from_slice(&buffer[..(read as usize).min(remaining)]);
            }
        }
        Ok(HttpResponse {
            status: status as u16,
            request_id,
            body: error_body,
        })
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn request(
        _method: &str,
        _url: &str,
        _headers: &[(&str, &str)],
        _body: &[u8],
        _on_chunk: impl FnMut(&[u8]) -> Result<(), String>,
    ) -> Result<super::HttpResponse, String> {
        Err("ChatGPT connection is currently supported in the Windows desktop app.".into())
    }
}

pub fn request_bytes(
    method: &str,
    url: &str,
    headers: &[(&str, &str)],
    body: &[u8],
    max_bytes: usize,
) -> Result<(u16, Vec<u8>), String> {
    let mut collected = Vec::new();
    let response = platform::request(method, url, headers, body, |chunk| {
        if collected.len().saturating_add(chunk.len()) > max_bytes {
            return Err("ChatGPT returned an unexpectedly large response.".into());
        }
        collected.extend_from_slice(chunk);
        Ok(())
    })?;
    if !(200..300).contains(&response.status) {
        return Ok((response.status, response.body));
    }
    Ok((response.status, collected))
}

fn sanitize(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_control())
        .take(240)
        .collect()
}

pub fn format_http_error(status: u16, request_id: Option<&str>, body: &[u8]) -> String {
    let value: serde_json::Value = serde_json::from_slice(body).unwrap_or_default();
    let code = value
        .pointer("/error/code")
        .or_else(|| value.get("code"))
        .and_then(serde_json::Value::as_str)
        .map(sanitize)
        .filter(|value| !value.is_empty());
    let message = value
        .pointer("/error/message")
        .or_else(|| value.pointer("/detail"))
        .or_else(|| value.get("message"))
        .and_then(serde_json::Value::as_str)
        .map(sanitize)
        .filter(|value| !value.is_empty());
    let request_id = request_id.filter(|id| {
        id.len() <= 128
            && id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    });
    let mut parts = vec![format!("HTTP {status}")];
    if let Some(code) = code {
        parts.push(code);
    }
    if let Some(message) = message {
        parts.push(message);
    }
    if let Some(request_id) = request_id {
        parts.push(format!("request ID {request_id}"));
    }
    format!("ChatGPT request failed ({}).", parts.join("; "))
}

pub fn json<T: DeserializeOwned>(status: u16, bytes: &[u8]) -> Result<T, String> {
    if !(200..300).contains(&status) {
        return Err(format_http_error(status, None, bytes));
    }
    serde_json::from_slice(bytes).map_err(|_| "ChatGPT returned an invalid response.".into())
}

pub fn request_json<T: DeserializeOwned>(
    method: &str,
    url: &str,
    headers: &[(&str, &str)],
    body: &[u8],
) -> Result<T, String> {
    let (status, bytes) = request_bytes(method, url, headers, body, 5_000_000)?;
    json(status, &bytes)
}

pub fn stream_bytes(
    method: &str,
    url: &str,
    headers: &[(&str, &str)],
    body: &[u8],
    on_chunk: impl FnMut(&[u8]) -> Result<(), String>,
) -> Result<(), String> {
    let response = platform::request(method, url, headers, body, on_chunk)?;
    if !(200..300).contains(&response.status) {
        return Err(format_http_error(
            response.status,
            response.request_id.as_deref(),
            &response.body,
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_errors_keep_sanitized_detail_code_and_request_id() {
        let message = format_http_error(
            503,
            Some("req_abc-123"),
            br#"{"detail":"Direct routing is unavailable\nplease retry","error":{"code":"subscription_sharing_usage_unavailable"}}"#,
        );
        assert!(message.contains("HTTP 503"));
        assert!(message.contains("subscription_sharing_usage_unavailable"));
        assert!(message.contains("Direct routing is unavailableplease retry"));
        assert!(message.contains("request ID req_abc-123"));
        assert!(!message.contains('\n'));
    }

    #[test]
    fn malformed_error_body_is_safe_and_bounded() {
        let message = format_http_error(401, Some("bad\nid"), b"not json");
        assert_eq!(message, "ChatGPT request failed (HTTP 401).");
    }
}
