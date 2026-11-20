fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "create_project",
            "open_project",
            "read_project",
            "apply_operation",
            "export_markdown",
            "import_markdown",
            "close_project",
            "import_markdown_file",
            "export_markdown_file",
            "chatgpt_connection_state",
            "chatgpt_acknowledge_usage",
            "chatgpt_connect",
            "chatgpt_set_model",
            "chatgpt_test_connection",
            "chatgpt_disconnect",
        ]),
    ))
    .expect("failed to build the desktop application manifest");
}
