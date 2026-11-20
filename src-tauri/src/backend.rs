//! Native command boundary. The renderer receives an opaque token for the currently
//! open project and can submit typed domain operations, never SQL or filesystem reads.
mod domain;
mod storage;

use domain::{new_id, Operation, ProjectSnapshot, Result};
use serde::Serialize;
use std::{
    io::{Read, Write},
    path::Path,
    sync::{Arc, Mutex},
};
use storage::Database;

struct Session {
    id: String,
    database: Database,
}
#[derive(Clone, Default)]
pub struct BackendState {
    session: Arc<Mutex<Option<Session>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProject {
    pub session_id: String,
    pub project: ProjectSnapshot,
}

impl BackendState {
    fn install(&self, mut database: Database) -> Result<OpenProject> {
        let project = database.read()?;
        let id = new_id();
        let mut session = self
            .session
            .lock()
            .map_err(|_| "Project session is unavailable. Restart the app.")?;
        *session = Some(Session {
            id: id.clone(),
            database,
        });
        Ok(OpenProject {
            session_id: id,
            project,
        })
    }
    fn with_project<T>(
        &self,
        session_id: &str,
        action: impl FnOnce(&mut Database) -> Result<T>,
    ) -> Result<T> {
        let mut guard = self
            .session
            .lock()
            .map_err(|_| "Project session is unavailable. Restart the app.")?;
        let session = guard.as_mut().ok_or("Open a project first.")?;
        if session.id != session_id {
            return Err("This project session has closed. Reload the current project.".into());
        }
        action(&mut session.database)
    }
}

async fn blocking<T: Send + 'static>(
    action: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(action)
        .await
        .map_err(|e| format!("Native project task failed: {e}"))?
}

#[tauri::command]
pub async fn create_project(
    path: String,
    title: String,
    state: tauri::State<'_, BackendState>,
) -> Result<OpenProject> {
    let state = state.inner().clone();
    blocking(move || state.install(Database::create(&path, title)?)).await
}
#[tauri::command]
pub async fn open_project(
    path: String,
    state: tauri::State<'_, BackendState>,
) -> Result<OpenProject> {
    let state = state.inner().clone();
    blocking(move || state.install(Database::open(&path)?)).await
}
#[tauri::command]
pub async fn read_project(
    session_id: String,
    state: tauri::State<'_, BackendState>,
) -> Result<ProjectSnapshot> {
    let state = state.inner().clone();
    blocking(move || state.with_project(&session_id, Database::read)).await
}
#[tauri::command]
pub async fn apply_operation(
    session_id: String,
    expected_revision: u64,
    operation: Operation,
    state: tauri::State<'_, BackendState>,
) -> Result<ProjectSnapshot> {
    let state = state.inner().clone();
    blocking(move || state.with_project(&session_id, |db| db.apply(expected_revision, operation)))
        .await
}
#[tauri::command]
pub async fn export_markdown(
    session_id: String,
    state: tauri::State<'_, BackendState>,
) -> Result<String> {
    let state = state.inner().clone();
    blocking(move || state.with_project(&session_id, |db| Ok(db.read()?.markdown()))).await
}
#[tauri::command]
pub async fn import_markdown(
    session_id: String,
    expected_revision: u64,
    markdown: String,
    state: tauri::State<'_, BackendState>,
) -> Result<ProjectSnapshot> {
    let state = state.inner().clone();
    blocking(move || state.with_project(&session_id, |db| db.import(expected_revision, &markdown)))
        .await
}

#[tauri::command]
pub async fn close_project(
    session_id: String,
    state: tauri::State<'_, BackendState>,
) -> Result<()> {
    let state = state.inner().clone();
    blocking(move || {
        let mut session = state
            .session
            .lock()
            .map_err(|_| "Project session is unavailable. Restart the app.")?;
        if session.as_ref().is_none_or(|s| s.id != session_id) {
            return Err("This project session has closed.".into());
        }
        *session = None;
        Ok(())
    })
    .await
}

fn markdown_path(path: &str) -> Result<&Path> {
    let path = Path::new(path);
    if !path.is_absolute()
        || !path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"))
    {
        return Err("Choose an absolute Markdown path ending in .md or .markdown.".into());
    }
    Ok(path)
}

#[tauri::command]
pub async fn import_markdown_file(
    session_id: String,
    expected_revision: u64,
    path: String,
    state: tauri::State<'_, BackendState>,
) -> Result<ProjectSnapshot> {
    let state = state.inner().clone();
    blocking(move || {
        state.with_project(&session_id, |db| {
            let path = markdown_path(&path)?;
            let mut markdown = String::new();
            std::fs::File::open(path)
                .map_err(|e| format!("Could not read Markdown: {e}"))?
                .take(16_000_001)
                .read_to_string(&mut markdown)
                .map_err(|e| format!("Could not read UTF-8 Markdown: {e}"))?;
            db.import(expected_revision, &markdown)
        })
    })
    .await
}

#[tauri::command]
pub async fn export_markdown_file(
    session_id: String,
    path: String,
    state: tauri::State<'_, BackendState>,
) -> Result<()> {
    let state = state.inner().clone();
    blocking(move || {
        state.with_project(&session_id, |db| {
            let path = markdown_path(&path)?;
            let markdown = db.read()?.markdown();
            write_markdown(path, &markdown)
        })
    })
    .await
}

fn write_markdown(path: &Path, markdown: &str) -> Result<()> {
    let temporary = path.with_file_name(format!(".shorthand-export-{}.tmp", new_id()));
    let mut file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|e| format!("Could not create export: {e}"))?;
    let result = (|| {
        file.write_all(markdown.as_bytes())
            .map_err(|e| format!("Could not write export: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("Could not save export: {e}"))?;
        drop(file);
        std::fs::rename(&temporary, path).map_err(|e| format!("Could not finish export: {e}"))
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}

#[cfg(test)]
mod tests;
