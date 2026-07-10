use std::path::{Path, PathBuf};

const TOOL_DIRS: &[&str] = &[
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/Library/TeX/texbin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
];

fn tool_search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default();

    for dir in TOOL_DIRS {
        let path = PathBuf::from(dir);
        if !dirs.iter().any(|existing| existing == &path) {
            dirs.push(path);
        }
    }

    dirs
}

fn resolve_tool(name: &str) -> Option<PathBuf> {
    let requested = Path::new(name);
    if requested.components().count() > 1 && requested.is_file() {
        return Some(requested.to_path_buf());
    }

    tool_search_dirs()
        .into_iter()
        .map(|dir| dir.join(name))
        .find(|path| path.is_file())
}

fn configure_tool_path(command: &mut std::process::Command) {
    if let Ok(path) = std::env::join_paths(tool_search_dirs()) {
        command.env("PATH", path);
    }
}

#[tauri::command]
pub async fn export_document(
    content: String,
    input_path: String,
    format: String,
) -> Result<String, String> {
    let ext = match format.as_str() {
        "pdf" => "pdf",
        "docx" => "docx",
        "html" => "html",
        "epub" => "epub",
        _ => return Err(format!("Unsupported export format: {format}")),
    };

    let mut output_path = std::path::PathBuf::from(&input_path);
    output_path.set_extension(ext);
    let output_path = output_path.to_string_lossy().to_string();

    let pandoc_path = resolve_tool("pandoc").ok_or_else(|| {
        "Pandoc is not installed. Install it from https://pandoc.org/installing.html".to_string()
    })?;

    let mut command = std::process::Command::new(pandoc_path);
    configure_tool_path(&mut command);
    command
        .arg("-o")
        .arg(&output_path)
        .arg("--from=markdown")
        .arg(format!("--to={format}"));

    if format == "pdf" {
        let xelatex_path = resolve_tool("xelatex").ok_or_else(|| {
            "xelatex is not installed. Install MacTeX/BasicTeX or TeX Live for PDF export."
                .to_string()
        })?;

        command
            .arg(format!("--pdf-engine={}", xelatex_path.to_string_lossy()))
            .arg("-V")
            .arg("mainfont=PingFang SC")
            .arg("-V")
            .arg("CJKmainfont=PingFang SC");
    }

    let mut child = command
        .stdin(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "Pandoc is not installed. Install it from https://pandoc.org/installing.html"
                    .to_string()
            } else {
                format!("Failed to launch pandoc: {e}")
            }
        })?;

    use std::io::Write;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(content.as_bytes())
            .map_err(|e| format!("Failed to send document to pandoc: {e}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Pandoc process error: {e}"))?;

    if output.status.success() {
        Ok(output_path)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(format!("Pandoc exited with status: {}", output.status))
        } else {
            Err(stderr)
        }
    }
}
