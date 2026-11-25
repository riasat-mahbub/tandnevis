mod backend;
pub mod chatgpt;
pub mod portable;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let location = match portable::detect_current().and_then(|location| {
        portable::preflight_writable(&location)?;
        Ok(location)
    }) {
        Ok(location) => location,
        Err(error) => {
            portable::show_startup_error(&error);
            return;
        }
    };
    let mut context = tauri::generate_context!();
    portable::apply_to_context(&mut context, &location);
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(backend::BackendState::default())
        .manage(backend::generation::GenerationState::default())
        .manage(chatgpt::ChatGPTState::default())
        .manage(portable::PortableState::new(location))
        .invoke_handler(tauri::generate_handler![
            backend::create_project,
            backend::open_project,
            backend::read_project,
            backend::save_project,
            backend::project_has_unsaved_changes,
            backend::apply_operation,
            backend::export_markdown,
            backend::import_markdown,
            backend::close_project,
            backend::import_markdown_file,
            backend::export_markdown_file,
            backend::write_compiled_manuscript,
            backend::generation::start_scene_generation,
            backend::generation::stop_scene_generation,
            backend::generation::scene_generation_jobs,
            backend::generation::accept_scene_generation,
            backend::generation::discard_scene_generation,
            portable::app_runtime_info,
            chatgpt::chatgpt_connection_state,
            chatgpt::chatgpt_acknowledge_usage,
            chatgpt::chatgpt_connect,
            chatgpt::chatgpt_set_model,
            chatgpt::chatgpt_test_connection,
            chatgpt::chatgpt_disconnect,
        ])
        .run(context);
    if let Err(error) = result {
        portable::show_startup_error(&format!(
            "Shorthand Writer could not start.\n\n{error}\n\nIf this message mentions WebView2, install the Microsoft Edge WebView2 Evergreen Runtime and restart the app."
        ));
    }
}
