//! ChatGPT plan-usage Responses transport. This deliberately serializes only the
//! documented supported fields and requires `response.completed` for success.

use serde::Serialize;

const MAX_REQUEST_BYTES: usize = 2_000_000;
const MAX_STREAM_BYTES: usize = 16_000_000;
const MAX_PENDING_EVENT_BYTES: usize = 1_000_000;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct ResponsesInput {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct ResponsesRequest {
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
    pub input: Vec<ResponsesInput>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ResponsesEvent {
    TextDelta(String),
    Completed,
    Failed { code: String },
    Incomplete { reason: String },
}

fn request_body(request: &ResponsesRequest) -> Result<Vec<u8>, String> {
    if request.model.trim().is_empty() || request.input.is_empty() {
        return Err("Choose a model and include the required scene context.".into());
    }
    let input_size = request
        .input
        .iter()
        .map(|item| item.content.len())
        .sum::<usize>();
    if input_size > MAX_REQUEST_BYTES
        || request.input.iter().any(|item| {
            !matches!(item.role.as_str(), "developer" | "user" | "assistant")
                || item.content.len() > 500_000
        })
        || request
            .instructions
            .as_ref()
            .is_some_and(|value| value.len() > 100_000)
    {
        return Err("The ChatGPT request contains unsupported or oversized context.".into());
    }
    // Keep store/stream controlled here. Never serialize temperature, token limits,
    // previous_response_id, tools, or caller-supplied unsupported API options.
    serde_json::to_vec(&serde_json::json!({
        "model": &request.model,
        "instructions": &request.instructions,
        "input": &request.input,
        "store": false,
        "stream": true,
    }))
    .map_err(|_| "Could not prepare the ChatGPT request.".into())
}

#[derive(Default)]
struct SseDecoder {
    pending: Vec<u8>,
    data: String,
    total_bytes: usize,
}

impl SseDecoder {
    fn feed(
        &mut self,
        chunk: &[u8],
        callback: &mut impl FnMut(ResponsesEvent) -> Result<(), String>,
        completed: &mut bool,
    ) -> Result<(), String> {
        self.total_bytes = self.total_bytes.saturating_add(chunk.len());
        if self.total_bytes > MAX_STREAM_BYTES {
            return Err(
                "ChatGPT generated a response larger than Shorthand Writer supports.".into(),
            );
        }
        // WinHTTP currently supplies 8 KiB blocks. Process larger test or future
        // transport blocks incrementally so the per-event cap does not reject a
        // large block containing many small complete events.
        for part in chunk.chunks(8192) {
            self.pending.extend_from_slice(part);
            if self.pending.len() > MAX_PENDING_EVENT_BYTES {
                return Err("ChatGPT returned an oversized stream event.".into());
            }
            while let Some(end) = self.pending.iter().position(|byte| *byte == b'\n') {
                let mut line = self.pending.drain(..=end).collect::<Vec<_>>();
                line.pop();
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                let line = std::str::from_utf8(&line)
                    .map_err(|_| "ChatGPT returned an invalid event stream.".to_string())?;
                if line.is_empty() {
                    if !self.data.is_empty() {
                        let payload = std::mem::take(&mut self.data);
                        self.event(&payload, callback, completed)?;
                    }
                } else if let Some(value) = line.strip_prefix("data:") {
                    let separator_len = if self.data.is_empty() { 0 } else { 1 };
                    if self
                        .data
                        .len()
                        .saturating_add(separator_len)
                        .saturating_add(value.len())
                        > MAX_PENDING_EVENT_BYTES
                    {
                        return Err("ChatGPT returned an oversized stream event.".into());
                    }
                    if !self.data.is_empty() {
                        self.data.push('\n');
                    }
                    self.data.push_str(value.trim_start());
                }
            }
        }
        Ok(())
    }

    fn finish(
        &mut self,
        callback: &mut impl FnMut(ResponsesEvent) -> Result<(), String>,
        completed: &mut bool,
    ) -> Result<(), String> {
        if !self.pending.is_empty() {
            return Err("ChatGPT ended an incomplete event stream.".into());
        }
        if !self.data.is_empty() {
            let payload = std::mem::take(&mut self.data);
            self.event(&payload, callback, completed)?;
        }
        if *completed {
            Ok(())
        } else {
            Err("ChatGPT ended the stream without a completed response.".into())
        }
    }

    fn event(
        &mut self,
        payload: &str,
        callback: &mut impl FnMut(ResponsesEvent) -> Result<(), String>,
        completed: &mut bool,
    ) -> Result<(), String> {
        if payload == "[DONE]" {
            return Ok(());
        }
        let value: serde_json::Value = serde_json::from_str(payload)
            .map_err(|_| "ChatGPT returned an invalid event.".to_string())?;
        match value.get("type").and_then(serde_json::Value::as_str) {
            Some("response.output_text.delta") => {
                if let Some(delta) = value.get("delta").and_then(serde_json::Value::as_str) {
                    callback(ResponsesEvent::TextDelta(delta.to_owned()))?;
                }
            }
            Some("response.completed") => {
                *completed = true;
                callback(ResponsesEvent::Completed)?;
            }
            Some("response.failed") => {
                let code = value
                    .pointer("/response/error/code")
                    .and_then(serde_json::Value::as_str)
                    .map(safe_event_label)
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| "response_failed".into());
                callback(ResponsesEvent::Failed { code })?;
            }
            Some("response.incomplete") => {
                let reason = value
                    .pointer("/response/incomplete_details/reason")
                    .and_then(serde_json::Value::as_str)
                    .map(safe_event_label)
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| "incomplete".into());
                callback(ResponsesEvent::Incomplete { reason })?;
            }
            _ => {}
        }
        Ok(())
    }
}

fn safe_event_label(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_control())
        .take(100)
        .collect()
}

pub fn stream_response_with_access_token(
    access_token: &str,
    request: &ResponsesRequest,
    callback: impl FnMut(ResponsesEvent) -> Result<(), String>,
) -> Result<(), String> {
    stream_response_with_access_token_cancellable(access_token, request, || None, callback)
}

pub fn stream_response_with_access_token_cancellable(
    access_token: &str,
    request: &ResponsesRequest,
    stop_reason: impl Fn() -> Option<String>,
    mut callback: impl FnMut(ResponsesEvent) -> Result<(), String>,
) -> Result<(), String> {
    if access_token.is_empty() || access_token.len() > 2500 {
        return Err("ChatGPT is not connected. Reconnect in Settings.".into());
    }
    let body = request_body(request)?;
    let headers = [
        ("Authorization", &format!("Bearer {access_token}")[..]),
        ("Content-Type", "application/json"),
        ("Accept", "text/event-stream"),
    ];
    let mut decoder = SseDecoder::default();
    let mut completed = false;
    super::http::stream_bytes_cancellable(
        "POST",
        "https://api.openai.com/v1/responses",
        &headers,
        &body,
        stop_reason,
        |chunk| decoder.feed(chunk, &mut callback, &mut completed),
    )?;
    decoder.finish(&mut callback, &mut completed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_uses_supported_fields_only() {
        let body = request_body(&ResponsesRequest {
            model: "model-a".into(),
            instructions: Some("Write a scene".into()),
            input: vec![ResponsesInput {
                role: "user".into(),
                content: "Beat 1".into(),
            }],
        })
        .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["store"], false);
        assert_eq!(json["stream"], true);
        assert_eq!(json["model"], "model-a");
        assert!(json.get("temperature").is_none());
        assert!(json.get("max_output_tokens").is_none());
        assert!(json.get("previous_response_id").is_none());
    }

    #[test]
    fn system_role_is_not_serialized_for_plan_usage() {
        let request = ResponsesRequest {
            model: "model-a".into(),
            instructions: None,
            input: vec![ResponsesInput {
                role: "system".into(),
                content: "blocked".into(),
            }],
        };
        assert!(request_body(&request).is_err());
    }

    #[test]
    fn stream_requires_completed_event_and_preserves_deltas() {
        let mut decoder = SseDecoder::default();
        let mut completed = false;
        let mut output = Vec::new();
        let mut callback = |event| {
            output.push(event);
            Ok(())
        };
        decoder
            .feed(
                b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hello\"}\n\ndata: {\"type\":\"response.completed\"}\n\n",
                &mut callback,
                &mut completed,
            )
            .unwrap();
        decoder.finish(&mut callback, &mut completed).unwrap();
        assert_eq!(
            output,
            vec![
                ResponsesEvent::TextDelta("Hello".into()),
                ResponsesEvent::Completed
            ]
        );
    }

    #[test]
    fn stream_eof_without_completion_is_not_success() {
        let mut decoder = SseDecoder::default();
        let mut completed = false;
        let mut callback = |_| Ok(());
        decoder
            .feed(
                b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n",
                &mut callback,
                &mut completed,
            )
            .unwrap();
        assert!(decoder.finish(&mut callback, &mut completed).is_err());
    }

    #[test]
    fn stream_caps_total_bytes_and_individual_pending_events() {
        let mut decoder = SseDecoder::default();
        let mut completed = false;
        let mut callback = |_| Ok(());
        assert!(decoder
            .feed(
                &vec![b'x'; MAX_STREAM_BYTES + 1],
                &mut callback,
                &mut completed
            )
            .is_err());

        let mut decoder = SseDecoder::default();
        assert!(decoder
            .feed(
                &vec![b'x'; MAX_PENDING_EVENT_BYTES + 1],
                &mut callback,
                &mut completed
            )
            .is_err());
    }

    #[test]
    fn large_transport_block_with_many_small_events_respects_per_event_cap() {
        let mut decoder = SseDecoder::default();
        let mut completed = false;
        let mut callback = |_| Ok(());
        let keepalives = b": keepalive\n".repeat(100_000);
        assert!(keepalives.len() > MAX_PENDING_EVENT_BYTES);
        decoder
            .feed(&keepalives, &mut callback, &mut completed)
            .unwrap();
    }
}
