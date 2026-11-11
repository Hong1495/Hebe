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
    expected_content: Option<String>,
) -> Result<(), String> {
    atomic_write(std::path::Path::new(&path), &content, expected_content.as_deref())?;
    allow_document_images(&app, &path)
}

// Serialize Hebe writes and check the baseline immediately before atomic replacement.
// Other applications do not share this lock; their later writes are detected on the next read.
static WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub(crate) fn atomic_write(path: &std::path::Path, content: &str, expected: Option<&str>) -> Result<(), String> {
    use std::io::Write;
    let _lock = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    // Follow existing symlinks so saving does not replace the link itself.
    let target = if path.exists() { std::fs::canonicalize(path).map_err(|e| e.to_string())? } else { path.to_path_buf() };
    let parent = target.parent().ok_or("Document has no parent directory")?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    if let Ok(metadata) = std::fs::metadata(&target) {
        temp.as_file().set_permissions(metadata.permissions()).map_err(|e| e.to_string())?;
    }
    temp.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    if let Some(expected) = expected {
        let disk = std::fs::read_to_string(&target).map_err(|e| format!("CONFLICT: Cannot read the original file: {e}"))?;
        if disk != expected {
            return Err("CONFLICT: The file changed outside Hebe. Review the disk version before saving.".into());
        }
    }
    temp.persist(&target).map_err(|e| e.to_string())?;
    if let Ok(directory) = std::fs::File::open(parent) { let _ = directory.sync_all(); }
    Ok(())
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
            Event::Text(text) | Event::Code(text) => {
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

#[cfg(test)]
mod safety_tests {
    use super::*;
    #[test]
    fn saves_atomically_and_rejects_stale_or_deleted_files() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("note.md");
        atomic_write(&path, "original", None).unwrap();
        atomic_write(&path, "edited", Some("original")).unwrap();
        assert!(atomic_write(&path, "stale", Some("original")).unwrap_err().starts_with("CONFLICT:"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "edited");
        std::fs::remove_file(&path).unwrap();
        assert!(atomic_write(&path, "stale", Some("edited")).is_err());
        assert!(!path.exists());
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    }
    #[cfg(unix)]
    #[test]
    fn preserves_symlinks_and_permissions() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("note.md");
        let link = root.path().join("link.md");
        std::fs::write(&path, "old").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o640)).unwrap();
        symlink(&path, &link).unwrap();
        atomic_write(&link, "new", Some("old")).unwrap();
        assert!(link.is_symlink());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o640);
    }
}
