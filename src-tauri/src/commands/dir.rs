use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
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

        let name = entry.file_name().to_string_lossy().into_owned();
        let entry_path = entry.path().to_string_lossy().into_owned();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);

        if name.starts_with('.') || name == "node_modules" || name == "target" {
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
