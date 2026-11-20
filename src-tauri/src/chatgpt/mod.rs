//! Single-account ChatGPT plan connection. Browser authentication and provider
//! traffic stay in Rust; only a small connection status crosses into the UI.

mod http;
mod jwt;
mod oauth;
pub mod responses;
mod secrets;

use http::{request_bytes, request_json};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

type Result<T> = std::result::Result<T, String>;
const API_BASE: &str = "https://api.openai.com/v1";
const AUTH_BASE: &str = "https://auth.openai.com";
const DIRECT_SCOPE: &str = "chatgpt.tokens.use.direct";
const RESOURCE_SCOPE: &str = "resource.invoke";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatGPTModel {
    pub slug: String,
    pub display_name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChatGPTStatus {
    Disconnected,
    Connected,
    NeedsReconnect,
    NeedsPlanPermission,
    Unavailable,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatGPTConnectionState {
    pub status: ChatGPTStatus,
    pub account: Option<String>,
    pub models: Vec<ChatGPTModel>,
    pub selected_model: Option<String>,
    /// This is in-memory only and starts false after each app launch.
    pub ready: bool,
    pub usage_acknowledged: bool,
    pub first_use_pending: bool,
    pub reason: Option<String>,
    pub remote_revocation_confirmed: Option<bool>,
}

impl ChatGPTConnectionState {
    fn disconnected() -> Self {
        Self {
            status: ChatGPTStatus::Disconnected,
            account: None,
            models: Vec::new(),
            selected_model: None,
            ready: false,
            usage_acknowledged: false,
            first_use_pending: false,
            reason: None,
            remote_revocation_confirmed: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionRecord {
    version: u32,
    client_id: Option<String>,
    subject: Option<String>,
    email: Option<String>,
    display_name: Option<String>,
    scopes: Vec<String>,
    selected_model: Option<String>,
    credential_slot: Option<String>,
    expires_at: Option<u64>,
    #[serde(default)]
    usage_consent_at: Option<u64>,
    #[serde(default)]
    cleanup_slots: Vec<String>,
}

impl ConnectionRecord {
    fn empty() -> Self {
        Self {
            version: 2,
            client_id: None,
            subject: None,
            email: None,
            display_name: None,
            scopes: Vec::new(),
            selected_model: None,
            credential_slot: None,
            expires_at: None,
            usage_consent_at: None,
            cleanup_slots: Vec::new(),
        }
    }

    fn has_plan_permission(&self) -> bool {
        has_plan_permission(&self.scopes)
    }

    fn account_label(&self) -> Option<String> {
        self.email.as_ref().or(self.display_name.as_ref()).cloned()
    }
}

#[derive(Default)]
struct Runtime {
    models: Vec<ChatGPTModel>,
    verified_model: Option<String>,
    epoch: u64,
}

/// Cloned into Tauri's managed state and future generation commands.
#[derive(Clone, Default)]
pub struct ChatGPTState {
    runtime: Arc<Mutex<Runtime>>,
    operation: Arc<Mutex<()>>,
}

#[derive(Deserialize)]
struct OpenIdConfiguration {
    issuer: String,
    jwks_uri: String,
    revocation_endpoint: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    id_token: Option<String>,
    token_type: Option<String>,
    expires_in: Option<u64>,
    scope: Option<String>,
}

#[derive(Deserialize)]
struct ModelCatalog {
    models: Vec<RawModel>,
}

#[derive(Deserialize)]
struct RawModel {
    slug: Option<String>,
    display_name: Option<String>,
    visibility: Option<String>,
}

fn now_epoch() -> Result<u64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "The system clock is not available.".to_string())?
        .as_secs())
}

fn has_plan_permission(scopes: &[String]) -> bool {
    scopes.iter().any(|scope| scope == DIRECT_SCOPE)
        && scopes.iter().any(|scope| scope == RESOURCE_SCOPE)
}

fn parse_scopes(scope: &str) -> Vec<String> {
    let mut values = scope
        .split_ascii_whitespace()
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    values.sort();
    values.dedup();
    values
}

fn token_is_valid(token: &str) -> bool {
    !token.is_empty() && token.len() <= 2500 && token.bytes().all(|byte| byte.is_ascii_graphic())
}

fn has_replacement_refresh(token: &TokenResponse) -> bool {
    token.refresh_token.as_deref().is_some_and(token_is_valid)
}

fn json_error(status: u16, bytes: &[u8]) -> String {
    http::format_http_error(status, None, bytes)
}

fn form_body(values: &[(&str, &str)]) -> Vec<u8> {
    let mut serializer = form_urlencoded::Serializer::new(String::new());
    for (name, value) in values {
        serializer.append_pair(name, value);
    }
    serializer.finish().into_bytes()
}

fn openid_configuration() -> Result<OpenIdConfiguration> {
    let url = format!("{AUTH_BASE}/.well-known/openid-configuration");
    let config: OpenIdConfiguration =
        request_json("GET", &url, &[("Accept", "application/json")], &[])?;
    if config.issuer != AUTH_BASE
        || config.jwks_uri != format!("{AUTH_BASE}/.well-known/jwks.json")
        || config.revocation_endpoint != format!("{AUTH_BASE}/api/accounts/oauth/revoke")
    {
        return Err("ChatGPT sign-in metadata did not match the expected secure service.".into());
    }
    Ok(config)
}

fn exchange_code(code: &oauth::AuthorizationCode) -> Result<TokenResponse> {
    let client_id = code.client_id.as_str();
    let verifier = code.attempt.verifier.as_str();
    let redirect_uri = code.attempt.redirect_uri.as_str();
    let values = [
        ("grant_type", "authorization_code"),
        ("client_id", client_id),
        ("code", code.code.as_str()),
        ("code_verifier", verifier),
        ("redirect_uri", redirect_uri),
        ("resource", API_BASE),
    ];
    let body = form_body(&values);
    request_json(
        "POST",
        &format!("{AUTH_BASE}/api/accounts/oauth/token"),
        &[
            ("Content-Type", "application/x-www-form-urlencoded"),
            ("Accept", "application/json"),
        ],
        &body,
    )
}

fn fetch_models(access_token: &str) -> Result<(u16, Vec<u8>)> {
    request_bytes(
        "GET",
        &format!("{API_BASE}/models"),
        &[
            ("Authorization", &format!("Bearer {access_token}")),
            ("Accept", "application/json"),
        ],
        &[],
        5_000_000,
    )
}

fn parse_models(status: u16, body: &[u8]) -> Result<Vec<ChatGPTModel>> {
    if !(200..300).contains(&status) {
        return Err(json_error(status, body));
    }
    let catalog: ModelCatalog = serde_json::from_slice(body)
        .map_err(|_| "ChatGPT returned an invalid model catalog.".to_string())?;
    let mut models = Vec::new();
    for model in catalog.models {
        if model.visibility.as_deref() != Some("list") {
            continue;
        }
        if let (Some(slug), Some(display_name)) = (model.slug, model.display_name) {
            if !slug.is_empty() && !display_name.is_empty() {
                models.push(ChatGPTModel { slug, display_name });
            }
        }
    }
    Ok(models)
}

fn validate_identity(token: &str, client_id: &str, nonce: &str) -> Result<jwt::Claims> {
    if !token_is_valid(token) {
        return Err("ChatGPT returned an identity token in an unsupported format.".into());
    }
    let config = openid_configuration()?;
    let (status, jwks) = request_bytes(
        "GET",
        &config.jwks_uri,
        &[("Accept", "application/json")],
        &[],
        1_000_000,
    )?;
    if !(200..300).contains(&status) {
        return Err("ChatGPT signing keys could not be retrieved.".into());
    }
    jwt::verify(token, client_id, nonce, &jwks)
}

fn token_scopes(token: &TokenResponse, existing: Option<&[String]>) -> Result<Vec<String>> {
    if let Some(scope) = token.scope.as_deref() {
        return Ok(parse_scopes(scope));
    }
    existing
        .map(<[String]>::to_vec)
        .ok_or_else(|| "ChatGPT did not return the authorized plan-use scopes.".to_string())
}

fn credential_write(slot: &str, token: &TokenResponse, old_id_token: Option<&str>) -> Result<()> {
    if !has_replacement_refresh(token) {
        return Err("ChatGPT did not return a replacement refresh credential.".into());
    }
    for (name, value) in [
        ("access", Some(token.access_token.as_str())),
        ("refresh", token.refresh_token.as_deref()),
        ("id", token.id_token.as_deref().or(old_id_token)),
    ] {
        if let Some(value) = value {
            if !token_is_valid(value) {
                delete_slot(slot);
                return Err(
                    "ChatGPT returned a credential that could not be stored safely.".into(),
                );
            }
            if let Err(error) = secrets::write(slot, name, value) {
                delete_slot(slot);
                return Err(error);
            }
        }
    }
    Ok(())
}

fn delete_slot(slot: &str) {
    for name in ["access", "refresh", "id"] {
        let _ = secrets::delete(slot, name);
    }
}

fn cleanup_credential_slots(
    slots: &[String],
    mut delete: impl FnMut(&str, &str) -> Result<()>,
) -> Vec<String> {
    let mut pending = Vec::new();
    for slot in slots {
        let mut failed = false;
        for name in ["access", "refresh", "id"] {
            if delete(slot, name).is_err() {
                failed = true;
            }
        }
        if failed && !pending.contains(slot) {
            pending.push(slot.clone());
        }
    }
    pending
}

fn mark_locally_disconnected(
    record: &mut ConnectionRecord,
    active_slot: Option<String>,
) -> Vec<String> {
    let mut slots = record.cleanup_slots.clone();
    if let Some(slot) = active_slot {
        if !slots.contains(&slot) {
            slots.push(slot);
        }
    }
    record.client_id = None;
    record.subject = None;
    record.email = None;
    record.display_name = None;
    record.scopes.clear();
    record.selected_model = None;
    record.credential_slot = None;
    record.expires_at = None;
    record.usage_consent_at = None;
    record.cleanup_slots = slots.clone();
    slots
}

fn host_id() -> Result<String> {
    if let Some(value) = secrets::read("host", "ext_agent_host_id")? {
        if value.starts_with("urn:uuid:") && value.len() <= 64 {
            return Ok(value);
        }
        return Err("The local ChatGPT host identity is invalid.".into());
    }
    let value = format!("urn:uuid:{}", Uuid::new_v4());
    secrets::write("host", "ext_agent_host_id", &value)?;
    Ok(value)
}

fn metadata_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Could not locate local app settings.".to_string())?;
    fs::create_dir_all(&dir).map_err(|_| "Could not create local app settings.".to_string())?;
    Ok(dir.join("chatgpt-connection.json"))
}

fn read_record(app: &AppHandle) -> Result<Option<ConnectionRecord>> {
    let path = metadata_path(app)?;
    let raw = match fs::read(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Could not read local ChatGPT settings.".into()),
    };
    let record: ConnectionRecord = serde_json::from_slice(&raw).map_err(|_| {
        "Local ChatGPT settings are damaged. Preserve the file before reconnecting.".to_string()
    })?;
    if record.version != 2 {
        return Err("Local ChatGPT settings use an unsupported version.".into());
    }
    let valid_slot =
        |slot: &str| Uuid::parse_str(slot).is_ok_and(|value| value.to_string() == slot);
    if record
        .credential_slot
        .as_deref()
        .is_some_and(|slot| !valid_slot(slot))
        || record.cleanup_slots.iter().any(|slot| !valid_slot(slot))
    {
        return Err("Local ChatGPT settings contain an invalid credential reference.".into());
    }
    Ok(Some(record))
}

fn save_record(app: &AppHandle, record: &ConnectionRecord) -> Result<()> {
    let path = metadata_path(app)?;
    let temp = path.with_file_name(format!("chatgpt-connection-{}.tmp", Uuid::new_v4()));
    let bytes = serde_json::to_vec(record)
        .map_err(|_| "Could not prepare local ChatGPT settings.".to_string())?;
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(|_| "Could not write local ChatGPT settings.".to_string())?;
        file.write_all(&bytes)
            .map_err(|_| "Could not save local ChatGPT settings.".to_string())?;
        file.sync_all()
            .map_err(|_| "Could not save local ChatGPT settings.".to_string())?;
        drop(file);
        atomic_replace(&temp, &path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[cfg(windows)]
fn atomic_replace(temp: &Path, destination: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        },
    };
    let temp: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    unsafe {
        MoveFileExW(
            PCWSTR::from_raw(temp.as_ptr()),
            PCWSTR::from_raw(destination.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(|_| "Could not finish saving local ChatGPT settings.".to_string())
}

#[cfg(not(windows))]
fn atomic_replace(temp: &Path, destination: &Path) -> Result<()> {
    fs::rename(temp, destination)
        .map_err(|_| "Could not finish saving local ChatGPT settings.".into())
}

fn state_for(
    record: Option<&ConnectionRecord>,
    models: Vec<ChatGPTModel>,
    verified_model: Option<&str>,
    reason: Option<String>,
    remote_revocation_confirmed: Option<bool>,
) -> ChatGPTConnectionState {
    let Some(record) = record else {
        return ChatGPTConnectionState::disconnected();
    };
    if record.client_id.is_none() || record.credential_slot.is_none() {
        return ChatGPTConnectionState {
            status: if record.client_id.is_some() {
                ChatGPTStatus::NeedsReconnect
            } else {
                ChatGPTStatus::Disconnected
            },
            account: record.account_label(),
            models,
            selected_model: record.selected_model.clone(),
            ready: false,
            usage_acknowledged: record.usage_consent_at.is_some(),
            first_use_pending: record.has_plan_permission()
                && record.credential_slot.is_some()
                && record.usage_consent_at.is_none(),
            reason,
            remote_revocation_confirmed,
        };
    }
    if !record.has_plan_permission() {
        return ChatGPTConnectionState {
            status: ChatGPTStatus::NeedsPlanPermission,
            account: record.account_label(),
            models: Vec::new(),
            selected_model: record.selected_model.clone(),
            ready: false,
            usage_acknowledged: record.usage_consent_at.is_some(),
            first_use_pending: false,
            reason: reason.or_else(|| {
                Some("Allow ChatGPT plan usage in Settings to generate scenes.".into())
            }),
            remote_revocation_confirmed,
        };
    }
    let ready = record.usage_consent_at.is_some()
        && record
            .selected_model
            .as_deref()
            .is_some_and(|model| Some(model) == verified_model)
        && models
            .iter()
            .any(|item| Some(item.slug.as_str()) == record.selected_model.as_deref());
    ChatGPTConnectionState {
        status: if reason.is_some() {
            ChatGPTStatus::Unavailable
        } else {
            ChatGPTStatus::Connected
        },
        account: record.account_label(),
        models,
        selected_model: record.selected_model.clone(),
        ready,
        usage_acknowledged: record.usage_consent_at.is_some(),
        first_use_pending: record.has_plan_permission()
            && record.credential_slot.is_some()
            && record.usage_consent_at.is_none(),
        reason,
        remote_revocation_confirmed,
    }
}

impl ChatGPTState {
    fn operation_guard(&self) -> Result<std::sync::MutexGuard<'_, ()>> {
        self.operation
            .lock()
            .map_err(|_| "ChatGPT connection is unavailable. Restart the app.".into())
    }

    fn set_runtime(&self, models: Vec<ChatGPTModel>, verified_model: Option<String>) -> Result<()> {
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "ChatGPT connection is unavailable. Restart the app.".to_string())?;
        runtime.models = models;
        runtime.verified_model = verified_model;
        Ok(())
    }

    fn invalidate(&self) -> Result<u64> {
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "ChatGPT connection is unavailable. Restart the app.".to_string())?;
        runtime.epoch = runtime.epoch.wrapping_add(1);
        runtime.verified_model = None;
        Ok(runtime.epoch)
    }

    fn is_epoch_current(&self, epoch: u64, model: &str) -> bool {
        self.runtime
            .lock()
            .map(|runtime| {
                runtime.epoch == epoch && runtime.verified_model.as_deref() == Some(model)
            })
            .unwrap_or(false)
    }

    fn refresh_access(
        &self,
        app: &AppHandle,
        record: &mut ConnectionRecord,
        force: bool,
    ) -> Result<String> {
        let slot = record
            .credential_slot
            .as_deref()
            .ok_or_else(|| "Reconnect with ChatGPT in Settings.".to_string())?;
        let access = secrets::read(slot, "access")?
            .ok_or_else(|| "Reconnect with ChatGPT in Settings.".to_string())?;
        let expiry = record.expires_at.unwrap_or(0);
        if !force && expiry > now_epoch()?.saturating_add(90) {
            return Ok(access);
        }
        let refresh = secrets::read(slot, "refresh")?
            .ok_or_else(|| "Reconnect with ChatGPT in Settings.".to_string())?;
        let client_id = record
            .client_id
            .as_deref()
            .ok_or_else(|| "Reconnect with ChatGPT in Settings.".to_string())?;
        let values = [
            ("grant_type", "refresh_token"),
            ("client_id", client_id),
            ("refresh_token", refresh.as_str()),
            ("resource", API_BASE),
        ];
        let body = form_body(&values);
        let token: TokenResponse = request_json(
            "POST",
            &format!("{AUTH_BASE}/api/accounts/oauth/token"),
            &[
                ("Content-Type", "application/x-www-form-urlencoded"),
                ("Accept", "application/json"),
            ],
            &body,
        )
        .map_err(|_| "ChatGPT needs you to reconnect in Settings.".to_string())?;
        if token
            .token_type
            .as_deref()
            .is_some_and(|kind| !kind.eq_ignore_ascii_case("bearer"))
            || !token_is_valid(&token.access_token)
            || !has_replacement_refresh(&token)
        {
            return Err("ChatGPT did not return a replacement refresh credential. The saved credentials were preserved; reconnect in Settings.".into());
        }
        let scopes = token_scopes(&token, Some(&record.scopes))?;
        let new_slot = Uuid::new_v4().to_string();
        credential_write(&new_slot, &token, secrets::read(slot, "id")?.as_deref())?;
        let old_slot = record.credential_slot.replace(new_slot.clone());
        record.scopes = scopes;
        record.expires_at = Some(now_epoch()?.saturating_add(token.expires_in.unwrap_or(3600)));
        if let Err(error) = save_record(app, record) {
            delete_slot(&new_slot);
            record.credential_slot = old_slot;
            return Err(error);
        }
        if let Some(old_slot) = old_slot {
            delete_slot(&old_slot);
        }
        secrets::read(&new_slot, "access")?
            .ok_or_else(|| "ChatGPT access token could not be refreshed.".into())
    }

    fn load_and_refresh(
        &self,
        app: &AppHandle,
    ) -> Result<(ConnectionRecord, String, Vec<ChatGPTModel>)> {
        let mut record =
            read_record(app)?.ok_or_else(|| "ChatGPT is not connected.".to_string())?;
        if !record.has_plan_permission() {
            return Err("Allow ChatGPT plan usage in Settings before generating.".into());
        }
        let mut access = self.refresh_access(app, &mut record, false)?;
        if !record.has_plan_permission() {
            return Err("ChatGPT plan usage permission is no longer available. Reconnect in Settings and allow plan usage.".into());
        }
        let (status, bytes) = fetch_models(&access)?;
        let models = if status == 401 {
            access = self.refresh_access(app, &mut record, true)?;
            let (retry_status, retry_bytes) = fetch_models(&access)?;
            parse_models(retry_status, &retry_bytes)?
        } else {
            parse_models(status, &bytes)?
        };
        if models.is_empty() {
            return Err("ChatGPT did not return any models available for this account.".into());
        }
        if record.selected_model.is_none() {
            record.selected_model = models.first().map(|model| model.slug.clone());
            save_record(app, &record)?;
        }
        Ok((record, access, models))
    }

    fn connection_state(&self, app: &AppHandle) -> Result<ChatGPTConnectionState> {
        let _operation = self.operation_guard()?;
        self.invalidate()?;
        self.set_runtime(Vec::new(), None)?;
        let record = read_record(app)?;
        let Some(record) = record else {
            self.set_runtime(Vec::new(), None)?;
            return Ok(ChatGPTConnectionState::disconnected());
        };
        if record.client_id.is_none()
            || record.credential_slot.is_none()
            || !record.has_plan_permission()
        {
            self.set_runtime(Vec::new(), None)?;
            return Ok(state_for(Some(&record), Vec::new(), None, None, None));
        }
        match self.load_and_refresh(app) {
            Ok((record, _token, models)) => {
                self.set_runtime(models.clone(), None)?;
                Ok(state_for(Some(&record), models, None, None, None))
            }
            Err(reason) => {
                let latest_record = read_record(app)?.unwrap_or(record);
                let state = state_for(
                    Some(&latest_record),
                    Vec::new(),
                    None,
                    Some(reason.clone()),
                    None,
                );
                self.set_runtime(Vec::new(), None)?;
                Ok(state)
            }
        }
    }

    fn acknowledge_usage(&self, app: &AppHandle) -> Result<ChatGPTConnectionState> {
        let _operation = self.operation_guard()?;
        let mut record = read_record(app)?.unwrap_or_else(ConnectionRecord::empty);
        if record.client_id.is_none()
            || record.credential_slot.is_none()
            || !record.has_plan_permission()
        {
            return Err(
                "Sign in to ChatGPT and allow plan usage before confirming first use.".into(),
            );
        }
        let slot = record.credential_slot.as_deref().unwrap();
        if secrets::read(slot, "access")?.is_none() || secrets::read(slot, "refresh")?.is_none() {
            return Err("Reconnect with ChatGPT before confirming first use.".into());
        }
        if record.usage_consent_at.is_none() {
            record.usage_consent_at = Some(now_epoch()?);
            save_record(app, &record)?;
        }
        let models = self
            .runtime
            .lock()
            .map_err(|_| "ChatGPT connection is unavailable.".to_string())?
            .models
            .clone();
        let verified = self
            .runtime
            .lock()
            .map_err(|_| "ChatGPT connection is unavailable.".to_string())?
            .verified_model
            .clone();
        Ok(state_for(
            Some(&record),
            models,
            verified.as_deref(),
            None,
            None,
        ))
    }

    fn connect(&self, app: &AppHandle) -> Result<ChatGPTConnectionState> {
        let _operation = self.operation_guard()?;
        self.invalidate()?;
        self.set_runtime(Vec::new(), None)?;
        let mut record = read_record(app)?.unwrap_or_else(ConnectionRecord::empty);
        // Persist the stable host ID before opening the system browser.
        save_record(app, &record)?;
        let previous_slot = record.credential_slot.clone();
        let id_token_hint = match previous_slot.as_deref() {
            Some(slot) => secrets::read(slot, "id")?,
            None => None,
        };
        let auth = oauth::start(
            &host_id()?,
            record.client_id.clone(),
            record.email.as_deref(),
            id_token_hint.as_deref(),
            record.client_id.is_some() && !record.has_plan_permission(),
        )?;
        // A first-time registration is issued by the callback before code exchange.
        // Persist it now so invalid_grant can be retried with this exact client ID.
        record.client_id = Some(auth.client_id.clone());
        save_record(app, &record)?;
        let token = exchange_code(&auth)?;
        if token
            .token_type
            .as_deref()
            .is_some_and(|kind| !kind.eq_ignore_ascii_case("bearer"))
            || !token_is_valid(&token.access_token)
            || token
                .refresh_token
                .as_deref()
                .is_none_or(|value| !token_is_valid(value))
        {
            return Err("ChatGPT returned credentials in an unsupported format.".into());
        }
        let id_token = token
            .id_token
            .as_deref()
            .ok_or_else(|| "ChatGPT did not return an identity token.".to_string())?;
        let claims = validate_identity(id_token, &auth.client_id, &auth.attempt.nonce)?;
        if record
            .subject
            .as_deref()
            .is_some_and(|subject| subject != claims.sub)
        {
            return Err("This ChatGPT registration belongs to a different account. Disconnect it before connecting another account.".into());
        }
        let scopes = token_scopes(&token, None)?;
        let slot = Uuid::new_v4().to_string();
        credential_write(&slot, &token, None)?;
        record.client_id = Some(auth.client_id);
        record.subject = Some(claims.sub);
        record.email = claims
            .email
            .filter(|email| email.len() <= 320 && claims.email_verified == Some(true));
        record.display_name = claims
            .name
            .or(claims.preferred_username)
            .filter(|name| name.len() <= 256);
        record.scopes = scopes;
        record.credential_slot = Some(slot.clone());
        record.expires_at = Some(now_epoch()?.saturating_add(token.expires_in.unwrap_or(3600)));
        if let Err(error) = save_record(app, &record) {
            delete_slot(&slot);
            return Err(error);
        }
        if let Some(old) = previous_slot {
            if old != slot {
                delete_slot(&old);
            }
        }
        if !record.has_plan_permission() {
            self.set_runtime(Vec::new(), None)?;
            return Ok(state_for(Some(&record), Vec::new(), None, None, None));
        }
        match self.load_and_refresh(app) {
            Ok((record, _, models)) => {
                self.set_runtime(models.clone(), None)?;
                Ok(state_for(Some(&record), models, None, None, None))
            }
            Err(reason) => {
                self.set_runtime(Vec::new(), None)?;
                let latest_record = read_record(app)?.unwrap_or(record);
                Ok(state_for(
                    Some(&latest_record),
                    Vec::new(),
                    None,
                    Some(reason),
                    None,
                ))
            }
        }
    }

    fn set_model(&self, app: &AppHandle, model: &str) -> Result<ChatGPTConnectionState> {
        let _operation = self.operation_guard()?;
        let mut record =
            read_record(app)?.ok_or_else(|| "Connect ChatGPT in Settings first.".to_string())?;
        let models = self
            .runtime
            .lock()
            .map_err(|_| "ChatGPT connection is unavailable.".to_string())?
            .models
            .clone();
        if !models.iter().any(|item| item.slug == model) {
            return Err("Choose a model from the current ChatGPT account list.".into());
        }
        record.selected_model = Some(model.to_owned());
        save_record(app, &record)?;
        self.invalidate()?;
        self.set_runtime(models.clone(), None)?;
        Ok(state_for(Some(&record), models, None, None, None))
    }

    fn test_connection(&self, app: &AppHandle, model: &str) -> Result<ChatGPTConnectionState> {
        let _operation = self.operation_guard()?;
        self.invalidate()?;
        let (record, access, models) = self.load_and_refresh(app)?;
        if record.usage_consent_at.is_none() {
            return Err(
                "Confirm that you’re using your ChatGPT plan before the first connection test."
                    .into(),
            );
        }
        if record.selected_model.as_deref() != Some(model) {
            return Err("Select this model in Settings, then test it.".into());
        }
        if !models.iter().any(|item| item.slug == model) {
            return Err(
                "This model is no longer available to the connected ChatGPT account.".into(),
            );
        }
        let request = responses::ResponsesRequest {
            model: model.to_owned(),
            instructions: Some("Reply with exactly READY.".into()),
            input: vec![responses::ResponsesInput {
                role: "user".into(),
                content: "Confirm the connection.".into(),
            }],
        };
        let mut completed = false;
        let mut saw_text = false;
        responses::stream_response_with_access_token(&access, &request, |event| {
            match event {
                responses::ResponsesEvent::Completed => completed = true,
                responses::ResponsesEvent::TextDelta(delta) => {
                    saw_text |= !delta.trim().is_empty();
                }
                responses::ResponsesEvent::Failed { code } => {
                    return Err(format!(
                        "ChatGPT could not complete the connection test ({code})."
                    ));
                }
                responses::ResponsesEvent::Incomplete { reason } => {
                    return Err(format!(
                        "ChatGPT connection test was incomplete ({reason})."
                    ));
                }
            }
            Ok(())
        })?;
        if !completed || !saw_text {
            return Err("ChatGPT connection test did not return a completed text response.".into());
        }
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "ChatGPT connection is unavailable.".to_string())?;
        runtime.models = models.clone();
        runtime.verified_model = Some(model.to_owned());
        Ok(state_for(Some(&record), models, Some(model), None, None))
    }

    fn disconnect(&self, app: &AppHandle) -> Result<ChatGPTConnectionState> {
        let _operation = self.operation_guard()?;
        self.invalidate()?;
        let Some(mut record) = read_record(app)? else {
            return Ok(ChatGPTConnectionState::disconnected());
        };
        let mut revocation_confirmed = false;
        let old_slot = record.credential_slot.clone();
        if let (Some(slot), Some(client_id)) = (old_slot.as_deref(), record.client_id.as_deref()) {
            if let Ok(Some(refresh)) = secrets::read(slot, "refresh") {
                if let Ok(config) = openid_configuration() {
                    let values = [
                        ("token", refresh.as_str()),
                        ("token_type_hint", "refresh_token"),
                        ("client_id", client_id),
                    ];
                    let body = form_body(&values);
                    if let Ok((status, _)) = request_bytes(
                        "POST",
                        &config.revocation_endpoint,
                        &[("Content-Type", "application/x-www-form-urlencoded")],
                        &body,
                        100_000,
                    ) {
                        revocation_confirmed = status == 200;
                    }
                }
            }
        }
        let slots = mark_locally_disconnected(&mut record, old_slot);
        // Commit the disconnected state before best-effort keychain cleanup. New
        // requests are blocked immediately even if Windows refuses a delete.
        save_record(app, &record)?;
        let pending = cleanup_credential_slots(&slots, secrets::delete);
        let cleanup_confirmed = pending.is_empty();
        record.cleanup_slots = pending;
        let cleanup_metadata_saved = save_record(app, &record).is_ok();
        self.set_runtime(Vec::new(), None)?;
        let mut state = state_for(
            Some(&record),
            Vec::new(),
            None,
            None,
            Some(revocation_confirmed),
        );
        let mut messages = vec![if revocation_confirmed {
            "Disconnected and remote access was revoked.".to_string()
        } else {
            "Disconnected locally. Remote revocation was not confirmed; you can also remove access in ChatGPT Settings.".to_string()
        }];
        if !cleanup_confirmed {
            messages.push(
                "Windows did not remove every stored token. Try disconnect again to retry cleanup."
                    .into(),
            );
        }
        if !cleanup_metadata_saved {
            messages.push("The local cleanup retry marker could not be saved.".into());
        }
        state.reason = Some(messages.join(" "));
        Ok(state)
    }

    /// S4 calls this only after its request snapshot has been prepared. Readiness is
    /// enforced again in Rust; callers never receive the bearer token.
    pub fn stream_if_ready(
        &self,
        app: &AppHandle,
        request: &responses::ResponsesRequest,
        mut callback: impl FnMut(responses::ResponsesEvent) -> std::result::Result<(), String>,
    ) -> Result<()> {
        let (epoch, access) = {
            let _operation = self.operation_guard()?;
            let runtime = self
                .runtime
                .lock()
                .map_err(|_| "ChatGPT connection is unavailable.".to_string())?;
            let model = request.model.as_str();
            if runtime.verified_model.as_deref() != Some(model) {
                return Err("Test this ChatGPT model in Settings before generating.".into());
            }
            let epoch = runtime.epoch;
            drop(runtime);
            let mut record = read_record(app)?
                .ok_or_else(|| "Connect ChatGPT in Settings first.".to_string())?;
            if !record.has_plan_permission() || record.selected_model.as_deref() != Some(model) {
                return Err(
                    "The ChatGPT connection or selected model changed. Test it again in Settings."
                        .into(),
                );
            }
            if record.usage_consent_at.is_none() {
                return Err("Confirm first use of your ChatGPT plan in Settings.".into());
            }
            let access = self.refresh_access(app, &mut record, false)?;
            if !record.has_plan_permission() {
                self.invalidate()?;
                return Err("ChatGPT plan usage permission is no longer available. Reconnect in Settings and allow plan usage.".into());
            }
            (epoch, access)
        };
        let state = self.clone();
        responses::stream_response_with_access_token(&access, request, move |event| {
            if !state.is_epoch_current(epoch, &request.model) {
                return Err("ChatGPT connection changed while this scene was generating.".into());
            }
            callback(event)
        })
    }
}

async fn blocking<T: Send + 'static>(
    action: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(action)
        .await
        .map_err(|error| format!("ChatGPT task failed: {error}"))?
}

#[tauri::command]
pub async fn chatgpt_connection_state(
    app: AppHandle,
    state: State<'_, ChatGPTState>,
) -> Result<ChatGPTConnectionState> {
    let state = state.inner().clone();
    blocking(move || state.connection_state(&app)).await
}

#[tauri::command]
pub async fn chatgpt_acknowledge_usage(
    app: AppHandle,
    state: State<'_, ChatGPTState>,
) -> Result<ChatGPTConnectionState> {
    let state = state.inner().clone();
    blocking(move || state.acknowledge_usage(&app)).await
}

#[tauri::command]
pub async fn chatgpt_connect(
    app: AppHandle,
    state: State<'_, ChatGPTState>,
) -> Result<ChatGPTConnectionState> {
    let state = state.inner().clone();
    blocking(move || state.connect(&app)).await
}

#[tauri::command]
pub async fn chatgpt_set_model(
    app: AppHandle,
    model: String,
    state: State<'_, ChatGPTState>,
) -> Result<ChatGPTConnectionState> {
    let state = state.inner().clone();
    blocking(move || state.set_model(&app, &model)).await
}

#[tauri::command]
pub async fn chatgpt_test_connection(
    app: AppHandle,
    model: String,
    state: State<'_, ChatGPTState>,
) -> Result<ChatGPTConnectionState> {
    let state = state.inner().clone();
    blocking(move || state.test_connection(&app, &model)).await
}

#[tauri::command]
pub async fn chatgpt_disconnect(
    app: AppHandle,
    state: State<'_, ChatGPTState>,
) -> Result<ChatGPTConnectionState> {
    let state = state.inner().clone();
    blocking(move || state.disconnect(&app)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_readiness_requires_both_direct_usage_scopes() {
        assert!(!has_plan_permission(&[
            "openid".into(),
            DIRECT_SCOPE.into()
        ]));
        assert!(!has_plan_permission(&[
            "openid".into(),
            RESOURCE_SCOPE.into()
        ]));
        assert!(has_plan_permission(&[
            DIRECT_SCOPE.into(),
            RESOURCE_SCOPE.into()
        ]));
    }

    #[test]
    fn model_catalog_filters_private_and_incomplete_entries() {
        let body = br#"{"models":[{"slug":"gpt-safe","display_name":"GPT Safe","visibility":"list"},{"slug":"hidden","display_name":"Hidden","visibility":"private"},{"slug":"missing-name","visibility":"list"}]}"#;
        let models = parse_models(200, body).unwrap();
        assert_eq!(
            models,
            vec![ChatGPTModel {
                slug: "gpt-safe".into(),
                display_name: "GPT Safe".into()
            }]
        );
    }

    #[test]
    fn persisted_connection_state_never_implies_readiness() {
        let record = ConnectionRecord {
            version: 2,
            client_id: Some("oaiapp-id".into()),
            subject: Some("subject".into()),
            email: Some("writer@example.com".into()),
            display_name: None,
            scopes: vec![DIRECT_SCOPE.into(), RESOURCE_SCOPE.into()],
            selected_model: Some("gpt-safe".into()),
            credential_slot: Some("slot".into()),
            expires_at: Some(u64::MAX),
            usage_consent_at: Some(1),
            cleanup_slots: Vec::new(),
        };
        let state = state_for(
            Some(&record),
            vec![ChatGPTModel {
                slug: "gpt-safe".into(),
                display_name: "GPT Safe".into(),
            }],
            None,
            None,
            None,
        );
        assert_eq!(state.status, ChatGPTStatus::Connected);
        assert!(!state.ready);
    }

    #[test]
    fn selected_model_requires_runtime_successful_test() {
        let record = ConnectionRecord {
            version: 2,
            client_id: Some("oaiapp-id".into()),
            subject: Some("subject".into()),
            email: None,
            display_name: None,
            scopes: vec![DIRECT_SCOPE.into(), RESOURCE_SCOPE.into()],
            selected_model: Some("gpt-safe".into()),
            credential_slot: Some("slot".into()),
            expires_at: Some(u64::MAX),
            usage_consent_at: Some(1),
            cleanup_slots: Vec::new(),
        };
        let models = vec![ChatGPTModel {
            slug: "gpt-safe".into(),
            display_name: "GPT Safe".into(),
        }];
        assert!(!state_for(Some(&record), models.clone(), None, None, None).ready);
        assert!(state_for(Some(&record), models, Some("gpt-safe"), None, None).ready);
    }

    #[test]
    fn credential_rotation_requires_a_replacement_refresh_token() {
        let token = TokenResponse {
            access_token: "access".into(),
            refresh_token: None,
            id_token: None,
            token_type: Some("Bearer".into()),
            expires_in: Some(3600),
            scope: None,
        };
        assert!(!has_replacement_refresh(&token));
    }

    #[test]
    fn disconnect_attempts_every_secret_and_records_slots_that_failed() {
        let slots = vec!["active".to_string(), "old".to_string()];
        let mut attempted = Vec::new();
        let pending = cleanup_credential_slots(&slots, |slot, name| {
            attempted.push(format!("{slot}/{name}"));
            if slot == "active" && name == "refresh" {
                Err("locked".into())
            } else {
                Ok(())
            }
        });
        assert_eq!(attempted.len(), 6);
        assert_eq!(pending, vec!["active"]);
    }

    #[test]
    fn disconnect_clears_local_account_and_usage_consent_before_cleanup() {
        let mut record = ConnectionRecord {
            version: 2,
            client_id: Some("oaiapp-id".into()),
            subject: Some("subject".into()),
            email: Some("writer@example.com".into()),
            display_name: Some("Writer".into()),
            scopes: vec![DIRECT_SCOPE.into(), RESOURCE_SCOPE.into()],
            selected_model: Some("gpt-safe".into()),
            credential_slot: Some("active-slot".into()),
            expires_at: Some(u64::MAX),
            usage_consent_at: Some(1),
            cleanup_slots: vec!["older-slot".into()],
        };
        let active_slot = record.credential_slot.clone();
        let slots = mark_locally_disconnected(&mut record, active_slot);
        assert_eq!(slots, vec!["older-slot", "active-slot"]);
        assert_eq!(record.credential_slot, None);
        assert_eq!(record.client_id, None);
        assert_eq!(record.subject, None);
        assert_eq!(record.email, None);
        assert!(record.scopes.is_empty());
        assert_eq!(record.usage_consent_at, None);
        assert_eq!(
            state_for(Some(&record), Vec::new(), None, None, None).status,
            ChatGPTStatus::Disconnected
        );
    }

    #[test]
    fn first_use_acknowledgement_is_pending_only_after_plan_permission_is_granted() {
        let record = ConnectionRecord {
            version: 2,
            client_id: Some("oaiapp-id".into()),
            subject: Some("subject".into()),
            email: None,
            display_name: None,
            scopes: vec![DIRECT_SCOPE.into(), RESOURCE_SCOPE.into()],
            selected_model: None,
            credential_slot: Some("slot".into()),
            expires_at: Some(u64::MAX),
            usage_consent_at: None,
            cleanup_slots: Vec::new(),
        };
        let state = state_for(Some(&record), Vec::new(), None, None, None);
        assert!(state.first_use_pending);
        assert!(!state.usage_acknowledged);

        let denied = ConnectionRecord {
            scopes: vec!["openid".into()],
            ..record
        };
        let state = state_for(Some(&denied), Vec::new(), None, None, None);
        assert_eq!(state.status, ChatGPTStatus::NeedsPlanPermission);
        assert!(!state.first_use_pending);
    }
}
