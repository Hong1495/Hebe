use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use serde::Serialize;

#[tauri::command]
pub fn read_markdown_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {e}"))
}

#[tauri::command]
pub fn write_markdown_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write file: {e}"))
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
                    let line = content[..range.start].chars().filter(|&c| c == '\n').count();
                    headings.push(Heading { text, level, line });
                }
            }
            _ => {}
        }
    }

    headings
}
