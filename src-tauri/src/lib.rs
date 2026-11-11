use std::sync::atomic::{AtomicBool, Ordering};

pub struct ExitApproved(AtomicBool);

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    use tauri::Manager;
    app.state::<ExitApproved>().0.store(true, Ordering::SeqCst);
    app.exit(0);
}

pub struct PendingOpenFiles(std::sync::Mutex<Vec<String>>);

#[tauri::command]
fn take_pending_open_files(pending: tauri::State<'_, PendingOpenFiles>) -> Vec<String> {
    match pending.0.lock() {
        Ok(mut paths) => std::mem::take(&mut *paths),
        Err(_) => Vec::new(),
    }
}

#[tauri::command]
fn hide_main_window(window: tauri::Window) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::menu::{
        CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
    };
    use tauri::{Emitter, Manager};

    tauri::Builder::default()
        .manage(ExitApproved(AtomicBool::new(false)))
        .manage(restart::RestartTarget::capture())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingOpenFiles(
            std::sync::Mutex::new(startup_open_paths()),
        ))
        .menu(|handle| {
            let quit = MenuItemBuilder::with_id("quit-request", "Quit Hebe")
                .accelerator("CmdOrCtrl+Q")
                .build(handle)?;
            let settings = MenuItemBuilder::with_id("toggle-settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
                .build(handle)?;
            let updates =
                MenuItemBuilder::with_id("check-updates", "Check for Updates…").build(handle)?;
            let help = MenuItemBuilder::with_id("hebe-help", "Hebe Help")
                .enabled(false)
                .build(handle)?;
            let open_file = MenuItemBuilder::with_id("open-file", "Open File")
                .accelerator("CmdOrCtrl+O")
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
            let source_mode = CheckMenuItemBuilder::with_id("toggle-source", "Source Code Mode")
                .accelerator("CmdOrCtrl+/")
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
            let format_bold = MenuItemBuilder::with_id("format-bold", "Bold")
                .accelerator("CmdOrCtrl+B")
                .build(handle)?;
            let format_italic = MenuItemBuilder::with_id("format-italic", "Italic")
                .accelerator("CmdOrCtrl+I")
                .build(handle)?;
            let format_strike = MenuItemBuilder::with_id("format-strike", "Strikethrough")
                .accelerator("CmdOrCtrl+Shift+X")
                .build(handle)?;
            let format_inline_code = MenuItemBuilder::with_id("format-inline-code", "Inline Code")
                .accelerator("CmdOrCtrl+E")
                .build(handle)?;
            let format_link = MenuItemBuilder::with_id("format-link", "Link")
                .accelerator("CmdOrCtrl+K")
                .build(handle)?;
            let format_h1 = MenuItemBuilder::with_id("format-heading-1", "Heading 1")
                .accelerator("CmdOrCtrl+Alt+1")
                .build(handle)?;
            let format_h2 = MenuItemBuilder::with_id("format-heading-2", "Heading 2")
                .accelerator("CmdOrCtrl+Alt+2")
                .build(handle)?;
            let format_h3 = MenuItemBuilder::with_id("format-heading-3", "Heading 3")
                .accelerator("CmdOrCtrl+Alt+3")
                .build(handle)?;
            let format_bullet_list = MenuItemBuilder::with_id("format-bullet-list", "Bullet List")
                .accelerator("CmdOrCtrl+Shift+8")
                .build(handle)?;
            let format_ordered_list =
                MenuItemBuilder::with_id("format-ordered-list", "Ordered List")
                    .accelerator("CmdOrCtrl+Shift+7")
                    .build(handle)?;
            let insert_image = MenuItemBuilder::with_id("insert-image", "Image from File…").build(handle)?;
            let insert_toc = MenuItemBuilder::with_id("insert-toc", "Table of Contents").build(handle)?;
            let insert_footnote = MenuItemBuilder::with_id("insert-footnote", "Footnote").build(handle)?;
            let format_task_list =
                MenuItemBuilder::with_id("format-task-list", "Task List").build(handle)?;
            let format_quote = MenuItemBuilder::with_id("format-quote", "Block Quote")
                .accelerator("CmdOrCtrl+Shift+9")
                .build(handle)?;
            let format_code_fence = MenuItemBuilder::with_id("format-code-fence", "Code Fence")
                .accelerator("CmdOrCtrl+Alt+C")
                .build(handle)?;

            let app_menu = SubmenuBuilder::new(handle, "Hebe")
                .item(&PredefinedMenuItem::about(handle, None, None)?)
                .separator()
                .item(&settings)
                .item(&updates)
                .separator()
                .item(&PredefinedMenuItem::services(handle, None)?)
                .separator()
                .item(&PredefinedMenuItem::hide(handle, None)?)
                .item(&PredefinedMenuItem::hide_others(handle, None)?)
                .item(&PredefinedMenuItem::show_all(handle, None)?)
                .separator()
                .item(&quit)
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
            let format_menu = SubmenuBuilder::new(handle, "Format")
                .item(&format_bold)
                .item(&format_italic)
                .item(&format_strike)
                .item(&format_inline_code)
                .item(&format_link)
                .separator()
                .item(&format_h1)
                .item(&format_h2)
                .item(&format_h3)
                .separator()
                .item(&format_bullet_list)
                .item(&format_ordered_list)
                .item(&format_task_list)
                .item(&format_quote)
                .item(&format_code_fence)
                .separator()
                .item(&insert_image)
                .item(&insert_toc)
                .item(&insert_footnote)
                .build()?;
            let view_menu = SubmenuBuilder::new(handle, "View")
                .item(&toggle_outline)
                .separator()
                .item(&focus_mode)
                .item(&typewriter_mode)
                .item(&source_mode)
                .separator()
                .item(&zoom_in)
                .item(&zoom_out)
                .item(&zoom_reset)
                .separator()
                .item(&PredefinedMenuItem::fullscreen(handle, None)?)
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
                .item(&format_menu)
                .item(&view_menu)
                .item(&window_menu)
                .item(&help_menu)
                .build()
        })
        .on_menu_event(|app, event| {
            let action = event.id().as_ref().to_string();
            if action == "quit-request" {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("request-quit", ());
                }
                return;
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("menu-action", action);
            } else {
                let _ = app.emit("menu-action", action);
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
            quit_app,
            update_indicator::update_indicator_position,
            restart::restart_after_update,
            commands::read_markdown_file,
            commands::write_markdown_file,
            commands::get_file_mtime,
            commands::get_heading_outline,
            commands::export_document,
            commands::paste_image,
            commands::import_image,
            commands::render_svg_to_png_data_uri,
            hide_main_window,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = &event {
                if !app.state::<ExitApproved>().0.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.emit("request-quit", ());
                    }
                }
            }
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
mod restart;
mod update_indicator;
