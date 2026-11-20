mod backend;
pub mod chatgpt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(backend::BackendState::default())
        .manage(backend::generation::GenerationState::default())
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
            backend::generation::start_scene_generation,
            backend::generation::stop_scene_generation,
            backend::generation::scene_generation_jobs,
            backend::generation::accept_scene_generation,
            backend::generation::discard_scene_generation,
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
