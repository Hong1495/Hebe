// Adapted from Hong1495/Bee (MIT); see THIRD_PARTY_NOTICES.md.
// Read AppKit's actual traffic-light geometry; never move its native buttons.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn update_indicator_position(
    window: tauri::WebviewWindow,
) -> Result<serde_json::Value, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let handle = window.clone();
    window.run_on_main_thread(move||{
        let result=(||{
            use objc2_app_kit::{NSWindow,NSWindowButton,NSWindowStyleMask};
            let ptr=handle.ns_window().map_err(|e|e.to_string())?;
            let native=unsafe{&*(ptr as *const NSWindow)};
            if native.styleMask().contains(NSWindowStyleMask::FullScreen){return Ok(serde_json::Value::Null);}
            let content=native.contentView().ok_or("Missing content view")?;
            let green=native.standardWindowButton(NSWindowButton::ZoomButton).ok_or("Missing zoom button")?;
            let yellow=native.standardWindowButton(NSWindowButton::MiniaturizeButton).ok_or("Missing minimize button")?;
            let g=green.convertRect_toView(green.bounds(),None);
            let y=yellow.convertRect_toView(yellow.bounds(),None);
            let c=content.convertRect_toView(content.bounds(),None);
            Ok::<_,String>(serde_json::json!({"left":g.origin.x+(g.origin.x-y.origin.x)-c.origin.x,"top":c.origin.y+c.size.height-g.origin.y-g.size.height,"size":g.size.width}))
        })();
        let _=tx.send(result);
    }).map_err(|e|e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv().map_err(|e| e.to_string())?)
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn update_indicator_position() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({"left": 91, "top": 22, "size": 12}))
}
