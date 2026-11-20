//! Runtime data paths for the portable Windows build.
//!
//! A portable package is opted in by a `portable.mode` file beside the
//! executable whose contents are exactly `portable-data-v1`. No path is
//! resolved relative to the process working directory.

use serde::Serialize;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
use tauri::{utils::config::AppDirectoriesOverride, AppHandle, Context, Manager, State, Wry};
use uuid::Uuid;

pub const PORTABLE_MARKER_FILE: &str = "portable.mode";
/// Kept as a literal in the native binary so the packaging script can fail
/// closed if it is about to ship an executable without portable path support.
pub const PORTABLE_MARKER_CONTENT: &str = "portable-data-v1";
const PORTABLE_DATA_DIRECTORY: &str = "data";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DataLocation {
    pub portable: bool,
    /// Present only when the `portable.mode` contract is enabled.
    pub data_directory: Option<PathBuf>,
    /// Directory containing the executable when portable mode is enabled.
    pub executable_directory: Option<PathBuf>,
}

impl DataLocation {
    fn standard() -> Self {
        Self {
            portable: false,
            data_directory: None,
            executable_directory: None,
        }
    }

    fn portable(executable_directory: PathBuf) -> Self {
        Self {
            portable: true,
            data_directory: Some(executable_directory.join(PORTABLE_DATA_DIRECTORY)),
            executable_directory: Some(executable_directory),
        }
    }
}

/// Settings-page runtime information. The active WebView2 flag means this
/// window successfully started on Windows, so the required runtime is active.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortableRuntimeInfo {
    pub portable: bool,
    pub data_directory: String,
    pub application_version: String,
    pub webview2_required: bool,
    pub webview2_runtime_active: bool,
}

#[derive(Clone, Debug)]
pub struct PortableState {
    location: DataLocation,
}

impl PortableState {
    pub fn new(location: DataLocation) -> Self {
        Self { location }
    }
}

/// Determine the data mode from an explicit executable path.
///
/// This is separated from `current_exe()` so marker behavior can be tested
/// without modifying the real application folder.
pub fn detect_at(executable: &Path) -> Result<DataLocation, String> {
    if !executable.is_absolute() {
        return Err("Could not resolve the application executable to an absolute path.".into());
    }
    let executable_directory = executable
        .parent()
        .ok_or_else(|| "Could not locate the application folder.".to_string())?;
    let marker = executable_directory.join(PORTABLE_MARKER_FILE);
    let contents = match fs::read_to_string(&marker) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DataLocation::standard())
        }
        Err(_) => {
            return Err(format!(
                "Could not read the portable mode marker at '{}'. Preserve the application folder and check its permissions.",
                marker.display()
            ))
        }
    };
    // PowerShell's Set-Content (used by the portable packager) terminates the
    // marker line. Accept that one line ending, while rejecting extra content
    // or leading whitespace so the marker contract stays unambiguous.
    let marker_line = contents
        .strip_suffix("\r\n")
        .or_else(|| contents.strip_suffix('\n'))
        .unwrap_or(&contents);
    if marker_line != PORTABLE_MARKER_CONTENT {
        return Err(format!(
            "The portable mode marker at '{}' is invalid. Restore the portable.mode file from the original Shorthand Writer archive.",
            marker.display()
        ));
    }
    Ok(DataLocation::portable(executable_directory.to_path_buf()))
}

/// Resolve the mode from the actual running executable, never the working
/// directory. Call `preflight_writable` before handing a portable path to Tauri.
pub fn detect_current() -> Result<DataLocation, String> {
    let executable = std::env::current_exe()
        .map_err(|_| "Could not locate the running Shorthand Writer executable.".to_string())?;
    detect_at(&executable)
}

/// Create the portable data folder and verify that it is writable. A read-only
/// archive location must fail before Tauri/WebView2 silently falls back elsewhere.
pub fn preflight_writable(location: &DataLocation) -> Result<(), String> {
    let Some(data_directory) = location.data_directory.as_deref() else {
        return Ok(());
    };
    if let Err(error) = fs::create_dir_all(data_directory) {
        return Err(format!(
            "Shorthand Writer cannot create its portable data folder '{}': {error}. Move the app to a writable folder and relaunch.",
            data_directory.display()
        ));
    }
    if !data_directory.is_dir() {
        return Err(format!(
            "The portable data location '{}' is not a folder. Move Shorthand Writer to a writable folder and relaunch.",
            data_directory.display()
        ));
    }

    let probe = data_directory.join(format!(".shorthand-write-check-{}", Uuid::new_v4()));
    let write_result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)
            .map_err(|error| error.to_string())?;
        file.write_all(b"portable data check")
            .map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        fs::remove_file(&probe).map_err(|error| error.to_string())
    })();
    if let Err(error) = write_result {
        // Remove only the uniquely named probe created by this invocation.
        let _ = fs::remove_file(&probe);
        return Err(format!(
            "Shorthand Writer cannot write to its portable data folder '{}': {error}. Move the app to a writable folder and relaunch.",
            data_directory.display()
        ));
    }
    Ok(())
}

/// Enable Tauri's dedicated app directories override for the portable build.
/// Tauri uses the local-data directory as the default Windows WebView2 profile
/// path, so settings, cache, logs, and the WebView profile all stay under
/// `<executable folder>/data`.
pub fn apply_to_context(context: &mut Context<Wry>, location: &DataLocation) {
    if let Some(data_directory) = &location.data_directory {
        context.config_mut().app.app_directories_override =
            Some(AppDirectoriesOverride::Root(data_directory.clone()));
    }
}

/// Report the effective data directory for the Settings page.
pub fn settings_info(
    app: &AppHandle,
    location: &DataLocation,
) -> Result<PortableRuntimeInfo, String> {
    let data_directory = match location.data_directory.as_ref() {
        Some(path) => path.clone(),
        None => app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Could not resolve the application data folder: {error}"))?,
    };
    Ok(PortableRuntimeInfo {
        portable: location.portable,
        data_directory: data_directory.to_string_lossy().into_owned(),
        application_version: env!("CARGO_PKG_VERSION").into(),
        webview2_required: cfg!(target_os = "windows"),
        // Reaching this command means the native window and WebView2 were able
        // to start successfully on Windows.
        webview2_runtime_active: cfg!(target_os = "windows"),
    })
}

#[tauri::command]
pub fn app_runtime_info(
    app: AppHandle,
    state: State<'_, PortableState>,
) -> Result<PortableRuntimeInfo, String> {
    settings_info(&app, &state.location)
}

/// Show a useful diagnostic before the desktop event loop starts. Portable
/// marker/data-folder errors must not disappear into a GUI process with no
/// console window.
#[cfg(windows)]
pub fn show_startup_error(message: &str) {
    use windows::{
        core::PCWSTR,
        Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK},
    };

    let text: Vec<u16> = message.encode_utf16().chain(std::iter::once(0)).collect();
    let caption: Vec<u16> = "Shorthand Writer could not start\0"
        .encode_utf16()
        .collect();
    unsafe {
        let _ = MessageBoxW(
            None,
            PCWSTR(text.as_ptr()),
            PCWSTR(caption.as_ptr()),
            MB_ICONERROR | MB_OK,
        );
    }
}

#[cfg(not(windows))]
pub fn show_startup_error(message: &str) {
    eprintln!("Shorthand Writer could not start: {message}");
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDirectory(PathBuf);

    impl TempDirectory {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("shorthand-portable-test-{}", Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }

        fn executable(&self) -> PathBuf {
            self.0.join("Shorthand Writer.exe")
        }
    }

    impl Drop for TempDirectory {
        fn drop(&mut self) {
            // This is the exact unique directory created by this test helper.
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn missing_marker_keeps_standard_application_paths() {
        let directory = TempDirectory::new();
        let location = detect_at(&directory.executable()).unwrap();
        assert_eq!(location, DataLocation::standard());
    }

    #[test]
    fn portable_marker_selects_data_beside_the_executable() {
        let directory = TempDirectory::new();
        fs::write(
            directory.0.join(PORTABLE_MARKER_FILE),
            format!("{PORTABLE_MARKER_CONTENT}\r\n"),
        )
        .unwrap();

        let location = detect_at(&directory.executable()).unwrap();
        assert!(location.portable);
        assert_eq!(location.executable_directory, Some(directory.0.clone()));
        assert_eq!(location.data_directory, Some(directory.0.join("data")));
        preflight_writable(&location).unwrap();
        assert!(directory.0.join("data").is_dir());
        assert_eq!(
            fs::read_dir(directory.0.join("data")).unwrap().count(),
            0,
            "the writable probe should be removed"
        );
    }

    #[test]
    fn invalid_marker_fails_with_recovery_guidance() {
        let directory = TempDirectory::new();
        fs::write(directory.0.join(PORTABLE_MARKER_FILE), "portable-data-v0").unwrap();
        let error = detect_at(&directory.executable()).unwrap_err();
        assert!(error.contains("portable mode marker"));
        assert!(error.contains("original Shorthand Writer archive"));
    }

    #[test]
    fn data_resolution_uses_executable_parent_not_working_directory() {
        let executable_directory = TempDirectory::new();
        let unrelated_working_directory = TempDirectory::new();
        fs::write(
            executable_directory.0.join(PORTABLE_MARKER_FILE),
            PORTABLE_MARKER_CONTENT,
        )
        .unwrap();

        // The injectable executable path is absolute and independent of CWD.
        let location = detect_at(&executable_directory.executable()).unwrap();
        assert_eq!(
            location.data_directory,
            Some(executable_directory.0.join("data"))
        );
        assert_ne!(
            location.data_directory,
            Some(unrelated_working_directory.0.join("data"))
        );
    }

    #[test]
    fn relative_executable_paths_are_rejected() {
        let error = detect_at(Path::new("Shorthand Writer.exe")).unwrap_err();
        assert!(error.contains("absolute path"));
    }
}
