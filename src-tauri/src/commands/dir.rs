use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

fn should_skip_name(name: &str) -> bool {
    name.starts_with('.')
        || matches!(
            name,
            "node_modules" | "target" | "dist" | "build" | ".git" | ".turbo"
        )
}

fn is_markdown_name(name: &str) -> bool {
    name.rsplit_once('.')
        .map(|(_, ext)| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "mdx" | "mkd" | "mkdn"
            )
        })
        .unwrap_or(false)
}

#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let entries = std::fs::read_dir(&path).map_err(|e| format!("Failed to read directory: {e}"))?;
    let mut files: Vec<FileEntry> = Vec::new();
    let mut error_count = 0u32;

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(err) => {
                error_count += 1;
                eprintln!("list_directory: {err}");
                continue;
            }
        };

        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(err) => {
                error_count += 1;
                eprintln!("list_directory file_type: {err}");
                continue;
            }
        };

        let name = entry.file_name().to_string_lossy().into_owned();
        let entry_path = entry.path().to_string_lossy().into_owned();
        if file_type.is_symlink() {
            continue;
        }
        let is_dir = file_type.is_dir();

        if should_skip_name(&name) {
            continue;
        }

        files.push(FileEntry {
            name,
            path: entry_path,
            is_dir,
        });
    }

    if error_count > 0 {
        eprintln!("list_directory: skipped {error_count} unreadable entries in {path}");
    }

    files.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(files)
}

#[tauri::command]
pub fn list_markdown_files(path: String) -> Result<Vec<FileEntry>, String> {
    const MAX_FILES: usize = 10_000;

    fn walk(dir: &Path, files: &mut Vec<FileEntry>, error_count: &mut u32) -> Result<(), String> {
        if files.len() >= MAX_FILES {
            return Ok(());
        }

        let entries =
            std::fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {e}"))?;

        for entry in entries {
            if files.len() >= MAX_FILES {
                break;
            }

            let entry = match entry {
                Ok(e) => e,
                Err(err) => {
                    *error_count += 1;
                    eprintln!("list_markdown_files: {err}");
                    continue;
                }
            };

            let file_type = match entry.file_type() {
                Ok(t) => t,
                Err(err) => {
                    *error_count += 1;
                    eprintln!("list_markdown_files file_type: {err}");
                    continue;
                }
            };

            let name = entry.file_name().to_string_lossy().into_owned();
            if should_skip_name(&name) {
                continue;
            }

            let path = entry.path();
            if file_type.is_symlink() {
                continue;
            }
            let is_dir = file_type.is_dir();
            if is_dir {
                walk(&path, files, error_count)?;
            } else if is_markdown_name(&name) {
                files.push(FileEntry {
                    name,
                    path: path.to_string_lossy().into_owned(),
                    is_dir: false,
                });
            }
        }

        Ok(())
    }

    let mut files = Vec::new();
    let mut error_count = 0u32;
    walk(Path::new(&path), &mut files, &mut error_count)?;

    if error_count > 0 {
        eprintln!("list_markdown_files: skipped {error_count} unreadable entries in {path}");
    }

    files.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then(a.path.to_lowercase().cmp(&b.path.to_lowercase()))
    });

    Ok(files)
}
