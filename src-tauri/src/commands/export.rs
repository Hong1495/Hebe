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

    let mut child = std::process::Command::new("pandoc")
        .arg("-o")
        .arg(&output_path)
        .arg("--from=markdown")
        .arg(format!("--to={format}"))
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
