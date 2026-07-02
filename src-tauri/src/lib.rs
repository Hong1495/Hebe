pub struct PendingOpenFiles(std::sync::Mutex<Vec<String>>);

#[tauri::command]
fn take_pending_open_files(pending: tauri::State<'_, PendingOpenFiles>) -> Vec<String> {
    match pending.0.lock() {
        Ok(mut paths) => std::mem::take(&mut *paths),
        Err(_) => Vec::new(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::menu::{
        CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
    };
    use tauri::{Emitter, Manager};

    tauri::Builder::default()
        .manage(PendingOpenFiles(
            std::sync::Mutex::new(startup_open_paths()),
        ))
        .menu(|handle| {
            let settings = MenuItemBuilder::with_id("toggle-settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
                .build(handle)?;
            let help = MenuItemBuilder::with_id("hebe-help", "Hebe Help")
                .enabled(false)
                .build(handle)?;
            let open_file = MenuItemBuilder::with_id("open-file", "Open File")
                .accelerator("CmdOrCtrl+O")
                .build(handle)?;
            let open_folder = MenuItemBuilder::with_id("open-folder", "Open Folder")
                .accelerator("CmdOrCtrl+Shift+O")
                .build(handle)?;
            let new_document = MenuItemBuilder::with_id("new-document", "New Document")
                .accelerator("CmdOrCtrl+N")
                .build(handle)?;
            let save_file = MenuItemBuilder::with_id("save-file", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(handle)?;
            let export_pdf = MenuItemBuilder::with_id("export-pdf", "PDF").build(handle)?;
            let export_docx = MenuItemBuilder::with_id("export-docx", "DOCX").build(handle)?;
            let export_html = MenuItemBuilder::with_id("export-html", "HTML").build(handle)?;
            let export_epub = MenuItemBuilder::with_id("export-epub", "EPUB").build(handle)?;
            let quick_open = MenuItemBuilder::with_id("quick-open", "Quick Open")
                .accelerator("CmdOrCtrl+P")
                .build(handle)?;
            let global_search = MenuItemBuilder::with_id("global-search", "Search in Folder")
                .accelerator("CmdOrCtrl+Shift+F")
                .build(handle)?;
            let toggle_files = CheckMenuItemBuilder::with_id("toggle-sidebar", "Files Sidebar")
                .accelerator("CmdOrCtrl+B")
                .checked(false)
                .build(handle)?;
            let toggle_outline = CheckMenuItemBuilder::with_id("toggle-outline", "Outline")
                .accelerator("CmdOrCtrl+Shift+B")
                .checked(false)
                .build(handle)?;
            let focus_mode = CheckMenuItemBuilder::with_id("toggle-focus", "Focus Mode")
                .accelerator("CmdOrCtrl+Alt+F")
                .checked(false)
                .build(handle)?;
            let typewriter_mode =
                CheckMenuItemBuilder::with_id("toggle-typewriter", "Typewriter Mode")
                    .accelerator("CmdOrCtrl+Alt+T")
                    .checked(false)
                    .build(handle)?;
            let zoom_in = MenuItemBuilder::with_id("zoom-in", "Zoom In")
                .accelerator("CmdOrCtrl+Plus")
                .build(handle)?;
            let zoom_out = MenuItemBuilder::with_id("zoom-out", "Zoom Out")
                .accelerator("CmdOrCtrl+-")
                .build(handle)?;
            let zoom_reset = MenuItemBuilder::with_id("zoom-reset", "Actual Size")
                .accelerator("CmdOrCtrl+0")
                .build(handle)?;

            let app_menu = SubmenuBuilder::new(handle, "Hebe")
                .item(&PredefinedMenuItem::about(handle, None, None)?)
                .separator()
                .item(&settings)
                .separator()
                .item(&PredefinedMenuItem::services(handle, None)?)
                .separator()
                .item(&PredefinedMenuItem::hide(handle, None)?)
                .item(&PredefinedMenuItem::hide_others(handle, None)?)
                .item(&PredefinedMenuItem::show_all(handle, None)?)
                .separator()
                .item(&PredefinedMenuItem::quit(handle, None)?)
                .build()?;

            let export_menu = SubmenuBuilder::new(handle, "Export")
                .item(&export_pdf)
                .item(&export_docx)
                .item(&export_html)
                .item(&export_epub)
                .build()?;
            let file_menu = SubmenuBuilder::new(handle, "File")
                .item(&new_document)
                .item(&open_file)
                .item(&open_folder)
                .item(&save_file)
                .item(&export_menu)
                .build()?;
            let edit_menu = SubmenuBuilder::new(handle, "Edit")
                .item(&PredefinedMenuItem::undo(handle, None)?)
                .item(&PredefinedMenuItem::redo(handle, None)?)
                .separator()
                .item(&PredefinedMenuItem::cut(handle, None)?)
                .item(&PredefinedMenuItem::copy(handle, None)?)
                .item(&PredefinedMenuItem::paste(handle, None)?)
                .item(&PredefinedMenuItem::select_all(handle, None)?)
                .build()?;
            let view_menu = SubmenuBuilder::new(handle, "View")
                .item(&toggle_files)
                .item(&toggle_outline)
                .separator()
                .item(&focus_mode)
                .item(&typewriter_mode)
                .separator()
                .item(&zoom_in)
                .item(&zoom_out)
                .item(&zoom_reset)
                .separator()
                .item(&PredefinedMenuItem::fullscreen(handle, None)?)
                .build()?;
            let navigate_menu = SubmenuBuilder::new(handle, "Navigate")
                .item(&quick_open)
                .item(&global_search)
                .build()?;
            let window_menu = SubmenuBuilder::new(handle, "Window")
                .item(&PredefinedMenuItem::minimize(handle, None)?)
                .item(&PredefinedMenuItem::maximize(handle, None)?)
                .separator()
                .item(&PredefinedMenuItem::bring_all_to_front(handle, None)?)
                .build()?;
            let help_menu = SubmenuBuilder::new(handle, "Help").item(&help).build()?;

            MenuBuilder::new(handle)
                .item(&app_menu)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&navigate_menu)
                .item(&window_menu)
                .item(&help_menu)
                .build()
        })
        .on_menu_event(|app, event| {
            let action = event.id().as_ref().to_string();
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("menu-action", action);
            } else {
                let _ = app.emit("menu-action", action);
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
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
            take_pending_open_files,
            commands::read_markdown_file,
            commands::write_markdown_file,
            commands::get_file_mtime,
            commands::get_heading_outline,
            commands::list_directory,
            commands::list_markdown_files,
            commands::export_document,
            commands::search_fulltext,
            commands::paste_image,
            commands::reveal_in_finder,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                let paths = file_urls_to_paths(urls);
                if !paths.is_empty() {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.emit("open-files", paths.clone());
                    }
                    if let Ok(mut pending) = app.state::<PendingOpenFiles>().0.lock() {
                        pending.extend(paths);
                    }
                }
            }

            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}

fn startup_open_paths() -> Vec<String> {
    std::env::args_os()
        .skip(1)
        .filter_map(|arg| {
            let path = std::path::PathBuf::from(arg);
            if path.is_file() && is_markdown_path(&path) {
                Some(path.to_string_lossy().to_string())
            } else {
                None
            }
        })
        .collect()
}

#[cfg(target_os = "macos")]
fn file_urls_to_paths(urls: &[tauri::Url]) -> Vec<String> {
    urls.iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter(|path| path.is_file() && is_markdown_path(path))
        .map(|path| path.to_string_lossy().to_string())
        .collect()
}

fn is_markdown_path(path: &std::path::Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase()),
        Some(extension)
            if matches!(extension.as_str(), "md" | "markdown" | "mdx" | "mkd" | "mkdn")
    )
}

mod commands;
