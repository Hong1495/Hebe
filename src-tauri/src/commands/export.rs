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

    let output_path = format!("{}.{}", input_path.trim_end_matches(".md"), ext);

    let mut child = std::process::Command::new("pandoc")
        .arg("-o")
        .arg(&output_path)
        .arg("--from=markdown")
        .arg(format!("--to={format}"))
        .stdin(std::process::Stdio::piped())
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
        let _ = stdin.write_all(content.as_bytes());
    }
    // Drop stdin to close the pipe before waiting
    drop(child.stdin.take());

    let status = child
        .wait()
        .map_err(|e| format!("Pandoc process error: {e}"))?;

    if status.success() {
        Ok(output_path)
    } else {
        Err(format!("Pandoc exited with status: {status}"))
    }
}
