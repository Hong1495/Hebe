use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use serde::Serialize;
use std::time::UNIX_EPOCH;
use tauri::Manager;

fn allow_document_images(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    let absolute = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    if let Some(directory) = absolute.parent() {
        app.asset_protocol_scope()
            .allow_directory(directory, true)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn read_markdown_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {e}"))?;
    allow_document_images(&app, &path)?;
    Ok(content)
}

#[tauri::command]
pub fn write_markdown_file(
    app: tauri::AppHandle,
    path: String,
    content: String,
) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write file: {e}"))?;
    allow_document_images(&app, &path)
}

#[tauri::command]
pub fn get_file_mtime(path: String) -> Result<u64, String> {
    let modified = std::fs::metadata(&path)
        .and_then(|metadata| metadata.modified())
        .map_err(|e| format!("Failed to read file metadata: {e}"))?;

    modified
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|e| format!("Invalid file modified time: {e}"))
}

#[derive(Debug, Serialize)]
pub struct Heading {
    pub text: String,
    pub level: u32,
    pub line: usize,
}

#[tauri::command]
pub fn get_heading_outline(content: String) -> Vec<Heading> {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_HEADING_ATTRIBUTES);

    let parser = Parser::new_ext(&content, options).into_offset_iter();
    let mut headings = Vec::new();
    let mut current_heading: Option<(u32, String)> = None;

    for (event, range) in parser {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                current_heading = Some((level as u32, String::new()));
            }
            Event::Text(text) => {
                if let Some((_, ref mut heading_text)) = &mut current_heading {
                    heading_text.push_str(&text);
                }
            }
            Event::End(TagEnd::Heading { .. }) => {
                if let Some((level, text)) = current_heading.take() {
                    let line = content[..range.start]
                        .chars()
                        .filter(|&c| c == '\n')
                        .count();
                    headings.push(Heading { text, level, line });
                }
            }
            _ => {}
        }
    }

    headings
}
