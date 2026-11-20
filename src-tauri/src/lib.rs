mod backend;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(backend::BackendState::default())
        .invoke_handler(tauri::generate_handler![
            backend::create_project,
            backend::open_project,
            backend::read_project,
            backend::apply_operation,
            backend::export_markdown,
            backend::import_markdown,
            backend::close_project,
            backend::import_markdown_file,
            backend::export_markdown_file,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Shorthand Writer");
}
