//! Native command boundary. The renderer receives an opaque token for the currently
//! open project and can submit typed domain operations, never SQL or filesystem reads.
mod domain;
mod relationships;
pub mod generation;
mod storage;

use domain::{new_id, Operation, ProjectSnapshot, Result};
use serde::Serialize;
use std::{
    fs::OpenOptions,
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
    fn install(&self, database: Database) -> Result<OpenProject> {
        let mut database = database.working_copy()?;
        database.interrupt_unfinished_generation_jobs(generation::timestamp_ms())?;
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

    fn is_current_session(&self, session_id: &str) -> bool {
        self.session
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|session| session.id == session_id))
            .unwrap_or(false)
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
pub async fn save_project(
    session_id: String,
    state: tauri::State<'_, BackendState>,
) -> Result<ProjectSnapshot> {
    let state = state.inner().clone();
    blocking(move || state.with_project(&session_id, Database::save)).await
}

#[tauri::command]
pub async fn project_has_unsaved_changes(
    session_id: String,
    state: tauri::State<'_, BackendState>,
) -> Result<bool> {
    let state = state.inner().clone();
    blocking(move || state.with_project(&session_id, |database| Ok(database.has_unsaved_changes())))
        .await
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

#[tauri::command]
pub async fn write_compiled_manuscript(path: String, contents: String) -> Result<()> {
    blocking(move || {
        let path = compiled_manuscript_path(&path)?;
        write_compiled_manuscript_file(path, &contents)
    })
    .await
}

#[tauri::command]
pub async fn write_relationship_svg(path: String, contents: String) -> Result<()> {
    blocking(move || {
        let destination = Path::new(&path);
        if !destination.is_absolute() || !destination.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("svg")) {
            return Err("Choose an absolute .svg export path.".into());
        }
        if contents.len() > 4_000_000 || !contents.trim_start().starts_with("<svg") {
            return Err("The relationship graph must be an SVG smaller than 4 MB.".into());
        }
        write_compiled_manuscript_file(destination, &contents)
    }).await
}

fn compiled_manuscript_path(path: &str) -> Result<&Path> {
    let path = Path::new(path);
    if !path.is_absolute()
        || !path.extension().is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md")
                || extension.eq_ignore_ascii_case("txt")
                || extension.eq_ignore_ascii_case("html")
        })
    {
        return Err("Choose an absolute Markdown, plain text, or HTML export path.".into());
    }
    Ok(path)
}

fn write_compiled_manuscript_file(path: &Path, contents: &str) -> Result<()> {
    let temporary = path.with_file_name(format!(".shorthand-compiled-manuscript-{}.tmp", new_id()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|e| format!("Could not create compiled manuscript: {e}"))?;
    let result = (|| {
        file.write_all(contents.as_bytes())
            .map_err(|e| format!("Could not write compiled manuscript: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("Could not save compiled manuscript: {e}"))?;
        drop(file);
        replace_compiled_file(&temporary, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}

#[cfg(windows)]
fn replace_compiled_file(temporary: &Path, destination: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        },
    };
    let temporary: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    unsafe {
        MoveFileExW(
            PCWSTR::from_raw(temporary.as_ptr()),
            PCWSTR::from_raw(destination.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(|error| format!("Could not finish writing compiled manuscript: {error}"))
}

#[cfg(not(windows))]
fn replace_compiled_file(temporary: &Path, destination: &Path) -> Result<()> {
    std::fs::rename(temporary, destination)
        .map_err(|error| format!("Could not finish writing compiled manuscript: {error}"))
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
