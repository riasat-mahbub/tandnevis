mod backend;
pub mod chatgpt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(backend::BackendState::default())
        .manage(chatgpt::ChatGPTState::default())
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
            chatgpt::chatgpt_connection_state,
            chatgpt::chatgpt_acknowledge_usage,
            chatgpt::chatgpt_connect,
            chatgpt::chatgpt_set_model,
            chatgpt::chatgpt_test_connection,
            chatgpt::chatgpt_disconnect,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Shorthand Writer");
}
