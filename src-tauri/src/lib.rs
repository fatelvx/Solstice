pub mod editor;
pub mod formats;
pub mod models;

use editor::commands::SharedState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SharedState::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            editor::commands::editor_new_chart,
            editor::commands::editor_open_sol,
            editor::commands::editor_save_sol,
            editor::commands::editor_get_chart,
            editor::commands::editor_place_note,
            editor::commands::editor_remove_note,
            editor::commands::editor_undo,
            editor::commands::editor_redo,
            editor::commands::editor_set_bpm,
            editor::commands::editor_remove_bpm,
            editor::commands::editor_set_stop,
            editor::commands::editor_set_offset,
            editor::commands::editor_set_audio,
            editor::commands::editor_read_audio,
            editor::commands::editor_pick_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
