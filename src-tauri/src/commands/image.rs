use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[tauri::command]
pub async fn paste_image(image_data: Vec<u8>, md_path: String) -> Result<String, String> {
    let md_dir = Path::new(&md_path).parent().unwrap_or(Path::new("."));
    let assets_dir = md_dir.join("assets");
    std::fs::create_dir_all(&assets_dir)
        .map_err(|e| format!("Failed to create assets dir: {e}"))?;

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let filename = format!("image-{}.png", ts.as_millis());
    let filepath = assets_dir.join(&filename);

    std::fs::write(&filepath, &image_data)
        .map_err(|e| format!("Failed to write image: {e}"))?;

    Ok(format!("assets/{}", filename))
}
