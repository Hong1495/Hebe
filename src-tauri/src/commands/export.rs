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

const PDF_CODE_WRAP: &str = r"\usepackage{fvextra}
\fvset{breaklines=true,breakanywhere=true,breaknonspaceingroup=true}
\RecustomVerbatimEnvironment{verbatim}{Verbatim}{}
";

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

// On Desktop/iCloud-managed folders, a dot-prefixed temporary output can acquire
// UF_HIDDEN. Renaming it preserves that flag, making a successful export invisible.
// Clear only that flag before committing the output; preserve all other metadata.
fn prepare_export_output(path: &Path) -> std::io::Result<()> {
    // Pandoc may replace the temporary file, so reopen the actual output by path.
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)?;
    #[cfg(target_os = "macos")]
    {
        use std::os::{fd::AsRawFd, macos::fs::MetadataExt};
        let flags = file.metadata()?.st_flags();
        if flags & libc::UF_HIDDEN != 0 {
            // SAFETY: file owns this valid descriptor for the duration of the call.
            if unsafe { libc::fchflags(file.as_raw_fd(), flags & !libc::UF_HIDDEN) } != 0 {
                return Err(std::io::Error::last_os_error());
            }
        }
    }
    file.sync_all()
}

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    paper_size: String,
    font_size: u8,
    margin_mm: u8,
    table_of_contents: bool,
    number_sections: bool,
}

#[tauri::command]
pub async fn export_document(
    content: String,
    input_path: String,
    format: String,
    output_path: String,
    options: Option<ExportOptions>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        export_sync(content, input_path, format, output_path, options)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn export_sync(
    content: String,
    input_path: String,
    format: String,
    output_path: String,
    options: Option<ExportOptions>,
) -> Result<String, String> {
    let ext = match format.as_str() {
        "pdf" => "pdf",
        "docx" => "docx",
        "html" => "html",
        "epub" => "epub",
        _ => return Err(format!("Unsupported export format: {format}")),
    };

    let document_path = std::fs::canonicalize(&input_path).map_err(|e| e.to_string())?;
    let destination = PathBuf::from(&output_path);
    if destination.extension().and_then(|value| value.to_str()) != Some(ext) {
        return Err(format!("Choose a .{ext} destination"));
    }
    if destination.exists()
        && std::fs::canonicalize(&destination).map_err(|e| e.to_string())? == document_path
    {
        return Err("Export cannot replace the source document".into());
    }
    let parent = destination
        .parent()
        .ok_or("Export has no parent directory")?;
    let temp = tempfile::Builder::new()
        .suffix(&format!(".{ext}"))
        .tempfile_in(parent)
        .map_err(|e| e.to_string())?;
    let options = options.unwrap_or_default();
    // Keep the header alive until Pandoc exits; never inject presentation settings
    // into the user's Markdown or YAML metadata.
    let pdf_header = if format == "pdf" {
        let file = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
        std::fs::write(file.path(), PDF_CODE_WRAP).map_err(|e| e.to_string())?;
        Some(file)
    } else {
        None
    };

    let pdf_tables = if format == "pdf" {
        let file = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
        std::fs::write(file.path(), include_str!("pdf-tables.lua")).map_err(|e| e.to_string())?;
        Some(file)
    } else {
        None
    };

    let pandoc_path = resolve_tool("pandoc").ok_or_else(|| {
        "Pandoc is not installed. Install it from https://pandoc.org/installing.html".to_string()
    })?;

    let mut command = std::process::Command::new(pandoc_path);
    configure_tool_path(&mut command);
    let document_dir = document_path
        .parent()
        .ok_or("Document has no parent directory")?;
    command
        .current_dir(document_dir)
        .arg("--resource-path")
        .arg(document_dir);
    command
        .arg("-o")
        .arg(temp.path())
        .arg("--from=markdown")
        .arg(format!(
            "--to={}",
            if format == "pdf" { "latex" } else { &format }
        ))
        .arg("--standalone");
    if options.table_of_contents {
        command.arg("--toc");
    }
    if options.number_sections {
        command.arg("--number-sections");
    }

    if format == "pdf" {
        let xelatex_path = resolve_tool("xelatex").ok_or_else(|| {
            "xelatex is not installed. Install MacTeX/BasicTeX or TeX Live for PDF export."
                .to_string()
        })?;

        let margin = if (10..=40).contains(&options.margin_mm) {
            options.margin_mm
        } else {
            20
        };
        let paper_width = if options.paper_size == "letter" {
            216
        } else {
            210
        };
        let max_columns = (paper_width - 2 * u16::from(margin)) / 30;
        command
            .arg("--lua-filter")
            .arg(pdf_tables.as_ref().unwrap().path())
            .arg("--metadata")
            .arg(format!("hebe-pdf-columns={max_columns}"))
            .arg("--include-in-header")
            .arg(pdf_header.as_ref().unwrap().path())
            .arg(format!("--pdf-engine={}", xelatex_path.to_string_lossy()))
            .arg("-V")
            .arg("mainfont=PingFang SC")
            .arg("-V")
            .arg("CJKmainfont=PingFang SC")
            .arg("-V")
            .arg(format!(
                "papersize={}",
                if options.paper_size == "letter" {
                    "letter"
                } else {
                    "a4"
                }
            ))
            .arg("-V")
            .arg(format!(
                "fontsize={}pt",
                if [10, 11, 12].contains(&options.font_size) {
                    options.font_size
                } else {
                    11
                }
            ))
            .arg("-V")
            .arg(format!(
                "geometry:margin={}mm",
                if (10..=40).contains(&options.margin_mm) {
                    options.margin_mm
                } else {
                    20
                }
            ))
            .arg("-V")
            .arg("colorlinks=true");
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
        prepare_export_output(temp.path()).map_err(|e| format!("Failed to prepare export: {e}"))?;
        temp.persist(&destination).map_err(|e| e.to_string())?;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_visible_export(path: &Path) {
        #[cfg(target_os = "macos")]
        {
            use std::os::macos::fs::MetadataExt;
            assert_eq!(
                std::fs::metadata(path).unwrap().st_flags() & libc::UF_HIDDEN,
                0,
                "export must not retain macOS UF_HIDDEN: {}",
                path.display()
            );
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn clears_hidden_output_without_changing_content_or_other_flags() {
        use std::os::{fd::AsRawFd, macos::fs::MetadataExt};
        let file = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(file.path(), b"exported content").unwrap();
        let flags = file.as_file().metadata().unwrap().st_flags() | libc::UF_NODUMP;
        assert_eq!(
            unsafe { libc::fchflags(file.as_file().as_raw_fd(), flags | libc::UF_HIDDEN) },
            0
        );
        prepare_export_output(file.path()).unwrap();
        assert_visible_export(file.path());
        assert_eq!(
            file.as_file().metadata().unwrap().st_flags(),
            flags & !libc::UF_HIDDEN
        );
        assert_eq!(std::fs::read(file.path()).unwrap(), b"exported content");
    }

    #[test]
    fn all_exports_remain_visible_after_overwrite_and_clean_up() {
        if resolve_tool("pandoc").is_none() || resolve_tool("xelatex").is_none() {
            return;
        }
        let root = tempfile::tempdir().unwrap();
        let document = root.path().join("sample.md");
        std::fs::write(&document, "# Export test").unwrap();
        for format in ["pdf", "html", "docx", "epub"] {
            let output = root.path().join(format!("chosen.{format}"));
            for _ in 0..2 {
                let selected = output.to_string_lossy().into_owned();
                assert_eq!(
                    export_sync(
                        "# Export test".into(),
                        document.to_string_lossy().into_owned(),
                        format.into(),
                        selected.clone(),
                        None
                    )
                    .unwrap(),
                    selected
                );
                assert!(std::fs::metadata(&output).unwrap().len() > 0);
                assert_visible_export(&output);
            }
        }
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 5);
    }

    #[test]
    fn pdf_keeps_long_code_lines_inside_the_page() {
        if resolve_tool("pandoc").is_none() || resolve_tool("xelatex").is_none() {
            return;
        }
        let Some(extractor) = resolve_tool("pdftotext") else {
            return;
        };
        let root = tempfile::tempdir().unwrap();
        let document = root.path().join("wide.md");
        let output = root.path().join("wide.pdf");
        let content = format!("# Long lines\n\n```js\nconst text = \"{} HIGHLIGHT_END\";\n```\n\n```\n{} PLAIN_END\n```\n", "abcdefghij".repeat(40), "abcdefghij".repeat(40));
        std::fs::write(&document, &content).unwrap();
        export_sync(
            content,
            document.to_string_lossy().into_owned(),
            "pdf".into(),
            output.to_string_lossy().into_owned(),
            None,
        )
        .unwrap();
        let text = std::process::Command::new(extractor)
            .arg(&output)
            .arg("-")
            .output()
            .unwrap();
        assert!(text.status.success());
        let text = String::from_utf8_lossy(&text.stdout);
        assert!(
            text.contains("HIGHLIGHT_END"),
            "highlighted code must not be clipped"
        );
        assert!(text.contains("PLAIN_END"), "plain code must not be clipped");
        if let Ok(path) = std::env::var("HEBE_WIDE_PDF_REVIEW_PATH") {
            std::fs::copy(&output, path).unwrap();
        }
    }

    #[test]
    fn pdf_wide_tables_keep_every_cell_within_printable_width() {
        if resolve_tool("pandoc").is_none() || resolve_tool("xelatex").is_none() {
            return;
        }
        let Some(extractor) = resolve_tool("pdftotext") else {
            return;
        };
        let root = tempfile::tempdir().unwrap();
        let document = root.path().join("tables.md");
        let output = root.path().join("tables.pdf");
        let mut content = String::from("# Wide table\n\n");
        content.push_str(
            &(1..=16)
                .map(|n| format!("| Column{n} "))
                .collect::<String>(),
        );
        content.push_str("|\n");
        content.push_str(&"| --- ".repeat(16));
        content.push_str("|\n");
        for row in 1..=3 {
            for col in 1..=16 {
                content.push_str(&format!("| R{row}C{col} value "));
            }
            content.push_str("|\n");
        }
        content.push_str("\n| Key | Long token |\n| --- | --- |\n| ID | ");
        content.push_str(&"abcdefghij".repeat(30));
        content.push_str("TOKENEND |\n| Code | `path_with_underscores&percent%and#hash~end` |\n");
        std::fs::write(&document, &content).unwrap();
        for (paper, margin, font) in [("a4", 10, 10), ("a4", 40, 12), ("letter", 20, 11)] {
            export_sync(
                content.clone(),
                document.to_string_lossy().into_owned(),
                "pdf".into(),
                output.to_string_lossy().into_owned(),
                Some(ExportOptions {
                    paper_size: paper.into(),
                    margin_mm: margin,
                    font_size: font,
                    ..ExportOptions::default()
                }),
            )
            .unwrap();
            let text = std::process::Command::new(&extractor)
                .arg(&output)
                .arg("-")
                .output()
                .unwrap();
            assert!(text.status.success());
            let text = String::from_utf8_lossy(&text.stdout);
            let compact: String = text.chars().filter(|c| !c.is_whitespace()).collect();
            for row in 1..=3 {
                for col in 1..=16 {
                    assert!(
                        compact.contains(&format!("R{row}C{col}value")),
                        "missing cell {row},{col}"
                    );
                }
            }
            assert!(compact.contains(&format!("{}TOKENEND", "abcdefghij".repeat(30))));
            assert!(compact.contains("path_with_underscores&percent%and#hash~end"));
            let bbox = std::process::Command::new(&extractor)
                .arg("-bbox")
                .arg(&output)
                .arg("-")
                .output()
                .unwrap();
            let bbox = String::from_utf8_lossy(&bbox.stdout);
            let left = f64::from(margin) * 72.0 / 25.4;
            let page_width = if paper == "letter" { 612.0 } else { 595.28 };
            for line in bbox.lines().filter(|line| line.contains("<word ")) {
                let coordinate = |name: &str| -> f64 {
                    line.split(&format!("{name}=\""))
                        .nth(1)
                        .unwrap()
                        .split('"')
                        .next()
                        .unwrap()
                        .parse()
                        .unwrap()
                };
                assert!(coordinate("xMin") >= left - 1.0, "left overflow: {line}");
                assert!(
                    coordinate("xMax") <= page_width - left + 1.0,
                    "right overflow: {line}"
                );
            }
            if paper == "letter" {
                if let Ok(path) = std::env::var("HEBE_TABLE_PDF_REVIEW_PATH") {
                    std::fs::copy(&output, path).unwrap();
                }
            }
        }
        assert_eq!(std::fs::read_to_string(&document).unwrap(), content);
    }

    #[test]
    fn pdf_export_handles_chinese_footnotes_and_pagination() {
        if resolve_tool("pandoc").is_none() || resolve_tool("xelatex").is_none() {
            return;
        }
        let root = tempfile::tempdir().unwrap();
        let document = root.path().join("sample.md");
        let output = root.path().join("chosen.pdf");
        let content = format!(
            "---\ntitle: 青春与写作\n---\n\n# 中文标题\n\n正文脚注[^1]。\n\n[^1]: 中文脚注。\n\n{}",
            "这是一段用于检验自动分页的中文正文。\n\n".repeat(80)
        );
        std::fs::write(&document, &content).unwrap();
        export_sync(
            content,
            document.to_string_lossy().into_owned(),
            "pdf".into(),
            output.to_string_lossy().into_owned(),
            Some(ExportOptions {
                paper_size: "a4".into(),
                font_size: 11,
                margin_mm: 20,
                table_of_contents: true,
                number_sections: true,
            }),
        )
        .unwrap();
        let bytes = std::fs::read(&output).unwrap();
        assert!(bytes.starts_with(b"%PDF-"));
        assert_visible_export(&output);
        if let Some(extractor) = resolve_tool("pdftotext") {
            let text = std::process::Command::new(extractor)
                .arg(&output)
                .arg("-")
                .output()
                .unwrap();
            let text = String::from_utf8_lossy(&text.stdout);
            assert!(text.contains("中文标题"));
            assert!(text.contains("中文脚注"));
            assert!(
                text.matches('\u{000c}').count() >= 2,
                "long document should paginate"
            );
        }
        // A caller may choose to retain this fixture for visual review outside the repository.
        if let Ok(destination) = std::env::var("HEBE_PDF_REVIEW_PATH") {
            std::fs::copy(&output, destination).unwrap();
        }
    }

    #[test]
    fn failed_export_preserves_existing_output() {
        if resolve_tool("pandoc").is_none() {
            return;
        }
        let root = tempfile::tempdir().unwrap();
        let document = root.path().join("sample.md");
        let output = root.path().join("existing.docx");
        std::fs::write(&document, "source").unwrap();
        std::fs::write(&output, "keep me").unwrap();
        let result = export_sync(
            "---\ninvalid: [\n---\n".into(),
            document.to_string_lossy().into_owned(),
            "docx".into(),
            output.to_string_lossy().into_owned(),
            None,
        );
        assert!(result.is_err());
        assert_eq!(std::fs::read_to_string(&output).unwrap(), "keep me");
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 2);
    }

    #[test]
    fn exports_relative_image_from_document_directory() {
        let Some(_) = resolve_tool("pandoc") else {
            return;
        };
        let root = std::env::temp_dir().join(format!("hebe-export-{}", std::process::id()));
        std::fs::create_dir_all(root.join("assets")).unwrap();
        std::fs::write(
            root.join("assets/image.png"),
            include_bytes!("../../icons/32x32.png"),
        )
        .unwrap();
        let document = root.join("sample.md");
        std::fs::write(&document, "![image](assets/image.png)").unwrap();
        let output = tauri::async_runtime::block_on(export_document(
            "![image](assets/image.png)".to_string(),
            document.to_string_lossy().into_owned(),
            "docx".to_string(),
            root.join("chosen.docx").to_string_lossy().into_owned(),
            None,
        ))
        .expect("export should succeed");
        let archive = std::fs::read(output).unwrap();
        assert!(
            archive
                .windows(b"word/media/".len())
                .any(|bytes| bytes == b"word/media/"),
            "DOCX must embed the relative image"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
