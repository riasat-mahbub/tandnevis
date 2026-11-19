fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "create_project",
                "open_project",
                "read_project",
                "apply_operation",
                "export_markdown",
                "import_markdown",
            ]),
        ),
    )
    .expect("failed to build the desktop application manifest");
}
