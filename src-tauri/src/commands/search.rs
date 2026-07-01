use pulldown_cmark::{Event, Parser, Tag};
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::{TextFieldIndexing, TextOptions, Value, STORED, STRING};
use tantivy::{doc, Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument};

#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub path: String,
    pub snippet: String,
}

struct SearchState {
    index: Index,
    title_field: tantivy::schema::Field,
    body_field: tantivy::schema::Field,
    path_field: tantivy::schema::Field,
    reader: IndexReader,
    indexed_folder: String,
}

struct SearchCache {
    state: Option<SearchState>,
}

static SEARCH_CACHE: Mutex<SearchCache> = Mutex::new(SearchCache { state: None });

fn build_index(folder_path: &str) -> Result<SearchState, String> {
    let mut schema_builder = tantivy::schema::Schema::builder();
    let text_indexing = TextFieldIndexing::default()
        .set_index_option(tantivy::schema::IndexRecordOption::WithFreqsAndPositions);
    let text_opts = TextOptions::default()
        .set_indexing_options(text_indexing)
        .set_stored();

    let title_field = schema_builder.add_text_field("title", text_opts.clone());
    let body_field = schema_builder.add_text_field("body", text_opts);
    let path_field = schema_builder.add_text_field("path", STRING | STORED);
    let schema = schema_builder.build();

    let index = Index::create_in_ram(schema);
    let reader = index
        .reader_builder()
        .reload_policy(ReloadPolicy::Manual)
        .try_into()
        .map_err(|e| format!("Failed to create reader: {e}"))?;

    let mut writer: IndexWriter = index
        .writer(50_000_000)
        .map_err(|e| format!("Failed to create writer: {e}"))?;

    let mut error_count = 0u32;

    fn walk(
        dir: &Path,
        writer: &mut IndexWriter,
        title_field: tantivy::schema::Field,
        body_field: tantivy::schema::Field,
        path_field: tantivy::schema::Field,
        error_count: &mut u32,
    ) -> Result<u64, String> {
        let entries =
            std::fs::read_dir(dir).map_err(|e| format!("Failed to read dir: {e}"))?;
        let mut count = 0u64;

        for entry in entries {
            let entry = match entry {
                Ok(e) => e,
                Err(err) => {
                    *error_count += 1;
                    eprintln!("search index walk error: {err}");
                    continue;
                }
            };
            let path = entry.path();
            if path.is_dir() {
                let name = path.file_name().unwrap_or_default().to_string_lossy();
                if name.starts_with('.') || name == "node_modules" || name == "target" {
                    continue;
                }
                count += walk(&path, writer, title_field, body_field, path_field, error_count)?;
            } else if path.extension().map_or(false, |e| e == "md") {
                let content = std::fs::read_to_string(&path).unwrap_or_default();
                let title = extract_title(&content);
                let plain = markdown_to_plain(&content);
                let path_str = path.to_string_lossy().to_string();
                writer
                    .add_document(doc!(
                        title_field => title,
                        body_field => plain,
                        path_field => path_str,
                    ))
                    .map_err(|e| format!("Failed to add doc: {e}"))?;
                count += 1;
            }
        }
        Ok(count)
    }

    let total = walk(
        Path::new(folder_path),
        &mut writer,
        title_field,
        body_field,
        path_field,
        &mut error_count,
    )?;

    writer
        .commit()
        .map_err(|e| format!("Failed to commit index: {e}"))?;

    log::info!("Indexed {total} files from {folder_path}");

    if error_count > 0 {
        eprintln!("search index: skipped {error_count} unreadable entries");
    }

    Ok(SearchState {
        index,
        title_field,
        body_field,
        path_field,
        reader,
        indexed_folder: folder_path.to_string(),
    })
}

fn extract_title(content: &str) -> String {
    content
        .lines()
        .find(|l| l.starts_with("# "))
        .map(|l| l.trim_start_matches("# ").to_string())
        .unwrap_or_default()
}

fn markdown_to_plain(content: &str) -> String {
    let parser = Parser::new(content);
    let mut plain = String::new();
    for event in parser {
        match event {
            Event::Text(text) | Event::Code(text) => {
                plain.push_str(&text);
                plain.push(' ');
            }
            Event::SoftBreak | Event::HardBreak => plain.push(' '),
            Event::Start(Tag::CodeBlock(_)) => {}
            _ => {}
        }
    }
    plain
}

#[tauri::command]
pub fn search_fulltext(
    folder_path: String,
    query_str: String,
) -> Result<Vec<SearchResult>, String> {
    let mut cache = SEARCH_CACHE
        .lock()
        .map_err(|e| format!("Search cache lock error: {e}"))?;

    // Rebuild index only if folder changed or first use
    let rebuild = match &cache.state {
        None => true,
        Some(s) => s.indexed_folder != folder_path,
    };

    if rebuild {
        *cache = SearchCache { state: None };
        let state = build_index(&folder_path)?;
        cache.state = Some(state);
    }

    let state = cache.state.as_ref().unwrap();

    state
        .reader
        .reload()
        .map_err(|e| format!("Failed to reload reader: {e}"))?;

    let searcher = state.reader.searcher();
    let query_parser =
        QueryParser::for_index(&state.index, vec![state.title_field, state.body_field]);
    let query = query_parser
        .parse_query(&query_str)
        .map_err(|e| format!("Invalid query: {e}"))?;

    let top_docs = searcher
        .search(&query, &TopDocs::with_limit(20))
        .map_err(|e| format!("Search failed: {e}"))?;

    let mut results = Vec::new();
    for (_, doc_address) in top_docs {
        let doc = searcher
            .doc::<TantivyDocument>(doc_address)
            .map_err(|e| format!("Failed to fetch doc: {e}"))?;
        let path = doc
            .get_first(state.path_field)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let body = doc
            .get_first(state.body_field)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let snippet = if body.len() > 200 {
            format!("{}...", &body[..200])
        } else {
            body
        };

        results.push(SearchResult { path, snippet });
    }

    Ok(results)
}
