use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_EXPORT_IMAGE_EDGE: f32 = 2400.0;
const EXPORT_IMAGE_SCALE: f32 = 2.0;

#[tauri::command]
pub async fn paste_image(image_data: Vec<u8>, md_path: String) -> Result<String, String> {
    let ext = if image_data.starts_with(b"\x89PNG\r\n\x1a\n") { "png" }
        else if image_data.starts_with(&[0xff, 0xd8, 0xff]) { "jpg" }
        else if image_data.starts_with(b"GIF8") { "gif" }
        else if image_data.starts_with(b"RIFF") && image_data.get(8..12) == Some(b"WEBP") { "webp" }
        else { return Err("Unsupported clipboard image format".into()); };
    store_image(&image_data, &md_path, ext)
}

fn store_image(data: &[u8], md_path: &str, ext: &str) -> Result<String, String> {
    use std::io::Write;
    let md_dir = Path::new(md_path).parent().unwrap_or(Path::new("."));
    let assets_dir = md_dir.join("assets");
    std::fs::create_dir_all(&assets_dir).map_err(|e| e.to_string())?;
    let ts = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let filename = format!("image-{ts}.{ext}");
    let mut file = std::fs::OpenOptions::new().create_new(true).write(true).open(assets_dir.join(&filename)).map_err(|e| e.to_string())?;
    file.write_all(data).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    Ok(format!("assets/{filename}"))
}

#[tauri::command]
pub fn import_image(source: String, md_path: String) -> Result<String, String> {
    let ext = Path::new(&source).extension().and_then(|value| value.to_str()).unwrap_or("").to_lowercase();
    if !["png", "jpg", "jpeg", "gif", "webp", "svg"].contains(&ext.as_str()) { return Err("Unsupported image format".into()); }
    let data = std::fs::read(&source).map_err(|e| e.to_string())?;
    store_image(&data, &md_path, &ext)
}

#[tauri::command]
pub fn render_svg_to_png_data_uri(svg: String) -> Result<String, String> {
    svg_to_png_data_uri(&svg)
}

fn svg_to_png_data_uri(svg: &str) -> Result<String, String> {
    use base64::Engine;

    let mut options = resvg::usvg::Options {
        font_family: "PingFang SC".to_string(),
        ..resvg::usvg::Options::default()
    };
    options.fontdb_mut().load_system_fonts();

    let tree = resvg::usvg::Tree::from_data(svg.as_bytes(), &options)
        .map_err(|error| format!("Failed to parse SVG: {error}"))?;
    let size = tree.size();
    let width = size.width();
    let height = size.height();
    let max_edge = width.max(height);
    let scale = if max_edge > 0.0 {
        (MAX_EXPORT_IMAGE_EDGE / max_edge).min(EXPORT_IMAGE_SCALE)
    } else {
        1.0
    };
    let scale = if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    };

    let target_width = (width * scale).ceil().max(1.0) as u32;
    let target_height = (height * scale).ceil().max(1.0) as u32;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(target_width, target_height)
        .ok_or_else(|| "Failed to allocate image buffer".to_string())?;

    pixmap.fill(resvg::tiny_skia::Color::WHITE);
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );

    let png = pixmap
        .encode_png()
        .map_err(|error| format!("Failed to encode PNG: {error}"))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(png);
    Ok(format!("data:image/png;base64,{encoded}"))
}

#[cfg(test)]
mod tests {
    use super::svg_to_png_data_uri;

    #[test]
    fn renders_svg_to_png_data_uri() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">
  <rect width="120" height="80" fill="#fff"/>
  <text x="10" y="45" font-family="PingFang SC" font-size="20">冀</text>
</svg>"##;

        let data_uri = svg_to_png_data_uri(svg).expect("svg should render");

        assert!(data_uri.starts_with("data:image/png;base64,"));
        assert!(data_uri.len() > "data:image/png;base64,".len());
    }
}
